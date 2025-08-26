import { ScheduledEvent, Context } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms'
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import axios from 'axios'
import { getSecretManager } from '../shared/secrets-manager'

const dynamoClient = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(dynamoClient)
const kmsClient = new KMSClient({})
const eventBridgeClient = new EventBridgeClient({})

const TOKEN_TABLE_NAME = process.env.TOKEN_TABLE_NAME!
const KMS_KEY_ID = process.env.KMS_KEY_ID!
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!
const ENVIRONMENT = process.env.ENVIRONMENT!

interface TokenRecord {
  pk: string // userId#platform
  sk: string // brandId
  platform: string
  encryptedAccessToken: string
  encryptedRefreshToken?: string
  expiresAt: number
  lastRefreshed: string
  metadata?: Record<string, any>
}

interface RefreshResult {
  accessToken: string
  refreshToken?: string
  expiresIn: number
}

export const handler = async (event: ScheduledEvent, context: Context): Promise<void> => {
  console.log('Token Rotation Lambda invoked', {
    time: event.time,
    requestId: context.requestId,
  })

  try {
    // Get all tokens that expire within the next 7 days
    const expiringTokens = await getExpiringTokens()
    console.log(`Found ${expiringTokens.length} tokens expiring soon`)

    const results = {
      success: 0,
      failed: 0,
      skipped: 0,
    }

    // Process each token
    for (const token of expiringTokens) {
      try {
        const refreshed = await refreshToken(token)
        if (refreshed) {
          results.success++
        } else {
          results.skipped++
        }
      } catch (error) {
        console.error('Failed to refresh token:', {
          pk: token.pk,
          sk: token.sk,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        results.failed++

        // Send failure event
        await sendEvent('postolio.token-rotation', 'token.refresh.failed', {
          userId: token.pk.split('#')[0],
          platform: token.platform,
          brandId: token.sk,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        })
      }
    }

    console.log('Token rotation completed:', results)

    // Send summary event
    await sendEvent('postolio.token-rotation', 'rotation.completed', {
      ...results,
      totalProcessed: expiringTokens.length,
      timestamp: new Date().toISOString(),
    })

  } catch (error) {
    console.error('Token rotation error:', error)
    
    // Send error event
    await sendEvent('postolio.token-rotation', 'rotation.error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    })
    
    throw error
  }
}

async function getExpiringTokens(): Promise<TokenRecord[]> {
  const expiringTokens: TokenRecord[] = []
  const sevenDaysFromNow = Date.now() + (7 * 24 * 60 * 60 * 1000)
  
  let lastEvaluatedKey: any = undefined

  // Scan the table for expiring tokens
  // In production, this should use a GSI on expiresAt for better performance
  do {
    const result = await docClient.send(new ScanCommand({
      TableName: TOKEN_TABLE_NAME,
      FilterExpression: 'expiresAt < :threshold AND expiresAt > :now',
      ExpressionAttributeValues: {
        ':threshold': sevenDaysFromNow,
        ':now': Date.now(),
      },
      ExclusiveStartKey: lastEvaluatedKey,
    }))

    if (result.Items) {
      expiringTokens.push(...result.Items as TokenRecord[])
    }

    lastEvaluatedKey = result.LastEvaluatedKey
  } while (lastEvaluatedKey)

  return expiringTokens
}

async function refreshToken(token: TokenRecord): Promise<boolean> {
  // Skip if no refresh token
  if (!token.encryptedRefreshToken) {
    console.log('No refresh token available, skipping:', {
      pk: token.pk,
      platform: token.platform,
    })
    return false
  }

  // Decrypt tokens
  const refreshToken = await decryptData(token.encryptedRefreshToken)
  
  // Get platform-specific metadata
  const metadata = token.metadata || {}
  
  // Refresh based on platform
  let refreshResult: RefreshResult | null = null
  
  switch (token.platform) {
    case 'instagram':
      refreshResult = await refreshInstagramToken(refreshToken)
      break
    case 'facebook':
      refreshResult = await refreshFacebookToken(refreshToken, metadata)
      break
    case 'linkedin':
      refreshResult = await refreshLinkedInToken(refreshToken, metadata)
      break
    case 'tiktok':
      refreshResult = await refreshTikTokToken(refreshToken, metadata)
      break
    default:
      console.warn('Unknown platform for token refresh:', token.platform)
      return false
  }

  if (!refreshResult) {
    return false
  }

  // Encrypt new tokens
  const encryptedAccessToken = await encryptData(refreshResult.accessToken)
  const encryptedRefreshToken = refreshResult.refreshToken
    ? await encryptData(refreshResult.refreshToken)
    : token.encryptedRefreshToken // Keep old refresh token if not returned

  // Calculate new expiry
  const newExpiresAt = Date.now() + (refreshResult.expiresIn * 1000)

  // Update token in database
  await docClient.send(new UpdateCommand({
    TableName: TOKEN_TABLE_NAME,
    Key: {
      pk: token.pk,
      sk: token.sk,
    },
    UpdateExpression: 'SET encryptedAccessToken = :accessToken, encryptedRefreshToken = :refreshToken, expiresAt = :expiresAt, lastRefreshed = :lastRefreshed',
    ExpressionAttributeValues: {
      ':accessToken': encryptedAccessToken,
      ':refreshToken': encryptedRefreshToken,
      ':expiresAt': newExpiresAt,
      ':lastRefreshed': new Date().toISOString(),
    },
  }))

  // Send success event
  await sendEvent('postolio.token-rotation', 'token.refreshed', {
    userId: token.pk.split('#')[0],
    platform: token.platform,
    brandId: token.sk,
    newExpiresAt,
    timestamp: new Date().toISOString(),
  })

  return true
}

async function refreshInstagramToken(accessToken: string): Promise<RefreshResult> {
  // Instagram uses long-lived tokens that need to be refreshed every 60 days
  try {
    const response = await axios.get('https://graph.instagram.com/refresh_access_token', {
      params: {
        grant_type: 'ig_refresh_token',
        access_token: accessToken,
      },
    })

    return {
      accessToken: response.data.access_token,
      expiresIn: response.data.expires_in || 5184000, // 60 days default
    }
  } catch (error) {
    console.error('Instagram token refresh failed:', error)
    throw new Error('Failed to refresh Instagram token')
  }
}

async function refreshFacebookToken(currentToken: string, metadata: Record<string, any>): Promise<RefreshResult> {
  try {
    // Get credentials from Secrets Manager (not from metadata for security)
    const secretManager = getSecretManager()
    const secrets = await secretManager.getPlatformSecrets()
    
    const appId = secrets.FACEBOOK_APP_ID
    const appSecret = secrets.FACEBOOK_APP_SECRET
    
    if (!appId || !appSecret) {
      throw new Error('Facebook app credentials not available')
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
      expiresIn: response.data.expires_in || 5184000, // 60 days default
    }
  } catch (error) {
    console.error('Facebook token refresh failed:', error)
    throw new Error('Failed to refresh Facebook token')
  }
}

async function refreshLinkedInToken(refreshToken: string, metadata: Record<string, any>): Promise<RefreshResult> {
  try {
    // Get credentials from Secrets Manager (not from metadata for security)
    const secretManager = getSecretManager()
    const secrets = await secretManager.getPlatformSecrets()
    
    const clientId = secrets.LINKEDIN_CLIENT_ID
    const clientSecret = secrets.LINKEDIN_CLIENT_SECRET
    
    if (!clientId || !clientSecret) {
      throw new Error('LinkedIn client credentials not available in Secrets Manager')
    }

    const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
      params: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token || refreshToken,
      expiresIn: response.data.expires_in || 5184000, // 60 days default
    }
  } catch (error) {
    console.error('LinkedIn token refresh failed:', error)
    throw new Error('Failed to refresh LinkedIn token')
  }
}

async function refreshTikTokToken(refreshToken: string, metadata: Record<string, any>): Promise<RefreshResult> {
  try {
    // Get credentials from Secrets Manager (not from metadata for security)
    const secretManager = getSecretManager()
    const secrets = await secretManager.getPlatformSecrets()
    
    const clientKey = secrets.TIKTOK_CLIENT_KEY
    const clientSecret = secrets.TIKTOK_CLIENT_SECRET
    
    if (!clientKey || !clientSecret) {
      throw new Error('TikTok client credentials not available in Secrets Manager')
    }

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
      expiresIn: response.data.expires_in || 86400, // 1 day default for TikTok
    }
  } catch (error) {
    console.error('TikTok token refresh failed:', error)
    throw new Error('Failed to refresh TikTok token')
  }
}

async function encryptData(data: string): Promise<string> {
  const result = await kmsClient.send(new EncryptCommand({
    KeyId: KMS_KEY_ID,
    Plaintext: Buffer.from(data),
  }))

  return Buffer.from(result.CiphertextBlob!).toString('base64')
}

async function decryptData(encryptedData: string): Promise<string> {
  const result = await kmsClient.send(new DecryptCommand({
    CiphertextBlob: Buffer.from(encryptedData, 'base64'),
  }))

  return Buffer.from(result.Plaintext!).toString()
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