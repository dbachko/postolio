import crypto from 'crypto';
import { DecryptCommand, EncryptCommand } from '@aws-sdk/client-kms';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ErrorFactory, ServiceError } from '@postolio/errors';
import { captureException } from '@postolio/observability';
import {
  AUDIT_TABLE_NAME,
  KMS_KEY_ID,
  RATE_LIMITS,
  RATE_LIMIT_TABLE,
  TABLE_NAME,
  docClient,
  kmsClient,
  logger,
  metrics,
} from './runtime';
import type {
  AuditLogEntry,
  RequestContext,
  StoreTokenRequest,
  TokenData,
  TokenLookupRequest,
  TokenMetadata,
} from './types';
import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { NotFoundError } from './errors';

interface TokenRecord {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  metadata?: TokenMetadata;
  tokenVersion?: number;
  lastRefreshed?: string;
  rotationCount?: number;
}

export function buildTokenSk(brandId: string, socialAccountId?: string): string {
  return socialAccountId ? `${brandId}#${socialAccountId}` : brandId;
}

function buildTokenPk(userId: string, platform: string): string {
  return `${userId}#${platform}`;
}

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
          ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
        },
      })
    );

    logger.info('Audit log recorded', {
      operation: entry.operation,
      result: entry.result,
    });
  } catch (error) {
    logger.error('Failed to write audit log', { error, entry });
  }
}

async function auditOperation(
  operation: string,
  data: TokenLookupRequest,
  requestContext: RequestContext,
  result: 'success' | 'failure',
  extra: {
    errorCode?: string;
    errorMessage?: string;
    metadata?: TokenMetadata;
  } = {}
): Promise<void> {
  await auditLog({
    operation,
    userId: data.userId,
    brandId: data.brandId,
    platform: data.platform,
    requestId: requestContext.requestId,
    correlationId: requestContext.correlationId,
    ipAddress: requestContext.ipAddress,
    result,
    errorCode: extra.errorCode,
    errorMessage: extra.errorMessage,
    metadata: {
      ...(data.socialAccountId ? { socialAccountId: data.socialAccountId } : {}),
      ...(extra.metadata || {}),
    },
  });
}

export async function checkRateLimit(userId: string, platform?: string): Promise<void> {
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

    await docClient.send(
      new PutCommand({
        TableName: RATE_LIMIT_TABLE,
        Item: {
          pk: `RATELIMIT#${rateLimitKey}`,
          sk: windowKey,
          count: currentCount + 1,
          firstRequest: result.Item?.firstRequest || new Date().toISOString(),
          lastRequest: new Date().toISOString(),
          ttl: Math.floor(now / 1000) + 120,
        },
      })
    );
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'RATE_LIMITED') {
      throw error;
    }

    logger.warn('Rate limit check failed', { error });
  }
}

function validateStoreTokenRequest(data: StoreTokenRequest): void {
  if (!data.userId || !data.brandId || !data.platform || !data.accessToken) {
    throw ErrorFactory.validationFailed([
      'Missing required fields: userId, brandId, platform, or accessToken',
    ]);
  }

  if (new Date(data.expiresAt) < new Date()) {
    throw ErrorFactory.validationFailed(['Token already expired']);
  }
}

async function buildStoreTokenItem(data: StoreTokenRequest): Promise<Record<string, unknown>> {
  const encryptedAccessToken = await encryptToken(data.accessToken);
  const encryptedRefreshToken = data.refreshToken
    ? await encryptToken(data.refreshToken)
    : undefined;

  return {
    pk: buildTokenPk(data.userId, data.platform),
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
}

function getOperationError(error: unknown): { errorCode: string; errorMessage: string } {
  return {
    errorCode: error instanceof ServiceError ? error.code : 'UNKNOWN_ERROR',
    errorMessage: error instanceof Error ? error.message : 'Unknown error',
  };
}

export async function storeToken(
  data: StoreTokenRequest,
  requestContext: RequestContext
): Promise<void> {
  validateStoreTokenRequest(data);

  try {
    const item = await buildStoreTokenItem(data);

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    await auditOperation('STORE_TOKEN', data, requestContext, 'success', {
      metadata: { hasRefreshToken: !!data.refreshToken },
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
    await auditOperation('STORE_TOKEN', data, requestContext, 'failure', getOperationError(error));
    throw error;
  }
}

function tokenNeedsRefresh(expiresAt: string): boolean {
  const expiryTime = new Date(expiresAt).getTime();
  const refreshThreshold = Date.now() + 7 * 24 * 60 * 60 * 1000;
  return expiryTime < refreshThreshold;
}

function toTokenData(record: TokenRecord, accessToken: string): TokenData {
  return {
    accessToken,
    refreshToken: record.refreshToken,
    expiresAt: record.expiresAt,
    metadata: record.metadata,
    tokenVersion: record.tokenVersion,
    lastRefreshed: record.lastRefreshed,
    rotationCount: record.rotationCount,
  };
}

export async function getToken(
  data: TokenLookupRequest,
  requestContext: RequestContext
): Promise<TokenData | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: buildTokenPk(data.userId, data.platform),
          sk: buildTokenSk(data.brandId, data.socialAccountId),
        },
      })
    );

    if (!result.Item) {
      await auditOperation('GET_TOKEN', data, requestContext, 'success', {
        metadata: { found: false },
      });
      return null;
    }

    const record = result.Item as TokenRecord;
    const needsRefresh = tokenNeedsRefresh(record.expiresAt);

    if (needsRefresh && record.refreshToken) {
      logger.info('Token needs refresh', {
        ...data,
        expiresAt: record.expiresAt,
        correlationId: requestContext.correlationId,
      });
      metrics.addMetric('TokensNeedingRefresh', MetricUnit.Count, 1);
    }

    const decryptedAccessToken = await decryptToken(record.accessToken);

    await auditOperation('GET_TOKEN', data, requestContext, 'success', {
      metadata: { found: true, needsRefresh },
    });

    metrics.addMetric('TokensRetrieved', MetricUnit.Count, 1);
    return toTokenData(record, decryptedAccessToken);
  } catch (error) {
    await auditOperation('GET_TOKEN', data, requestContext, 'failure', getOperationError(error));
    throw error;
  }
}

export async function deleteToken(
  data: TokenLookupRequest,
  requestContext: RequestContext
): Promise<boolean> {
  try {
    const result = await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: buildTokenPk(data.userId, data.platform),
          sk: buildTokenSk(data.brandId, data.socialAccountId),
        },
        ReturnValues: 'ALL_OLD',
      })
    );

    const deleted = !!result.Attributes;
    await auditOperation('DELETE_TOKEN', data, requestContext, 'success', {
      metadata: { deleted },
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
    await auditOperation('DELETE_TOKEN', data, requestContext, 'failure', getOperationError(error));
    throw error;
  }
}

export async function rotateToken(
  data: TokenLookupRequest,
  requestContext: RequestContext
): Promise<TokenData> {
  try {
    const currentToken = await getToken(data, requestContext);
    if (!currentToken) {
      throw new NotFoundError('Token not found for rotation');
    }

    const newTokenVersion = (currentToken.tokenVersion || 1) + 1;
    const rotationCount = (currentToken.rotationCount || 0) + 1;

    const rotatedToken: TokenData = {
      ...currentToken,
      tokenVersion: newTokenVersion,
      rotationCount,
      lastRefreshed: new Date().toISOString(),
    };

    await storeToken(
      {
        userId: data.userId,
        brandId: data.brandId,
        platform: data.platform,
        socialAccountId: data.socialAccountId,
        accessToken: currentToken.accessToken,
        refreshToken: currentToken.refreshToken,
        expiresAt: currentToken.expiresAt,
        metadata: {
          ...currentToken.metadata,
          rotatedAt: new Date().toISOString(),
          rotationCount,
        },
      },
      requestContext
    );

    await auditOperation('ROTATE_TOKEN', data, requestContext, 'success', {
      metadata: { newVersion: newTokenVersion, rotationCount },
    });

    logger.info('Token rotated successfully', {
      ...data,
      newVersion: newTokenVersion,
      correlationId: requestContext.correlationId,
    });

    metrics.addMetric('TokensRotated', MetricUnit.Count, 1);
    return rotatedToken;
  } catch (error) {
    await auditOperation('ROTATE_TOKEN', data, requestContext, 'failure', getOperationError(error));
    throw error;
  }
}
