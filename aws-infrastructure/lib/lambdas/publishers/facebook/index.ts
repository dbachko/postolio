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

interface FacebookPostResponse {
  id: string
  post_id?: string
  permalink_url?: string
}

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('Facebook Publisher Lambda invoked', {
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
    const token = await getToken(request.userId, request.brandId, 'facebook')
    if (!token) {
      throw new Error('Facebook token not found')
    }

    // Check if token needs refresh
    if (token.needsRefresh && token.refreshToken) {
      const newToken = await refreshFacebookToken(token.accessToken)
      await storeRefreshedToken(request.userId, request.brandId, newToken)
      token.accessToken = newToken.accessToken
    }

    // Get Facebook Page ID from metadata
    const pageId = request.metadata?.pageId
    if (!pageId) {
      throw new Error('Facebook Page ID not found in metadata')
    }

    // Get Page Access Token
    const pageAccessToken = await getPageAccessToken(pageId, token.accessToken)

    // Publish to Facebook
    const result = await publishToFacebook(
      pageId,
      pageAccessToken,
      request.content
    )

    // Update job state with success
    await updateJobState(jobId, 'completed', {
      ...request,
      result,
    })

    // Send success event
    await sendEvent('postolio.publisher.facebook', 'post.published', {
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      brandId: request.brandId,
      userId: request.userId,
      platform: 'facebook',
      postId: result.id,
      permalink: result.permalink_url,
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
    await sendEvent('postolio.publisher.facebook', 'post.failed', {
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      brandId: request.brandId,
      userId: request.userId,
      platform: 'facebook',
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

async function refreshFacebookToken(currentToken: string): Promise<any> {
  // Facebook uses long-lived tokens that last 60 days
  // They can be exchanged for new long-lived tokens
  
  try {
    const appId = process.env.FACEBOOK_APP_ID
    const appSecret = process.env.FACEBOOK_APP_SECRET
    
    if (!appId || !appSecret) {
      throw new Error('Facebook app credentials not configured')
    }

    // Exchange for long-lived token
    const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: currentToken,
      },
    })

    return {
      accessToken: response.data.access_token,
      expiresIn: response.data.expires_in,
    }
  } catch (error) {
    console.error('Token refresh failed:', error)
    throw new Error('Failed to refresh Facebook token')
  }
}

async function storeRefreshedToken(userId: string, brandId: string, token: any): Promise<void> {
  // This would normally call back to the Token Service API
  // For now, we'll skip this as it requires more setup
  console.log('Would store refreshed token:', { userId, brandId, token })
}

async function getPageAccessToken(pageId: string, userAccessToken: string): Promise<string> {
  try {
    // Get page access token from user token
    const response = await axios.get(`https://graph.facebook.com/v18.0/${pageId}`, {
      params: {
        fields: 'access_token',
        access_token: userAccessToken,
      },
    })

    if (!response.data.access_token) {
      throw new Error('Failed to get page access token')
    }

    return response.data.access_token
  } catch (error) {
    console.error('Failed to get page access token:', error)
    throw new Error('Failed to get Facebook page access token')
  }
}

async function publishToFacebook(
  pageId: string,
  pageAccessToken: string,
  content: PublishRequest['content']
): Promise<FacebookPostResponse> {
  try {
    const message = formatMessage(content.caption, content.hashtags)
    
    let endpoint = `https://graph.facebook.com/v18.0/${pageId}/feed`
    let params: any = {
      message: message,
      access_token: pageAccessToken,
    }

    // Handle media posts differently
    if (content.mediaUrl) {
      // For photos, use the photos endpoint
      endpoint = `https://graph.facebook.com/v18.0/${pageId}/photos`
      params = {
        url: content.mediaUrl,
        caption: message,
        access_token: pageAccessToken,
      }
    }

    // Create the post
    const response = await axios.post(endpoint, null, { params })

    // Get the post details to retrieve permalink
    let postId = response.data.id
    let permalink = null

    // For photo posts, the response contains post_id
    if (response.data.post_id) {
      postId = response.data.post_id
    }

    // Fetch the permalink
    try {
      const postDetailsResponse = await axios.get(
        `https://graph.facebook.com/v18.0/${postId}`,
        {
          params: {
            fields: 'permalink_url',
            access_token: pageAccessToken,
          },
        }
      )
      permalink = postDetailsResponse.data.permalink_url
    } catch (permalinkError) {
      console.warn('Could not fetch permalink:', permalinkError)
    }

    return {
      id: postId,
      post_id: response.data.post_id,
      permalink_url: permalink,
    }

  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError
      console.error('Facebook API error:', {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
      })
      
      // Handle rate limiting
      if (axiosError.response?.status === 429) {
        throw new Error('Facebook API rate limit exceeded')
      }

      // Handle permission errors
      if (axiosError.response?.status === 403) {
        const errorData = axiosError.response?.data as any
        if (errorData?.error?.code === 200) {
          throw new Error('Facebook: Missing publish_pages permission')
        }
      }
      
      // Handle other API errors
      const errorMessage = (axiosError.response?.data as any)?.error?.message || 'Facebook API error'
      throw new Error(errorMessage)
    }
    
    throw error
  }
}

function formatMessage(caption: string, hashtags: string[]): string {
  // Facebook best practices:
  // - Maximum 63,206 characters for posts
  // - Hashtags are less effective than on Instagram
  // - Focus on engaging content
  
  const hashtagString = hashtags
    .slice(0, 5) // Limit hashtags on Facebook
    .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
    .join(' ')
  
  const fullMessage = hashtagString ? `${caption}\n\n${hashtagString}` : caption
  
  // Truncate if too long (though unlikely to hit this limit)
  if (fullMessage.length > 63206) {
    return fullMessage.substring(0, 63203) + '...'
  }
  
  return fullMessage
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