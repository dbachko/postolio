import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { KMSClient } from '@aws-sdk/client-kms';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { initSentry } from '@postolio/observability';

export const logger = new Logger({ serviceName: 'token-service' });
export const metrics = new Metrics({
  namespace: 'TokenService',
  serviceName: 'token-service',
});

initSentry({
  serviceName: 'token-service',
});

const dynamoClient = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(dynamoClient);
export const kmsClient = new KMSClient({});

export const TABLE_NAME = process.env.TOKENS_TABLE!;
export const AUDIT_TABLE_NAME = process.env.AUDIT_TABLE || 'token-audit-logs';
export const KMS_KEY_ID = process.env.KMS_KEY_ID!;
export const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE || 'token-rate-limits';

export const RATE_LIMITS = {
  perUser: {
    windowMs: 60000,
    maxRequests: 100,
  },
  perUserPlatform: {
    windowMs: 60000,
    maxRequests: 30,
  },
};
