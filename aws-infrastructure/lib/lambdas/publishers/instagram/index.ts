import { SQSEvent, SQSRecord } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms'
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
  }
  metadata?: Record<string, any>
}

interface InstagramMediaResponse {
  id: string
  permalink?: string
}

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('Instagram Publisher Lambda invoked', {
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
    // Get OAuth token
    const token = await getToken(request.userId, request.brandId, 'instagram')
    if (!token) {
      throw new Error('Instagram token not found')
    }

    // Check if token needs refresh
    if (token.needsRefresh && token.refreshToken) {
      const newToken = await refreshInstagramToken(token.refreshToken)
      await storeRefreshedToken(request.userId, request.brandId, newToken)
      token.accessToken = newToken.accessToken
    }

    // Get Instagram Business Account ID from brand metadata
    const instagramAccountId = request.metadata?.instagramAccountId
    if (!instagramAccountId) {
      throw new Error('Instagram Business Account ID not found in metadata')
    }

    // Publish to Instagram
    const result = await publishToInstagram(
      instagramAccountId,
      token.accessToken,
      request.content
    )

    // Update job state with success
    await updateJobState(jobId, 'completed', {
      ...request,
      result,
    })

    // Send success event
    await sendEvent('postolio.publisher.instagram', 'post.published', {
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      brandId: request.brandId,
      userId: request.userId,
      platform: 'instagram',
      postId: result.id,
      permalink: result.permalink,
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
    await sendEvent('postolio.publisher.instagram', 'post.failed', {
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      brandId: request.brandId,
      userId: request.userId,
      platform: 'instagram',
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

  // Check if token needs refresh
  const expiryTime = result.Item.expiresAt
  const refreshThreshold = Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
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

async function refreshInstagramToken(refreshToken: string): Promise<any> {
  // Instagram uses long-lived tokens that don't refresh in the traditional OAuth sense
  // Instead, they need to be refreshed every 60 days using the Graph API
  
  try {
    const response = await axios.get('https://graph.instagram.com/refresh_access_token', {
      params: {
        grant_type: 'ig_refresh_token',
        access_token: refreshToken,
      },
    })

    return {
      accessToken: response.data.access_token,
      expiresIn: response.data.expires_in,
    }
  } catch (error) {
    console.error('Token refresh failed:', error)
    throw new Error('Failed to refresh Instagram token')
  }
}

async function storeRefreshedToken(userId: string, brandId: string, token: any): Promise<void> {
  // This would normally call back to the Token Service API
  // For now, we'll skip this as it requires more setup
  console.log('Would store refreshed token:', { userId, brandId, token })
}

async function publishToInstagram(
  accountId: string,
  accessToken: string,
  content: PublishRequest['content']
): Promise<InstagramMediaResponse> {
  try {
    // Step 1: Create media container
    const caption = formatCaption(content.caption, content.hashtags)
    
    let mediaContainerId: string

    if (content.mediaUrl) {
      // Create photo container
      const containerResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${accountId}/media`,
        null,
        {
          params: {
            image_url: content.mediaUrl,
            caption: caption,
            access_token: accessToken,
          },
        }
      )
      mediaContainerId = containerResponse.data.id
    } else {
      throw new Error('Media URL is required for Instagram posts')
    }

    // Step 2: Wait for media to be processed (Instagram needs time to download the image)
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Step 3: Check container status
    const statusResponse = await axios.get(
      `https://graph.facebook.com/v18.0/${mediaContainerId}`,
      {
        params: {
          fields: 'status_code',
          access_token: accessToken,
        },
      }
    )

    if (statusResponse.data.status_code !== 'FINISHED') {
      // Wait more if needed
      await new Promise(resolve => setTimeout(resolve, 10000))
    }

    // Step 4: Publish media
    const publishResponse = await axios.post(
      `https://graph.facebook.com/v18.0/${accountId}/media_publish`,
      null,
      {
        params: {
          creation_id: mediaContainerId,
          access_token: accessToken,
        },
      }
    )

    const mediaId = publishResponse.data.id

    // Step 5: Get permalink
    const permalinkResponse = await axios.get(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      {
        params: {
          fields: 'permalink',
          access_token: accessToken,
        },
      }
    )

    return {
      id: mediaId,
      permalink: permalinkResponse.data.permalink,
    }

  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError
      console.error('Instagram API error:', {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
      })
      
      // Handle rate limiting
      if (axiosError.response?.status === 429) {
        throw new Error('Instagram API rate limit exceeded')
      }
      
      // Handle other API errors
      const errorMessage = (axiosError.response?.data as any)?.error?.message || 'Instagram API error'
      throw new Error(errorMessage)
    }
    
    throw error
  }
}

function formatCaption(caption: string, hashtags: string[]): string {
  // Instagram best practices:
  // - Maximum 2,200 characters for captions
  // - Maximum 30 hashtags
  // - Hashtags can be in caption or first comment
  
  const hashtagString = hashtags
    .slice(0, 30) // Limit to 30 hashtags
    .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
    .join(' ')
  
  const fullCaption = `${caption}\n\n${hashtagString}`
  
  // Truncate if too long
  if (fullCaption.length > 2200) {
    const truncatedCaption = caption.substring(0, 2200 - hashtagString.length - 4) + '...'
    return `${truncatedCaption}\n\n${hashtagString}`
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