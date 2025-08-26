import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms'
import { createHash } from 'crypto'

const dynamoClient = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(dynamoClient)
const kmsClient = new KMSClient({})

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

// Helper function to filter sensitive headers
function filterSensitiveHeaders(headers: { [key: string]: string | undefined }): { [key: string]: string | undefined } {
  const SENSITIVE_HEADER_NAMES = [
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-amz-security-token',
    'proxy-authorization',
    'x-auth-token',
    'x-access-token'
  ];
  const filtered: { [key: string]: string | undefined } = {};
  for (const key in headers) {
    if (!SENSITIVE_HEADER_NAMES.includes(key.toLowerCase())) {
      filtered[key] = headers[key];
    }
  }
  return filtered;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Token Service Lambda invoked', { 
    method: event.httpMethod,
    path: event.path,
    headers: filterSensitiveHeaders(event.headers)
  })

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

  const request: StoreTokenRequest = JSON.parse(event.body)
  
  // Validate required fields
  if (!request.userId || !request.brandId || !request.platform || !request.accessToken) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields' }),
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