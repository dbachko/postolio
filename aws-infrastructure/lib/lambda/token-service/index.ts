/**
 * Token Service Lambda Handler
 * Manages OAuth tokens with encryption and automatic refresh
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const logger = new Logger({ serviceName: 'token-service' });
const metrics = new Metrics({ namespace: 'TokenService', serviceName: 'token-service' });

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const kmsClient = new KMSClient({});

const TABLE_NAME = process.env.TOKENS_TABLE!;
const KMS_KEY_ID = process.env.KMS_KEY_ID!;
const API_KEY = process.env.TOKEN_SERVICE_API_KEY;

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  metadata?: Record<string, any>;
}

interface StoreTokenRequest {
  userId: string;
  brandId: string;
  platform: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  metadata?: Record<string, any>;
}

interface GetTokenRequest {
  userId: string;
  brandId: string;
  platform: string;
}

// API Key validation
function validateApiKey(event: APIGatewayProxyEvent): boolean {
  if (!API_KEY) {
    logger.warn('API_KEY not configured - allowing request in dev mode');
    return true;
  }
  
  const providedKey = event.headers['x-api-key'] || event.headers['X-API-Key'];
  return providedKey === API_KEY;
}

// Encrypt token using KMS
async function encryptToken(token: string): Promise<string> {
  const response = await kmsClient.send(new EncryptCommand({
    KeyId: KMS_KEY_ID,
    Plaintext: Buffer.from(token),
  }));
  
  return Buffer.from(response.CiphertextBlob!).toString('base64');
}

// Decrypt token using KMS
async function decryptToken(encryptedToken: string): Promise<string> {
  const response = await kmsClient.send(new DecryptCommand({
    CiphertextBlob: Buffer.from(encryptedToken, 'base64'),
  }));
  
  return Buffer.from(response.Plaintext!).toString();
}

// Store token in DynamoDB
async function storeToken(data: StoreTokenRequest): Promise<void> {
  const encryptedAccessToken = await encryptToken(data.accessToken);
  const encryptedRefreshToken = data.refreshToken ? await encryptToken(data.refreshToken) : undefined;
  
  const item = {
    pk: `${data.userId}#${data.platform}`,
    sk: data.brandId,
    accessToken: encryptedAccessToken,
    refreshToken: encryptedRefreshToken,
    expiresAt: data.expiresAt,
    metadata: data.metadata,
    platform: data.platform,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ttl: Math.floor(new Date(data.expiresAt).getTime() / 1000) + (30 * 24 * 60 * 60), // 30 days after expiry
  };
  
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
  }));
  
  logger.info('Token stored successfully', { userId: data.userId, brandId: data.brandId, platform: data.platform });
  metrics.addMetric('TokensStored', MetricUnit.Count, 1);
}

// Get token from DynamoDB
async function getToken(data: GetTokenRequest): Promise<TokenData | null> {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      pk: `${data.userId}#${data.platform}`,
      sk: data.brandId,
    },
  }));
  
  if (!result.Item) {
    logger.info('Token not found', { ...data });
    return null;
  }
  
  // Check if token needs refresh (within 7 days of expiry)
  const expiryTime = new Date(result.Item.expiresAt).getTime();
  const refreshThreshold = Date.now() + (7 * 24 * 60 * 60 * 1000);
  
  if (expiryTime < refreshThreshold && result.Item.refreshToken) {
    logger.info('Token needs refresh', { ...data, expiresAt: result.Item.expiresAt });
    // In production, trigger refresh Lambda here
    metrics.addMetric('TokensNeedingRefresh', MetricUnit.Count, 1);
  }
  
  const decryptedAccessToken = await decryptToken(result.Item.accessToken);
  
  metrics.addMetric('TokensRetrieved', MetricUnit.Count, 1);
  
  return {
    accessToken: decryptedAccessToken,
    refreshToken: result.Item.refreshToken, // Keep encrypted for security
    expiresAt: result.Item.expiresAt,
    metadata: result.Item.metadata,
  };
}

// Delete token from DynamoDB
async function deleteToken(data: GetTokenRequest): Promise<void> {
  await docClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      pk: `${data.userId}#${data.platform}`,
      sk: data.brandId,
    },
  }));
  
  logger.info('Token deleted', { ...data });
  metrics.addMetric('TokensDeleted', MetricUnit.Count, 1);
}

// Main Lambda handler
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logger.info('Request received', { path: event.path, method: event.httpMethod });
  
  // Validate API key
  if (!validateApiKey(event)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }
  
  try {
    const path = event.path;
    const method = event.httpMethod;
    
    // Store token
    if (path === '/tokens' && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      
      // Check if getting or storing
      if (body.accessToken) {
        // Store token
        await storeToken(body as StoreTokenRequest);
        return {
          statusCode: 200,
          body: JSON.stringify({ success: true }),
        };
      } else {
        // Get token
        const token = await getToken(body as GetTokenRequest);
        if (!token) {
          return {
            statusCode: 404,
            body: JSON.stringify({ error: 'Token not found' }),
          };
        }
        return {
          statusCode: 200,
          body: JSON.stringify(token),
        };
      }
    }
    
    // Delete token
    if (path === '/tokens' && method === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      await deleteToken(body as GetTokenRequest);
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true }),
      };
    }
    
    // Refresh token (placeholder for now)
    if (path === '/tokens/refresh' && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      // In production, implement platform-specific refresh logic
      logger.info('Token refresh requested', body);
      return {
        statusCode: 501,
        body: JSON.stringify({ error: 'Refresh not yet implemented' }),
      };
    }
    
    // Health check
    if (path === '/health' && method === 'GET') {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          status: 'healthy',
          service: 'token-service',
          timestamp: new Date().toISOString(),
        }),
      };
    }
    
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Not found' }),
    };
    
  } catch (error) {
    logger.error('Error processing request', error as Error);
    metrics.addMetric('Errors', MetricUnit.Count, 1);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  } finally {
    metrics.publishStoredMetrics();
  }
};
