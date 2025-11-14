import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import type { PrismaClient as LambdaPrismaClient } from '@postolio/database/lambda';
import { createLambdaPrismaClient } from '@postolio/database/lambda';

const logger = new Logger({ serviceName: 'brand-analysis-scheduler' });

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
const JOBS_TABLE = process.env.BRAND_ANALYSIS_JOBS_TABLE!;
const ENVIRONMENT = process.env.ENVIRONMENT || process.env.NODE_ENV || 'dev';
const DEBOUNCE_MS = Number(
  process.env.BRAND_ANALYSIS_SCHEDULE_DEBOUNCE_MS || 6 * 24 * 60 * 60 * 1000
); // 6 days

const eb = new EventBridge({});
const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } });

let prisma: LambdaPrismaClient | null = null;

async function getDbClient(): Promise<LambdaPrismaClient> {
  if (prisma) return prisma;
  if (process.env.DATABASE_URL) {
    prisma = createLambdaPrismaClient({ connectionString: process.env.DATABASE_URL }).client;
    return prisma;
  }
  const ssm = new SSMClient({});
  const secrets = new SecretsManagerClient({});
  const secretArnParam = await ssm.send(
    new GetParameterCommand({ Name: `/postolio/${ENVIRONMENT}/database/secret-arn` })
  );
  const secretArn = secretArnParam.Parameter?.Value;
  if (!secretArn) throw new Error('Missing DB secret ARN');
  const creds = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!creds.SecretString) throw new Error('Empty DB secret');
  const parsed = JSON.parse(creds.SecretString);
  const hostParam = await ssm.send(
    new GetParameterCommand({ Name: `/postolio/${ENVIRONMENT}/database/proxy-endpoint` })
  );
  const proxy = hostParam.Parameter?.Value;
  const dbName = process.env.DB_NAME || 'postolio';
  if (!proxy) throw new Error('Missing DB proxy endpoint');
  const url = `postgresql://${encodeURIComponent(parsed.username)}:${encodeURIComponent(
    parsed.password
  )}@${proxy}/${dbName}?sslmode=require`;
  prisma = createLambdaPrismaClient({ connectionString: url }).client;
  return prisma;
}

async function latestJobWithinWindow(brandId: string): Promise<boolean> {
  const res = await doc.send(
    new QueryCommand({
      TableName: JOBS_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'brandId = :bid',
      ExpressionAttributeValues: { ':bid': brandId },
      ScanIndexForward: false,
      Limit: 1,
    })
  );
  const last = res.Items?.[0] as { requestedAt?: string; status?: string } | undefined;
  if (!last) return false;
  if (last.status === 'running') return true;
  const ts = last.requestedAt ? Date.parse(last.requestedAt) : NaN;
  return !Number.isNaN(ts) && Date.now() - ts < DEBOUNCE_MS;
}

export async function handler(): Promise<void> {
  logger.info('Weekly scheduler invoked');
  const prisma = await getDbClient();

  // Query all brands with Instagram connection via SocialAccount
  const socialAccounts = await prisma.socialAccount.findMany({
    where: { platform: 'instagram' },
    select: { brandId: true },
  });

  let enqueued = 0;
  for (const sa of socialAccounts) {
    const brandId = sa.brandId;
    try {
      const skip = await latestJobWithinWindow(brandId);
      if (skip) continue;
      await eb.send(
        new PutEventsCommand({
          Entries: [
            {
              DetailType: 'brand.analysis.requested',
              Source: 'postolio.brand',
              EventBusName: EVENT_BUS_NAME,
              Detail: JSON.stringify({ brandId, options: { reason: 'weekly-schedule' } }),
            },
          ],
        })
      );
      enqueued++;
    } catch (err) {
      logger.warn('Failed to enqueue brand', { brandId, err });
    }
  }
  logger.info('Scheduler completed', { enqueued, total: socialAccounts.length });
}
