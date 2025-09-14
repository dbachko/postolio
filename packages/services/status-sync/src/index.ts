/**
 * Status Sync Lambda
 * Consumes EventBridge events and updates PostgreSQL content status via Prisma.
 * Handles: post.published, post.failed, schedule.created, schedule.updated, schedule.canceled
 */

import { PrismaClient, ContentStatus } from '@prisma/client';
import type { EventBridgeEvent } from 'aws-lambda';
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

let prisma: PrismaClient | null = null;
let cachedDbUrl: string | null = null;

const secrets = new SecretsManagerClient({});

async function getDatabaseUrl(): Promise<string> {
  if (cachedDbUrl) return cachedDbUrl;

  if (process.env.DATABASE_URL) {
    cachedDbUrl = process.env.DATABASE_URL;
    return cachedDbUrl;
  }

  // Build from pieces: either from env values, or from a secret for username/password
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT || '5432';
  const name = process.env.DB_NAME || 'postolio';

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
  cachedDbUrl = `postgresql://${encUser}:${encPass}@${host}:${port}/${name}?schema=public`;
  return cachedDbUrl;
}

async function getClient(): Promise<PrismaClient> {
  if (!prisma) {
    const url = await getDatabaseUrl();
    prisma = new PrismaClient({
      datasources: { db: { url } },
    });
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

  const existingParams = (currentContent?.generationParams as Record<string, any>) || {};
  const message: string | undefined = typeof error === 'string' ? error : error?.message;

  await client.content.update({
    where: { id: contentId },
    data: {
      schedulingError: message?.slice(0, 500) || 'Scheduling failed',
      generationParams: JSON.parse(JSON.stringify({
        ...existingParams,
        processing: null, // Clear processing state - scheduling failed
        awsScheduleCreated: false,
        failedAt: new Date().toISOString(),
      })),
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

  const existingParams = (currentContent?.generationParams as Record<string, any>) || {};

  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'scheduled' as ContentStatus,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      schedulingError: null, // Clear any previous errors
      generationParams: JSON.parse(JSON.stringify({
        ...existingParams,
        scheduleId: scheduleId, // Store the AWS schedule ID
        awsScheduleCreated: true, // Mark as properly scheduled
        processing: null, // Clear processing state - scheduling completed
        scheduledAt: scheduledAt, // Store for reference
        scheduledTimestamp: new Date().toISOString(), // When it was scheduled
      })),
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

  const existingParams = (currentContent?.generationParams as Record<string, any>) || {};

  await client.content.update({
    where: { id: contentId },
    data: {
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      generationParams: JSON.parse(JSON.stringify({
        ...existingParams,
        scheduleId: scheduleId || existingParams.scheduleId, // Preserve or update schedule ID
        awsScheduleCreated: true,
        processing: null, // Clear processing state - update completed
        lastUpdated: new Date().toISOString(),
      })),
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

  const existingParams = (currentContent?.generationParams as Record<string, any>) || {};

  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'draft' as ContentStatus,
      scheduledAt: null,
      schedulingError: null,
      generationParams: JSON.parse(JSON.stringify({
        ...existingParams,
        scheduleId: null, // Clear the schedule ID
        awsScheduleCreated: false, // Mark as not scheduled
        processing: null, // Clear processing state - cancellation completed
        canceledAt: new Date().toISOString(),
      })),
    },
  });
}

export async function handler(event: EventBridgeEvent<string, PlatformEventDetail>) {
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
