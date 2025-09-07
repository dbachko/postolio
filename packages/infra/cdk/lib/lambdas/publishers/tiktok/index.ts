import { SQSEvent, SQSRecord } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { KMSClient, DecryptCommand, EncryptCommand } from '@aws-sdk/client-kms'
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import axios, { AxiosError } from 'axios'

const dynamoClient = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(dynamoClient)
const kmsClient = new KMSClient({})
const eventBridgeClient = new EventBridgeClient({})

const TOKEN_TABLE_NAME = process.env.TOKEN_TABLE_NAME!
const JOB_STATE_TABLE_NAME = process.env.JOB_STATE_TABLE_NAME!
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!
const KMS_KEY_ID = process.env.KMS_KEY_ID!

interface PublishRequest {
  scheduleId: string
  contentId: string
  brandId: string
  userId: string
  platform: string
  content: {
    caption: string
    hashtags: string[]
    mediaUrl?: string
    mediaType?: 'image' | 'video'
  }
  metadata?: Record<string, any>
}

interface TikTokVideoResponse {
  publish_id: string
  status: string
  share_url?: string
}

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('TikTok Publisher Lambda invoked', {
    records: event.Records.length,
  })

  // Process each message
  for (const record of event.Records) {
    try {
      await processMessage(record)
    } catch (error) {
      console.error('Error processing message:', error, {
        messageId: record.messageId,
        body: record.body,
      })
      
      // Throw error to send message to DLQ after retries
      throw error
    }
  }
}

async function processMessage(record: SQSRecord): Promise<void> {
  const request: PublishRequest = JSON.parse(record.body)
  console.log('Processing publish request:', request)

  // Create job state entry
  const jobId = `${request.scheduleId}-${Date.now()}`
  await updateJobState(jobId, 'processing', request)

  try {
    // Check if content is video (TikTok requires video)
    if (request.content.mediaType !== 'video') {
      throw new Error('TikTok requires video content')
    }

    // Get OAuth token
    const token = await getToken(request.userId, request.brandId, 'tiktok')
    if (!token) {
      throw new Error('TikTok token not found')
    }

    // Check if token needs refresh
    if (token.needsRefresh && token.refreshToken) {
      const newToken = await refreshTikTokToken(
        token.refreshToken,
        request.metadata?.clientKey,
        request.metadata?.clientSecret
      )
      await storeRefreshedToken(request.userId, request.brandId, newToken)
      token.accessToken = newToken.accessToken
    }

    // Get TikTok Open ID from metadata
    const openId = request.metadata?.openId
    if (!openId) {
      throw new Error('TikTok Open ID not found in metadata')
    }

    // Publish to TikTok
    const result = await publishToTikTok(
      openId,
      token.accessToken,
      request.content,
      request.metadata?.clientKey
    )

    // Update job state with success
    await updateJobState(jobId, 'completed', {
      ...request,
      result,
    })

    // Send success event
    await sendEvent('postolio.publisher.tiktok', 'post.published', {
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      brandId: request.brandId,
      userId: request.userId,
      platform: 'tiktok',
      publishId: result.publish_id,
      shareUrl: result.share_url,
      publishedAt: new Date().toISOString(),
    })

  } catch (error) {
    console.error('Publishing failed:', error)

    // Update job state with failure
    await updateJobState(jobId, 'failed', {
      ...request,
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    // Send failure event
    await sendEvent('postolio.publisher.tiktok', 'post.failed', {
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      brandId: request.brandId,
      userId: request.userId,
      platform: 'tiktok',
      error: error instanceof Error ? error.message : 'Unknown error',
      failedAt: new Date().toISOString(),
    })

    throw error
  }
}

async function getToken(userId: string, brandId: string, platform: string): Promise<any> {
  const result = await docClient.send(new GetCommand({
    TableName: TOKEN_TABLE_NAME,
    Key: {
      pk: `${userId}#${platform}`,
      sk: brandId,
    },
  }))

  if (!result.Item) {
    return null
  }

  // Decrypt token
  const accessToken = await decryptData(result.Item.encryptedAccessToken)
  const refreshToken = result.Item.encryptedRefreshToken
    ? await decryptData(result.Item.encryptedRefreshToken)
    : null

  // Check if token needs refresh (TikTok tokens expire after 1 day)
  const expiryTime = result.Item.expiresAt
  const refreshThreshold = Date.now() + (2 * 60 * 60 * 1000) // 2 hours
  const needsRefresh = expiryTime < refreshThreshold

  return {
    accessToken,
    refreshToken,
    expiresAt: result.Item.expiresAt,
    needsRefresh,
  }
}

async function decryptData(encryptedData: string): Promise<string> {
  const result = await kmsClient.send(new DecryptCommand({
    CiphertextBlob: Buffer.from(encryptedData, 'base64'),
  }))

  return Buffer.from(result.Plaintext!).toString()
}

async function refreshTikTokToken(
  refreshToken: string,
  clientKey?: string,
  clientSecret?: string
): Promise<any> {
  // TikTok OAuth 2.0 token refresh
  if (!clientKey || !clientSecret) {
    throw new Error('TikTok client credentials required for token refresh')
  }
  
  try {
    const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    })

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
      scope: response.data.scope,
    }
  } catch (error) {
    console.error('Token refresh failed:', error)
    throw new Error('Failed to refresh TikTok token')
  }
}

async function storeRefreshedToken(userId: string, brandId: string, token: any): Promise<void> {
  // Encrypt new tokens
  const encryptedAccessToken = await encryptData(token.accessToken)
  const encryptedRefreshToken = token.refreshToken
    ? await encryptData(token.refreshToken)
    : null

  // Calculate new expiry
  const expiresAt = Date.now() + (token.expiresIn * 1000)

  // Store in DynamoDB
  await docClient.send(new PutCommand({
    TableName: TOKEN_TABLE_NAME,
    Item: {
      pk: `${userId}#tiktok`,
      sk: brandId,
      platform: 'tiktok',
      encryptedAccessToken,
      encryptedRefreshToken,
      expiresAt,
      lastRefreshed: new Date().toISOString(),
      ttl: Math.floor(expiresAt / 1000) + 86400, // TTL 1 day after expiry
    },
  }))

  // Emit event for monitoring
  await sendEvent('postolio.token', 'token.refreshed', {
    userId,
    brandId,
    platform: 'tiktok',
    expiresAt,
    timestamp: new Date().toISOString(),
  })

  console.log('Token refreshed and stored successfully', {
    userId,
    brandId,
    platform: 'tiktok',
    expiresAt,
  })
}

// Helper function for encryption
async function encryptData(plainText: string): Promise<string> {
  const result = await kmsClient.send(new EncryptCommand({
    KeyId: KMS_KEY_ID,
    Plaintext: Buffer.from(plainText),
  }))

  return Buffer.from(result.CiphertextBlob!).toString('base64')
}

async function publishToTikTok(
  openId: string,
  accessToken: string,
  content: PublishRequest['content'],
  clientKey?: string
): Promise<TikTokVideoResponse> {
  try {
    // TikTok Content Posting API (v2)
    // Note: This is a simplified version. Real implementation requires:
    // 1. Upload video to TikTok's servers
    // 2. Create post with uploaded video
    
    if (!content.mediaUrl) {
      throw new Error('Video URL is required for TikTok posts')
    }

    if (!clientKey) {
      throw new Error('TikTok client key is required')
    }

    // Step 1: Initialize video upload
    const initResponse = await axios.post(
      'https://open.tiktokapis.com/v2/post/publish/video/init',
      {
        post_info: {
          title: formatCaption(content.caption, content.hashtags),
          privacy_level: 'PUBLIC',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000, // 1 second into video
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: await getVideoSize(content.mediaUrl),
          chunk_size: 10485760, // 10MB chunks
          total_chunk_count: 1, // For simplicity, assuming single chunk
        },
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    const uploadUrl = initResponse.data.data.upload_url
    const publishId = initResponse.data.data.publish_id

    // Step 2: Upload video file
    const videoData = await downloadVideo(content.mediaUrl)
    
    await axios.put(uploadUrl, videoData, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes 0-${videoData.length - 1}/${videoData.length}`,
      },
    })

    // Step 3: Check upload status
    const statusResponse = await axios.post(
      'https://open.tiktokapis.com/v2/post/publish/status/fetch',
      {
        publish_id: publishId,
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    // Note: In production, you'd need to poll this endpoint until status is 'PUBLISH_COMPLETE'
    return {
      publish_id: publishId,
      status: statusResponse.data.data.status,
      share_url: statusResponse.data.data.share_url,
    }

  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError
      console.error('TikTok API error:', {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
      })
      
      // Handle rate limiting
      if (axiosError.response?.status === 429) {
        throw new Error('TikTok API rate limit exceeded')
      }

      // Handle quota exceeded
      const errorData = axiosError.response?.data as any
      if (errorData?.error?.code === 'rate_limit_exceeded') {
        throw new Error('TikTok daily post limit reached')
      }
      
      // Handle other API errors
      const errorMessage = errorData?.error?.message || 'TikTok API error'
      throw new Error(errorMessage)
    }
    
    throw error
  }
}

async function getVideoSize(videoUrl: string): Promise<number> {
  // Get video file size for upload initialization
  try {
    const response = await axios.head(videoUrl)
    const contentLength = response.headers['content-length']
    return parseInt(contentLength, 10)
  } catch (error) {
    console.error('Failed to get video size:', error)
    // Return a default size if we can't determine it
    return 10485760 // 10MB default
  }
}

async function downloadVideo(videoUrl: string): Promise<Buffer> {
  // Download video file for upload
  try {
    const response = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      maxContentLength: 100000000, // 100MB max
      maxBodyLength: 100000000,
    })
    return Buffer.from(response.data)
  } catch (error) {
    console.error('Failed to download video:', error)
    throw new Error('Failed to download video for TikTok upload')
  }
}

function formatCaption(caption: string, hashtags: string[]): string {
  // TikTok best practices:
  // - Maximum 2,200 characters for captions
  // - Hashtags are very important for discovery
  // - Trending hashtags can boost visibility
  
  const hashtagString = hashtags
    .slice(0, 20) // TikTok allows many hashtags
    .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
    .join(' ')
  
  const fullCaption = `${caption} ${hashtagString}`
  
  // Truncate if too long
  if (fullCaption.length > 2200) {
    const truncatedCaption = caption.substring(0, 2200 - hashtagString.length - 4)
    return `${truncatedCaption}... ${hashtagString}`
  }
  
  return fullCaption
}

async function updateJobState(
  jobId: string,
  status: string,
  data: any
): Promise<void> {
  await docClient.send(new PutCommand({
    TableName: JOB_STATE_TABLE_NAME,
    Item: {
      jobId,
      status,
      data,
      updatedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days TTL
    },
  }))
}

async function sendEvent(source: string, detailType: string, detail: any): Promise<void> {
  await eventBridgeClient.send(new PutEventsCommand({
    Entries: [{
      Source: source,
      DetailType: detailType,
      Detail: JSON.stringify(detail),
      EventBusName: EVENT_BUS_NAME,
    }],
  }))
}