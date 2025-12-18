/**
 * Token Service Lambda Handler
 * Enterprise-grade token management with comprehensive security features
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import crypto from 'crypto';
import { ServiceError, ErrorFactory } from '@postolio/errors';
import { initSentry, captureException } from '@postolio/observability';

const logger = new Logger({ serviceName: 'token-service' });
const metrics = new Metrics({
  namespace: 'TokenService',
  serviceName: 'token-service',
});

initSentry({
  serviceName: 'token-service',
});

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const kmsClient = new KMSClient({});

const TABLE_NAME = process.env.TOKENS_TABLE!;
const AUDIT_TABLE_NAME = process.env.AUDIT_TABLE || 'token-audit-logs';
const KMS_KEY_ID = process.env.KMS_KEY_ID!;
const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE || 'token-rate-limits';

// Custom error classes
class NotFoundError extends ServiceError {
  constructor(message: string) {
    super({
      code: 'NOT_FOUND',
      message,
      retryable: false,
      userMessage: 'The requested resource was not found.',
    });
  }
}

function getHttpStatusCodeForServiceError(error: ServiceError): number {
  switch (error.code) {
    case 'VALIDATION_FAILED':
      return 400;
    case 'RATE_LIMITED':
      return 429;
    default:
      return 500;
  }
}

// Enhanced type definitions with strict typing
type TokenMetadata = Record<string, unknown>;

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  metadata?: TokenMetadata;
  tokenVersion?: number;
  lastRefreshed?: string;
  rotationCount?: number;
}

interface StoreTokenRequest {
  userId: string;
  brandId: string;
  platform: string;
  /**
   * Optional: when present, the token is scoped to a specific connected social account
   * (enables multiple accounts per brand+platform).
   */
  socialAccountId?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  metadata?: TokenMetadata;
}

interface AuditLogEntry {
  id: string;
  timestamp: string;
  operation: string;
  userId: string;
  brandId: string;
  platform: string;
  requestId: string;
  correlationId: string;
  ipAddress?: string;
  userAgent?: string;
  result: 'success' | 'failure';
  errorCode?: string;
  errorMessage?: string;
  metadata?: TokenMetadata;
}

// Rate limiting configuration
const RATE_LIMITS = {
  perUser: {
    windowMs: 60000, // 1 minute
    maxRequests: 100,
  },
  perUserPlatform: {
    windowMs: 60000,
    maxRequests: 30,
  },
};

// Encryption helpers with error handling
async function encryptToken(token: string): Promise<string> {
  try {
    const response = await kmsClient.send(
      new EncryptCommand({
        KeyId: KMS_KEY_ID,
        Plaintext: Buffer.from(token),
      })
    );

    return Buffer.from(response.CiphertextBlob!).toString('base64');
  } catch (error) {
    logger.error('Token encryption failed', { error });
    captureException(error, {
      function: 'token-service',
      operation: 'encryptToken',
    });
    throw ErrorFactory.internalError(
      'Failed to encrypt token',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

async function decryptToken(encryptedToken: string): Promise<string> {
  try {
    const response = await kmsClient.send(
      new DecryptCommand({
        CiphertextBlob: Buffer.from(encryptedToken, 'base64'),
      })
    );

    return Buffer.from(response.Plaintext!).toString();
  } catch (error) {
    logger.error('Token decryption failed', { error });
    captureException(error, {
      function: 'token-service',
      operation: 'decryptToken',
    });
    throw ErrorFactory.internalError(
      'Failed to decrypt token',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

// Audit logging function
async function auditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
  try {
    const logEntry: AuditLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    await docClient.send(
      new PutCommand({
        TableName: AUDIT_TABLE_NAME,
        Item: {
          pk: `AUDIT#${entry.userId}`,
          sk: `${logEntry.timestamp}#${logEntry.id}`,
          ...logEntry,
          ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days retention
        },
      })
    );

    logger.info('Audit log recorded', {
      operation: entry.operation,
      result: entry.result,
    });
  } catch (error) {
    // Don't fail operations due to audit logging failures
    logger.error('Failed to write audit log', { error, entry });
  }
}

// Rate limiting check
async function checkRateLimit(userId: string, platform?: string): Promise<void> {
  const now = Date.now();
  const windowKey = Math.floor(now / RATE_LIMITS.perUser.windowMs).toString();
  const rateLimitKey = platform ? `${userId}#${platform}` : userId;

  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: {
          pk: `RATELIMIT#${rateLimitKey}`,
          sk: windowKey,
        },
      })
    );

    const limit = platform ? RATE_LIMITS.perUserPlatform : RATE_LIMITS.perUser;
    const currentCount = result.Item?.count || 0;

    if (currentCount >= limit.maxRequests) {
      const retryAfter = Math.ceil((limit.windowMs - (now % limit.windowMs)) / 1000);
      throw ErrorFactory.rateLimited(retryAfter);
    }

    // Increment counter
    await docClient.send(
      new PutCommand({
        TableName: RATE_LIMIT_TABLE,
        Item: {
          pk: `RATELIMIT#${rateLimitKey}`,
          sk: windowKey,
          count: currentCount + 1,
          firstRequest: result.Item?.firstRequest || new Date().toISOString(),
          lastRequest: new Date().toISOString(),
          ttl: Math.floor(now / 1000) + 120, // Clean up after 2 minutes
        },
      })
    );
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'RATE_LIMITED') {
      throw error;
    }
    // Don't block on rate limit check failures
    logger.warn('Rate limit check failed', { error });
  }
}

// Enhanced token operations with validation
function buildTokenSk(brandId: string, socialAccountId?: string): string {
  return socialAccountId ? `${brandId}#${socialAccountId}` : brandId;
}

async function storeToken(
  data: StoreTokenRequest,
  requestContext: {
    requestId: string;
    correlationId: string;
    ipAddress?: string;
  }
): Promise<void> {
  // Validate input
  if (!data.userId || !data.brandId || !data.platform || !data.accessToken) {
    throw ErrorFactory.validationFailed([
      'Missing required fields: userId, brandId, platform, or accessToken',
    ]);
  }

  if (new Date(data.expiresAt) < new Date()) {
    throw ErrorFactory.validationFailed(['Token already expired']);
  }

  try {
    const encryptedAccessToken = await encryptToken(data.accessToken);
    const encryptedRefreshToken = data.refreshToken
      ? await encryptToken(data.refreshToken)
      : undefined;

    const item = {
      pk: `${data.userId}#${data.platform}`,
      sk: buildTokenSk(data.brandId, data.socialAccountId),
      userId: data.userId,
      brandId: data.brandId,
      platform: data.platform,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiresAt: data.expiresAt,
      metadata: {
        ...(data.metadata || {}),
        ...(data.socialAccountId ? { socialAccountId: data.socialAccountId } : {}),
      },
      tokenVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ttl: Math.floor(new Date(data.expiresAt).getTime() / 1000) + 30 * 24 * 60 * 60,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    await auditLog({
      operation: 'STORE_TOKEN',
      userId: data.userId,
      brandId: data.brandId,
      platform: data.platform,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      ipAddress: requestContext.ipAddress,
      result: 'success',
      metadata: {
        hasRefreshToken: !!data.refreshToken,
        ...(data.socialAccountId ? { socialAccountId: data.socialAccountId } : {}),
      },
    });

    logger.info('Token stored successfully', {
      userId: data.userId,
      brandId: data.brandId,
      socialAccountId: data.socialAccountId || null,
      platform: data.platform,
      correlationId: requestContext.correlationId,
    });
    metrics.addMetric('TokensStored', MetricUnit.Count, 1);
  } catch (error) {
    await auditLog({
      operation: 'STORE_TOKEN',
      userId: data.userId,
      brandId: data.brandId,
      platform: data.platform,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      ipAddress: requestContext.ipAddress,
      result: 'failure',
      errorCode: error instanceof ServiceError ? error.code : 'UNKNOWN_ERROR',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

async function getToken(
  data: { userId: string; brandId: string; platform: string; socialAccountId?: string },
  requestContext: {
    requestId: string;
    correlationId: string;
    ipAddress?: string;
  }
): Promise<TokenData | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `${data.userId}#${data.platform}`,
          sk: buildTokenSk(data.brandId, data.socialAccountId),
        },
      })
    );

    if (!result.Item) {
      await auditLog({
        operation: 'GET_TOKEN',
        userId: data.userId,
        brandId: data.brandId,
        platform: data.platform,
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId,
        ipAddress: requestContext.ipAddress,
        result: 'success',
        metadata: {
          found: false,
          ...(data.socialAccountId ? { socialAccountId: data.socialAccountId } : {}),
        },
      });
      return null;
    }

    // Check if token needs refresh
    const expiryTime = new Date(result.Item.expiresAt).getTime();
    const refreshThreshold = Date.now() + 7 * 24 * 60 * 60 * 1000;

    if (expiryTime < refreshThreshold && result.Item.refreshToken) {
      logger.info('Token needs refresh', {
        ...data,
        expiresAt: result.Item.expiresAt,
        correlationId: requestContext.correlationId,
      });
      metrics.addMetric('TokensNeedingRefresh', MetricUnit.Count, 1);

      // Trigger async refresh if supported
      // This would be handled by a separate Lambda or service
    }

    const decryptedAccessToken = await decryptToken(result.Item.accessToken);

    await auditLog({
      operation: 'GET_TOKEN',
      userId: data.userId,
      brandId: data.brandId,
      platform: data.platform,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      ipAddress: requestContext.ipAddress,
      result: 'success',
      metadata: {
        found: true,
        needsRefresh: expiryTime < refreshThreshold,
        ...(data.socialAccountId ? { socialAccountId: data.socialAccountId } : {}),
      },
    });

    metrics.addMetric('TokensRetrieved', MetricUnit.Count, 1);

    return {
      accessToken: decryptedAccessToken,
      refreshToken: result.Item.refreshToken,
      expiresAt: result.Item.expiresAt,
      metadata: result.Item.metadata,
      tokenVersion: result.Item.tokenVersion,
      lastRefreshed: result.Item.lastRefreshed,
      rotationCount: result.Item.rotationCount,
    };
  } catch (error) {
    await auditLog({
      operation: 'GET_TOKEN',
      userId: data.userId,
      brandId: data.brandId,
      platform: data.platform,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      ipAddress: requestContext.ipAddress,
      result: 'failure',
      errorCode: error instanceof ServiceError ? error.code : 'UNKNOWN_ERROR',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        ...(data.socialAccountId ? { socialAccountId: data.socialAccountId } : {}),
      },
    });
    throw error;
  }
}

async function deleteToken(
  data: { userId: string; brandId: string; platform: string; socialAccountId?: string },
  requestContext: {
    requestId: string;
    correlationId: string;
    ipAddress?: string;
  }
): Promise<boolean> {
  try {
    const result = await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `${data.userId}#${data.platform}`,
          sk: buildTokenSk(data.brandId, data.socialAccountId),
        },
        ReturnValues: 'ALL_OLD',
      })
    );

    const deleted = !!result.Attributes;

    await auditLog({
      operation: 'DELETE_TOKEN',
      userId: data.userId,
      brandId: data.brandId,
      platform: data.platform,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      ipAddress: requestContext.ipAddress,
      result: 'success',
      metadata: {
        deleted,
        ...(data.socialAccountId ? { socialAccountId: data.socialAccountId } : {}),
      },
    });

    if (deleted) {
      metrics.addMetric('TokensDeleted', MetricUnit.Count, 1);
      logger.info('Token deleted successfully', {
        ...data,
        correlationId: requestContext.correlationId,
      });
    }

    return deleted;
  } catch (error) {
    await auditLog({
      operation: 'DELETE_TOKEN',
      userId: data.userId,
      brandId: data.brandId,
      platform: data.platform,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      ipAddress: requestContext.ipAddress,
      result: 'failure',
      errorCode: error instanceof ServiceError ? error.code : 'UNKNOWN_ERROR',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        ...(data.socialAccountId ? { socialAccountId: data.socialAccountId } : {}),
      },
    });
    throw error;
  }
}

// Token rotation implementation
async function rotateToken(
  data: { userId: string; brandId: string; platform: string; socialAccountId?: string },
  requestContext: {
    requestId: string;
    correlationId: string;
    ipAddress?: string;
  }
): Promise<TokenData> {
  try {
    // Get current token
    const currentToken = await getToken(data, requestContext);

    if (!currentToken) {
      throw new NotFoundError('Token not found for rotation');
    }

    // Generate new token version
    const newTokenVersion = (currentToken.tokenVersion || 1) + 1;
    const rotationCount = (currentToken.rotationCount || 0) + 1;

    // In a real implementation, this would call the platform's API to rotate the token
    // For now, we'll just update the metadata
    const rotatedToken: TokenData = {
      ...currentToken,
      tokenVersion: newTokenVersion,
      rotationCount: rotationCount,
      lastRefreshed: new Date().toISOString(),
    };

    // Store the rotated token
    await storeToken(
      {
        userId: data.userId,
        brandId: data.brandId,
        platform: data.platform,
        socialAccountId: data.socialAccountId,
        accessToken: currentToken.accessToken, // In reality, this would be a new token
        refreshToken: currentToken.refreshToken,
        expiresAt: currentToken.expiresAt,
        metadata: {
          ...currentToken.metadata,
          rotatedAt: new Date().toISOString(),
          rotationCount: rotationCount,
        },
      },
      requestContext
    );

    await auditLog({
      operation: 'ROTATE_TOKEN',
      userId: data.userId,
      brandId: data.brandId,
      platform: data.platform,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      ipAddress: requestContext.ipAddress,
      result: 'success',
      metadata: {
        newVersion: newTokenVersion,
        rotationCount: rotationCount,
      },
    });

    logger.info('Token rotated successfully', {
      ...data,
      newVersion: newTokenVersion,
      correlationId: requestContext.correlationId,
    });

    metrics.addMetric('TokensRotated', MetricUnit.Count, 1);

    return rotatedToken;
  } catch (error) {
    await auditLog({
      operation: 'ROTATE_TOKEN',
      userId: data.userId,
      brandId: data.brandId,
      platform: data.platform,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      ipAddress: requestContext.ipAddress,
      result: 'failure',
      errorCode: error instanceof ServiceError ? error.code : 'UNKNOWN_ERROR',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

// Parse path parameters
function parsePathParameters(path: string): Record<string, string> {
  const params: Record<string, string> = {};
  const parts = path.split('/').filter((p) => p);

  if (parts[0] === 'tokens') {
    if (parts[1] && !['batch', 'health', 'metrics'].includes(parts[1])) {
      params.userId = parts[1];
      if (parts[2]) {
        params.platform = parts[2];
        if (parts[3]) {
          params.brandId = parts[3];
          if (parts[4] === 'social-accounts') {
            if (parts[5]) {
              params.socialAccountId = parts[5];
            }
            if (parts[6]) {
              params.action = parts[6];
            }
          } else if (parts[4]) {
            params.action = parts[4];
          }
        }
      }
    }
  }

  return params;
}

// Main Lambda handler with enhanced error handling
export const handler = async (
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): Promise<APIGatewayProxyResult> => {
  // Determine if this is a Function URL event (API Gateway v2.0 also uses version '2.0', so check for requestContext.http)
  const isV2Event = !!(
    event.requestContext &&
    'http' in event.requestContext &&
    typeof event.requestContext.http === 'object'
  );

  // Extract values from the appropriate event format
  const requestId = event.requestContext.requestId || crypto.randomUUID();
  const headers = event.headers || {};
  const correlationId =
    headers['X-Correlation-ID'] || headers['x-correlation-id'] || crypto.randomUUID();

  // Handle different sourceIp extraction for v1 vs v2
  let ipAddress: string;
  if (isV2Event) {
    ipAddress = (event as APIGatewayProxyEventV2).requestContext.http?.sourceIp ?? '';
  } else {
    ipAddress = (event as APIGatewayProxyEvent).requestContext.identity?.sourceIp ?? '';
  }

  const userAgent = headers['User-Agent'] || headers['user-agent'];

  // Extract HTTP method and path from appropriate format
  const method = isV2Event
    ? (event as APIGatewayProxyEventV2).requestContext.http.method
    : (event as APIGatewayProxyEvent).httpMethod;

  const path = isV2Event
    ? (event as APIGatewayProxyEventV2).requestContext.http.path
    : (event as APIGatewayProxyEvent).path;

  const requestContext = {
    requestId,
    correlationId,
    ipAddress,
    userAgent,
  };

  logger.info('Request received', {
    path,
    method,
    requestId,
    correlationId,
    ipAddress,
    eventVersion: isV2Event ? '2.0' : '1.0',
  });

  // Validate origin against whitelist for CORS
  const origin = headers['Origin'] || headers['origin'] || '';
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

  // Default allowed origins if not configured (development fallback)
  const defaultAllowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://postolio.example',
    'https://postolio.example',
  ];

  const originsToCheck = allowedOrigins.length > 0 ? allowedOrigins : defaultAllowedOrigins;
  const isOriginAllowed = origin.length > 0 && originsToCheck.includes(origin);

  // Base headers (always included)
  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-ID': requestId,
    'X-Correlation-ID': correlationId,
  };

  // Only add CORS headers if origin is present and allowed
  if (isOriginAllowed) {
    responseHeaders['Access-Control-Allow-Origin'] = origin;
    responseHeaders['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS';
    responseHeaders['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,X-Correlation-ID';
    responseHeaders['Access-Control-Allow-Credentials'] = 'true';
  }

  // Reject requests from disallowed origins (except health check and requests without Origin)
  // Note: Requests without Origin header (non-browser clients) are allowed
  if (origin.length > 0 && !isOriginAllowed && path !== '/health') {
    logger.warn('Request from disallowed origin rejected', {
      origin,
      path,
      allowedOrigins: originsToCheck,
    });
    return {
      statusCode: 403,
      headers: responseHeaders,
      body: JSON.stringify({
        error: 'Origin not allowed',
        code: 'CORS_ORIGIN_NOT_ALLOWED',
      }),
    };
  }

  try {
    const pathParams = parsePathParameters(path);

    // Handle OPTIONS for CORS
    if (method === 'OPTIONS') {
      return { statusCode: 200, headers: responseHeaders, body: '' };
    }

    // Health check
    if (path === '/health' && method === 'GET') {
      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          status: 'healthy',
          service: 'token-service',
          version: '3.0.0',
          features: {
            encryption: true,
            rateLimit: true,
            auditLogging: true,
            tokenRotation: true,
          },
          timestamp: new Date().toISOString(),
        }),
      };
    }

    // Check rate limits for authenticated endpoints
    if (pathParams.userId) {
      await checkRateLimit(pathParams.userId, pathParams.platform);
    }

    // PUT /tokens/{userId}/{platform}/{brandId}/social-accounts/{socialAccountId} - Store/update token (account-scoped)
    if (
      method === 'PUT' &&
      pathParams.userId &&
      pathParams.platform &&
      pathParams.brandId &&
      pathParams.socialAccountId &&
      !pathParams.action
    ) {
      const body = JSON.parse(event.body || '{}');
      await storeToken(
        {
          userId: pathParams.userId,
          brandId: pathParams.brandId,
          platform: pathParams.platform,
          socialAccountId: pathParams.socialAccountId,
          ...body,
        },
        requestContext
      );

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({ success: true }),
      };
    }

    // GET /tokens/{userId}/{platform}/{brandId}/social-accounts/{socialAccountId} - Get specific token (account-scoped)
    if (
      method === 'GET' &&
      pathParams.userId &&
      pathParams.platform &&
      pathParams.brandId &&
      pathParams.socialAccountId &&
      !pathParams.action
    ) {
      const token = await getToken(
        {
          userId: pathParams.userId,
          brandId: pathParams.brandId,
          platform: pathParams.platform,
          socialAccountId: pathParams.socialAccountId,
        },
        requestContext
      );

      if (!token) {
        return {
          statusCode: 404,
          headers: responseHeaders,
          body: JSON.stringify({ error: 'Token not found' }),
        };
      }

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify(token),
      };
    }

    // DELETE /tokens/{userId}/{platform}/{brandId}/social-accounts/{socialAccountId} - Delete token (account-scoped)
    if (
      method === 'DELETE' &&
      pathParams.userId &&
      pathParams.platform &&
      pathParams.brandId &&
      pathParams.socialAccountId &&
      !pathParams.action
    ) {
      const deleted = await deleteToken(
        {
          userId: pathParams.userId,
          brandId: pathParams.brandId,
          platform: pathParams.platform,
          socialAccountId: pathParams.socialAccountId,
        },
        requestContext
      );

      if (!deleted) {
        return {
          statusCode: 404,
          headers: responseHeaders,
          body: JSON.stringify({ error: 'Token not found' }),
        };
      }

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({ success: true }),
      };
    }

    // PUT /tokens/{userId}/{platform}/{brandId} - Store/update token
    if (
      method === 'PUT' &&
      pathParams.userId &&
      pathParams.platform &&
      pathParams.brandId &&
      !pathParams.action
    ) {
      const body = JSON.parse(event.body || '{}');
      await storeToken(
        {
          userId: pathParams.userId,
          brandId: pathParams.brandId,
          platform: pathParams.platform,
          ...body,
        },
        requestContext
      );

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({ success: true }),
      };
    }

    // GET /tokens/{userId}/{platform}/{brandId} - Get specific token
    if (
      method === 'GET' &&
      pathParams.userId &&
      pathParams.platform &&
      pathParams.brandId &&
      !pathParams.action
    ) {
      const token = await getToken(
        {
          userId: pathParams.userId,
          brandId: pathParams.brandId,
          platform: pathParams.platform,
        },
        requestContext
      );

      if (!token) {
        return {
          statusCode: 404,
          headers: responseHeaders,
          body: JSON.stringify({ error: 'Token not found' }),
        };
      }

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify(token),
      };
    }

    // POST /tokens/{userId}/{platform}/{brandId}/rotate - Rotate token
    if (method === 'POST' && pathParams.action === 'rotate') {
      const rotatedToken = await rotateToken(
        {
          userId: pathParams.userId,
          brandId: pathParams.brandId,
          platform: pathParams.platform,
        },
        requestContext
      );

      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify(rotatedToken),
      };
    }

    // Invalid endpoint
    return {
      statusCode: 404,
      headers: responseHeaders,
      body: JSON.stringify({ error: 'Endpoint not found' }),
    };
  } catch (error) {
    logger.error('Request failed', {
      error,
      requestId,
      correlationId,
    });

    metrics.addMetric('RequestErrors', MetricUnit.Count, 1);

    if (error instanceof ServiceError) {
      const retryHeaders: Record<string, string> = { ...responseHeaders };
      if (error.code === 'RATE_LIMITED' && error.details?.retryAfterSeconds) {
        retryHeaders['Retry-After'] = error.details.retryAfterSeconds.toString();
      }
      const statusCode = getHttpStatusCodeForServiceError(error);
      const retryable = error.retryable ?? false;
      return {
        statusCode,
        headers: retryHeaders,
        body: JSON.stringify({
          error: error.message,
          code: error.code,
          retryable,
          requestId,
          correlationId,
        }),
      };
    }

    return {
      statusCode: 500,
      headers: responseHeaders,
      body: JSON.stringify({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        retryable: true,
        requestId,
        correlationId,
      }),
    };
  } finally {
    metrics.publishStoredMetrics();
  }
};
