/**
 * Status Sync Lambda
 * Consumes EventBridge events and updates PostgreSQL content status via Prisma.
 * Handles: post.published, post.failed, schedule.created, schedule.updated, schedule.canceled
 */

import type { PrismaClient as LambdaPrismaClient } from '@postolio/database/lambda';
import { createLambdaPrismaClient, ContentStatus } from '@postolio/database/lambda';
import type { Context, EventBridgeEvent } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

interface BaseDetailData {
  contentId?: string;
  publishedAt?: string;
  platformPostId?: string;
  permalink?: string;
  error?: string | { message?: string };
  scheduleId?: string;
  scheduledAt?: string;
  updates?: { scheduledAt?: string };
}

type PlatformEventDetail = {
  id: string;
  source: string;
  type: string;
  timestamp: string;
  data: BaseDetailData;
  metadata?: Record<string, unknown>;
};

let prisma: LambdaPrismaClient | null = null;
let cachedDbUrl: string | null = null;
let cachedProxyEndpoint: string | null = null;

function ensureProxyParams(urlString: string): string {
  try {
    const url = new URL(urlString);
    // Add essential proxy connection parameters
    if (!url.searchParams.has('schema')) {
      url.searchParams.set('schema', 'public');
    }
    if (!url.searchParams.has('pgbouncer')) {
      url.searchParams.set('pgbouncer', 'true');
    }
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '1');
    }
    if (!url.searchParams.has('sslmode')) {
      url.searchParams.set('sslmode', 'require');
    }
    return url.toString();
  } catch {
    return urlString;
  }
}

const secrets = new SecretsManagerClient({});
const ssm = new SSMClient({});

async function getDatabaseProxyEndpoint(): Promise<string> {
  if (cachedProxyEndpoint) return cachedProxyEndpoint;

  const environment = process.env.ENVIRONMENT || 'dev';

  try {
    const parameter = await ssm.send(new GetParameterCommand({
      Name: `/postolio/${environment}/database/proxy-endpoint`,
    }));

    if (parameter.Parameter?.Value) {
      cachedProxyEndpoint = parameter.Parameter.Value;
      console.log('Using RDS Proxy endpoint for database connection');
      return cachedProxyEndpoint;
    }
  } catch (error) {
    console.warn('Failed to get RDS Proxy endpoint from SSM:', error);
    throw new Error('RDS Proxy endpoint not available - cannot connect to database');
  }

  throw new Error('RDS Proxy endpoint not configured');
}

async function getDatabaseUrl(): Promise<string> {
  if (cachedDbUrl) return cachedDbUrl;

  // For local development, use DATABASE_URL if provided
  if (process.env.DATABASE_URL) {
    cachedDbUrl = ensureProxyParams(process.env.DATABASE_URL);
    console.log('Using DATABASE_URL for local development');
    return cachedDbUrl;
  }

  // Production: Use RDS Proxy with IAM authentication
  const proxyEndpoint = await getDatabaseProxyEndpoint();
  const dbName = process.env.DB_NAME || 'postolio';

  // Get credentials from secret for RDS Proxy IAM auth
  const secretId = process.env.DB_SECRET_ARN;
  if (!secretId) {
    throw new Error('DB_SECRET_ARN required for RDS Proxy authentication');
  }

  try {
    const res = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!res.SecretString) {
      throw new Error('Empty database secret');
    }

    const credentials = JSON.parse(res.SecretString);
    const username = credentials.username;
    const password = credentials.password;

    if (!username || !password) {
      throw new Error('Missing username or password in database secret');
    }

    const connectionUrl = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${proxyEndpoint}:5432/${dbName}`;
    cachedDbUrl = ensureProxyParams(connectionUrl);
    console.log('Using RDS Proxy connection:', { endpoint: proxyEndpoint, database: dbName });
    return cachedDbUrl;
  } catch (error) {
    console.error('Failed to read database secret:', error);
    throw new Error('Cannot authenticate with RDS Proxy');
  }
}

async function getClient(): Promise<LambdaPrismaClient> {
  if (!prisma) {
    const url = await getDatabaseUrl();
    const { client } = createLambdaPrismaClient({
      connectionString: url,
      poolConfig: {
        connectionString: url,
        max: 1, // Single connection for Lambda
        connectionTimeoutMillis: 5000, // 5 seconds with RDS Proxy
        idleTimeoutMillis: 10000, // 10 seconds with RDS Proxy
        query_timeout: 30000, // 30 seconds for query execution
      },
    });
    prisma = client;
  }
  return prisma;
}

async function handlePostPublished(detail: PlatformEventDetail) {
  const { contentId, publishedAt, platformPostId, permalink } = detail.data;
  if (!contentId) return;
  const client = await getClient();
  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'published' as ContentStatus,
      postedAt: publishedAt ? new Date(publishedAt) : new Date(),
      instagramPostId: platformPostId ?? undefined,
      instagramPermalink: permalink ?? undefined,
      schedulingError: null,
    },
  });
}

async function handlePostFailed(detail: PlatformEventDetail) {
  const { contentId, error } = detail.data;
  if (!contentId) return;
  const message: string | undefined = typeof error === 'string' ? error : error?.message;
  const client = await getClient();
  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'failed' as ContentStatus,
      schedulingError: message?.slice(0, 500) || 'Unknown error',
    },
  });
}

async function handleScheduleFailed(detail: PlatformEventDetail) {
  const { contentId, error } = detail.data;
  if (!contentId) return;
  const client = await getClient();

  // Get current generationParams to preserve existing data
  const currentContent = await client.content.findUnique({
    where: { id: contentId },
    select: { generationParams: true },
  });

  const existingParams = (currentContent?.generationParams as Record<string, unknown>) || {};
  const message: string | undefined = typeof error === 'string' ? error : error?.message;

  await client.content.update({
    where: { id: contentId },
    data: {
      schedulingError: message?.slice(0, 500) || 'Scheduling failed',
      generationParams: {
        ...existingParams,
        processing: null, // Clear processing state - scheduling failed
        awsScheduleCreated: false,
        failedAt: new Date().toISOString(),
      },
    },
  });
}

async function handleScheduleCreated(detail: PlatformEventDetail) {
  const { contentId, scheduledAt, scheduleId } = detail.data;
  if (!contentId) return;
  const client = await getClient();

  // Get current generationParams to preserve existing data
  const currentContent = await client.content.findUnique({
    where: { id: contentId },
    select: { generationParams: true },
  });

  const existingParams = (currentContent?.generationParams as Record<string, unknown>) || {};

  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'scheduled' as ContentStatus,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      schedulingError: null, // Clear any previous errors
      generationParams: {
        ...existingParams,
        scheduleId: scheduleId, // Store the AWS schedule ID
        awsScheduleCreated: true, // Mark as properly scheduled
        processing: null, // Clear processing state - scheduling completed
        scheduledAt: scheduledAt, // Store for reference
        scheduledTimestamp: new Date().toISOString(), // When it was scheduled
      },
    },
  });
}

async function handleScheduleUpdated(detail: PlatformEventDetail) {
  const { scheduleId, updates, contentId } = detail.data;
  const scheduledAt = updates?.scheduledAt;
  if (!contentId) return;
  const client = await getClient();

  // Get current generationParams to preserve existing data
  const currentContent = await client.content.findUnique({
    where: { id: contentId },
    select: { generationParams: true },
  });

  const existingParams = (currentContent?.generationParams as Record<string, unknown>) || {};

  await client.content.update({
    where: { id: contentId },
    data: {
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      generationParams: {
        ...existingParams,
        ...(scheduleId && { scheduleId }), // Only include scheduleId if it exists
        awsScheduleCreated: true,
        processing: null, // Clear processing state - update completed
        lastUpdated: new Date().toISOString(),
      },
    },
  });
}

async function handleScheduleCanceled(detail: PlatformEventDetail) {
  const { contentId } = detail.data;
  if (!contentId) return;
  const client = await getClient();

  // Get current generationParams to preserve existing data
  const currentContent = await client.content.findUnique({
    where: { id: contentId },
    select: { generationParams: true },
  });

  const existingParams = (currentContent?.generationParams as Record<string, unknown>) || {};

  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'draft' as ContentStatus,
      scheduledAt: null,
      schedulingError: null,
      generationParams: {
        ...existingParams,
        scheduleId: null, // Clear the schedule ID
        awsScheduleCreated: false, // Mark as not scheduled
        processing: null, // Clear processing state - cancellation completed
        canceledAt: new Date().toISOString(),
      },
    },
  });
}

export async function handler(
  event: EventBridgeEvent<string, PlatformEventDetail>,
  context: Context
) {
  context.callbackWaitsForEmptyEventLoop = false;

  console.log(
    'StatusSync received event',
    JSON.stringify({
      id: event.id,
      source: event.source,
      'detail-type': event['detail-type'],
      time: event.time,
    })
  );

  const detail = event.detail;
  if (!detail || !detail.type) {
    console.warn('Missing detail/type in EventBridge event');
    return { statusCode: 400 };
  }

  try {
    switch (detail.type) {
      case 'post.published':
        await handlePostPublished(detail);
        break;
      case 'post.failed':
        await handlePostFailed(detail);
        break;
      case 'schedule.created':
        await handleScheduleCreated(detail);
        break;
      case 'schedule.updated':
        await handleScheduleUpdated(detail);
        break;
      case 'schedule.canceled':
        await handleScheduleCanceled(detail);
        break;
      case 'schedule.failed':
        await handleScheduleFailed(detail);
        break;
      default:
        console.log(`Unhandled event type: ${detail.type}`);
    }
    return { statusCode: 200 };
  } catch (error) {
    console.error('StatusSync processing error', { error });
    // Let EventBridge retries/DLQ handle transient issues
    throw error;
  }
}
