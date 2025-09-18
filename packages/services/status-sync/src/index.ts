/**
 * Status Sync Lambda
 * Consumes EventBridge events and updates PostgreSQL content status via Prisma.
 * Handles: post.published, post.failed, schedule.created, schedule.updated, schedule.canceled
 */

import type { PrismaClient as LambdaPrismaClient } from '@postolio/database/lambda';
import { createLambdaPrismaClient, ContentStatus } from '@postolio/database/lambda';
import type { Context, EventBridgeEvent } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

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

function ensureAwsProxyParams(urlString: string): string {
  try {
    const url = new URL(urlString);
    if (!url.searchParams.has('schema')) {
      url.searchParams.set('schema', process.env.DB_SCHEMA || 'public');
    }
    if (!url.searchParams.has('pgbouncer')) {
      url.searchParams.set('pgbouncer', 'true');
    }
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', process.env.DB_CONNECTION_LIMIT || '1');
    }
    if (process.env.DB_SSL_MODE && !url.searchParams.has('sslmode')) {
      url.searchParams.set('sslmode', process.env.DB_SSL_MODE);
    }
    return url.toString();
  } catch {
    return urlString;
  }
}

const secrets = new SecretsManagerClient({});

async function getDatabaseUrl(): Promise<string> {
  if (cachedDbUrl) return cachedDbUrl;

  if (process.env.DATABASE_URL) {
    cachedDbUrl = ensureAwsProxyParams(process.env.DATABASE_URL);
    return cachedDbUrl;
  }

  // Build from pieces: either from env values, or from a secret for username/password
  let host = process.env.DB_HOST;
  let port = process.env.DB_PORT || '5432';
  let name = process.env.DB_NAME || 'postolio';

  let username = process.env.DB_USERNAME;
  let password = process.env.DB_PASSWORD;

  try {
    const secretId = process.env.DB_SECRET_ARN || process.env.DB_SECRET_NAME;
    if ((!username || !password) && secretId) {
      const res = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
      if (res.SecretString) {
        const obj = JSON.parse(res.SecretString);
        username = username || obj.username;
        password = password || obj.password;
        host = host || obj.host || obj.hostname;
        if ((!port || port === '') && (obj.port || obj.portNumber)) {
          const secretPort = obj.port ?? obj.portNumber;
          port = secretPort ? String(secretPort) : port;
        }
        if (!name && (obj.dbname || obj.database || obj.db)) {
          name = obj.dbname || obj.database || obj.db;
        }
      }
    }
  } catch {
    console.warn('Failed to read DB secret, falling back to env vars');
  }

  if (!host || !username || !password) {
    throw new Error(
      'Database configuration missing: set DATABASE_URL or DB_HOST, DB_USERNAME, DB_PASSWORD'
    );
  }

  const encUser = encodeURIComponent(username);
  const encPass = encodeURIComponent(password);
  const connectionUrl = `postgresql://${encUser}:${encPass}@${host}:${port}/${name}`;
  cachedDbUrl = ensureAwsProxyParams(connectionUrl);
  return cachedDbUrl;
}

async function getClient(): Promise<LambdaPrismaClient> {
  if (!prisma) {
    const url = await getDatabaseUrl();
    const { client } = createLambdaPrismaClient({
      connectionString: url,
      poolConfig: {
        connectionString: url,
        max: Number(process.env.DB_CONNECTION_LIMIT || process.env.DB_POOL_MAX || '1'),
      },
    });
    prisma = client;
    // Note: Pool cleanup is handled by Lambda runtime
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
