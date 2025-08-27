import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms'
import { createHash } from 'crypto'
import { z } from 'zod'
import { RateLimiter } from '../../services/rate-limiter'

// Initialize clients outside handler for connection reuse across invocations
const dynamoClient = new DynamoDBClient({
  maxAttempts: 3,
  retryMode: 'adaptive',  // Adaptive retry with automatic backoff
})

const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    convertEmptyValues: false,
    removeUndefinedValues: true,
    convertClassInstanceToMap: false
  }
})

const kmsClient = new KMSClient({
  maxAttempts: 3,
  retryMode: 'adaptive'
})

const rateLimiter = RateLimiter.getInstance()

const TOKEN_TABLE_NAME = process.env.TOKEN_TABLE_NAME!
const KMS_KEY_ID = process.env.KMS_KEY_ID!

interface OAuthToken {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  platform: string
  userId: string
  brandId: string
  metadata?: Record<string, any>
}

interface StoreTokenRequest {
  userId: string
  brandId: string
  platform: string
  accessToken: string
  refreshToken?: string
  expiresAt: number
  metadata?: Record<string, any>
}

// Zod validation schema for StoreTokenRequest
const StoreTokenRequestSchema = z.object({
  userId: z.string().min(1).max(100),
  brandId: z.string().min(1).max(100),
  platform: z.enum(['instagram', 'facebook', 'linkedin', 'tiktok', 'twitter']),
  accessToken: z.string().min(10).max(10000),
  refreshToken: z.string().min(10).max(10000).optional(),
  expiresAt: z.number().positive().int(),
  metadata: z.record(z.any()).optional()
})

// Helper function to get safe headers for logging (allowlist approach)
function getSafeHeadersForLogging(headers: { [key: string]: string | undefined }): { [key: string]: string | undefined } {
  // Only include explicitly safe headers in logs
  const SAFE_HEADERS = [
    'content-type',
    'accept',
    'user-agent',
    'x-correlation-id',
    'x-request-id',
    'cloudfront-viewer-country',
    'cloudfront-is-mobile-viewer'
  ];
  
  const safeHeaders: { [key: string]: string | undefined } = {};
  for (const safeName of SAFE_HEADERS) {
    for (const key in headers) {
      if (key.toLowerCase() === safeName) {
        safeHeaders[key] = headers[key];
        break;
      }
    }
  }
  return safeHeaders;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Token Service Lambda invoked', { 
    method: event.httpMethod,
    path: event.path,
    headers: getSafeHeadersForLogging(event.headers)
  })

  // IAM Authentication validation
  // This Lambda should be invoked via API Gateway with IAM authorization
  // or directly via Lambda with proper IAM roles
  if (!event.requestContext?.identity?.userArn && !event.requestContext?.authorizer) {
    console.error('Unauthorized request - missing IAM authentication')
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized - IAM authentication required' }),
    }
  }

  // Extract caller identity for audit logging
  const callerIdentity = event.requestContext?.identity?.userArn || 
                         event.requestContext?.authorizer?.principalId || 
                         'unknown'
  console.log('Authenticated caller:', callerIdentity)

  // Extract user information for rate limiting
  const sourceIp = event.requestContext?.identity?.sourceIp || event.headers['X-Forwarded-For'] || 'unknown'
  const userId = event.headers['x-user-id'] || callerIdentity
  const userTier = event.headers['x-user-tier'] || 'default'
  
  // Apply rate limiting
  const rateLimitResult = await rateLimiter.checkUserRateLimit(
    userId,
    'token-service',
    userTier
  )
  
  if (!rateLimitResult.allowed) {
    console.warn('Rate limit exceeded', { 
      userId, 
      sourceIp, 
      remainingTokens: rateLimitResult.remainingTokens,
      retryAfterMs: rateLimitResult.retryAfterMs
    })
    
    return {
      statusCode: 429,
      headers: {
        'Retry-After': String(Math.ceil(rateLimitResult.retryAfterMs! / 1000)),
        'X-RateLimit-Remaining': String(rateLimitResult.remainingTokens),
        'X-RateLimit-Reset': String(Math.floor(rateLimitResult.nextRefillAt / 1000)),
      },
      body: JSON.stringify({ 
        error: 'Rate limit exceeded',
        message: rateLimitResult.reason,
        retryAfterSeconds: Math.ceil(rateLimitResult.retryAfterMs! / 1000)
      }),
    }
  }
  
  // Also apply IP-based rate limiting for additional protection
  const ipRateLimitResult = await rateLimiter.checkIPRateLimit(
    sourceIp,
    'token-service',
    userTier
  )
  
  if (!ipRateLimitResult.allowed) {
    console.warn('IP rate limit exceeded', { 
      sourceIp,
      remainingTokens: ipRateLimitResult.remainingTokens 
    })
    
    return {
      statusCode: 429,
      headers: {
        'Retry-After': String(Math.ceil(ipRateLimitResult.retryAfterMs! / 1000)),
        'X-RateLimit-Remaining': String(ipRateLimitResult.remainingTokens),
      },
      body: JSON.stringify({ 
        error: 'Rate limit exceeded',
        message: 'Too many requests from this IP address'
      }),
    }
  }

  try {
    const method = event.httpMethod
    const path = event.path

    // Route handling
    if (method === 'POST' && path === '/tokens') {
      return await storeToken(event)
    } else if (method === 'GET' && path.match(/^\/tokens\/[^\/]+\/[^\/]+$/)) {
      return await getToken(event)
    } else if (method === 'DELETE' && path.match(/^\/tokens\/[^\/]+\/[^\/]+$/)) {
      return await deleteToken(event)
    } else {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Route not found' }),
      }
    }
  } catch (error) {
    console.error('Token Service error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
    }
  }
}

async function storeToken(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Request body is required' }),
    }
  }

  // Parse and validate request with Zod schema
  let request: StoreTokenRequest
  try {
    const parsed = JSON.parse(event.body)
    request = StoreTokenRequestSchema.parse(parsed)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Invalid request data',
          details: error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        }),
      }
    }
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON in request body' }),
    }
  }

  try {
    // Encrypt tokens with KMS
    const encryptedAccessToken = await encryptData(request.accessToken)
    const encryptedRefreshToken = request.refreshToken 
      ? await encryptData(request.refreshToken)
      : null

    // Store in DynamoDB
    const item = {
      pk: `${request.userId}#${request.platform}`,
      sk: request.brandId,
      platform: request.platform,
      encryptedAccessToken,
      encryptedRefreshToken,
      expiresAt: request.expiresAt,
      lastRefreshed: new Date().toISOString(),
      metadata: request.metadata || {},
      ttl: Math.floor(request.expiresAt / 1000), // DynamoDB TTL in seconds
    }

    await docClient.send(new PutCommand({
      TableName: TOKEN_TABLE_NAME,
      Item: item,
    }))

    return {
      statusCode: 201,
      body: JSON.stringify({ 
        success: true,
        message: 'Token stored successfully',
        tokenId: `${request.userId}#${request.platform}#${request.brandId}`
      }),
    }
  } catch (error) {
    console.error('Error storing token:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to store token',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
    }
  }
}

async function getToken(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const pathParams = event.path.split('/')
  const userId = pathParams[2]
  const platform = pathParams[3]
  const brandId = event.queryStringParameters?.brandId

  if (!brandId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'brandId query parameter is required' }),
    }
  }

  try {
    const result = await docClient.send(new GetCommand({
      TableName: TOKEN_TABLE_NAME,
      Key: {
        pk: `${userId}#${platform}`,
        sk: brandId,
      },
    }))

    if (!result.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Token not found' }),
      }
    }

    // Decrypt tokens
    const accessToken = await decryptData(result.Item.encryptedAccessToken)
    const refreshToken = result.Item.encryptedRefreshToken 
      ? await decryptData(result.Item.encryptedRefreshToken)
      : null

    // Check if token needs refresh (7 days before expiry)
    const expiryTime = result.Item.expiresAt
    const refreshThreshold = Date.now() + (7 * 24 * 60 * 60 * 1000)
    const needsRefresh = expiryTime < refreshThreshold

    return {
      statusCode: 200,
      body: JSON.stringify({
        accessToken,
        refreshToken,
        expiresAt: result.Item.expiresAt,
        platform: result.Item.platform,
        needsRefresh,
        lastRefreshed: result.Item.lastRefreshed,
        metadata: result.Item.metadata,
      }),
    }
  } catch (error) {
    console.error('Error getting token:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to retrieve token',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
    }
  }
}

async function deleteToken(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const pathParams = event.path.split('/')
  const userId = pathParams[2]
  const platform = pathParams[3]
  const brandId = event.queryStringParameters?.brandId

  if (!brandId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'brandId query parameter is required' }),
    }
  }

  try {
    await docClient.send(new DeleteCommand({
      TableName: TOKEN_TABLE_NAME,
      Key: {
        pk: `${userId}#${platform}`,
        sk: brandId,
      },
    }))

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true,
        message: 'Token deleted successfully' 
      }),
    }
  } catch (error) {
    console.error('Error deleting token:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to delete token',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
    }
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