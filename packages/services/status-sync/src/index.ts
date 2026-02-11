/**
 * Status Sync Lambda
 * Consumes EventBridge events and updates PostgreSQL content status via Prisma.
 * Handles: post.published, post.failed, schedule.created, schedule.updated, schedule.canceled
 */

import type { PrismaClient as LambdaPrismaClient, Prisma } from '@postolio/database/lambda';
import { createLambdaPrismaClient, ContentStatus, Platform } from '@postolio/database/lambda';
import type { Context, EventBridgeEvent } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { Pool } from 'pg';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { initSentry, captureException } from '@postolio/observability';

const logger = new Logger({ serviceName: 'status-sync' });
const metrics = new Metrics({
  namespace: 'Postolio/StatusSync',
  serviceName: 'status-sync',
});

initSentry({
  serviceName: 'status-sync',
});

// EventBridge event detail structure matching what publisher/scheduler services emit
interface EventDetail {
  scheduleId?: string;
  contentId?: string;
  publicationId?: string;
  brandId?: string;
  socialAccountId?: string;
  platform?: string;
  platformPostId?: string;
  permalink?: string;
  publishedAt?: string;
  scheduledAt?: string;
  error?: string;
  attemptNumber?: number;
  reason?: string;
  status?: string;
  updates?: { scheduledAt?: string };
}

let prisma: LambdaPrismaClient | null = null;
let cachedDbUrl: string | null = null; // kept for local/dev connection string

function toDatabasePlatform(platform: string | undefined): Platform | null {
  const normalized = (platform || '').toLowerCase().trim();
  if (!normalized) return null;
  if (normalized === 'twitter') return 'x';
  if (
    normalized === 'instagram' ||
    normalized === 'facebook' ||
    normalized === 'linkedin' ||
    normalized === 'x' ||
    normalized === 'youtube' ||
    normalized === 'tiktok'
  ) {
    return normalized as Platform;
  }
  return null;
}

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
const sesClient = new SESClient({});

async function getDatabaseEndpoints(): Promise<{ endpoint?: string; proxy?: string }> {
  const environment = process.env.ENVIRONMENT || 'dev';
  const result: { endpoint?: string; proxy?: string } = {};
  try {
    const ep = await ssm.send(
      new GetParameterCommand({ Name: `/postolio/${environment}/database/endpoint` })
    );
    if (ep.Parameter?.Value) result.endpoint = ep.Parameter.Value; // host:port
  } catch (e) {
    logger.warn('Could not read DB endpoint from SSM', { error: e, environment });
  }
  try {
    const px = await ssm.send(
      new GetParameterCommand({ Name: `/postolio/${environment}/database/proxy-endpoint` })
    );
    if (px.Parameter?.Value) result.proxy = px.Parameter.Value; // host:port
  } catch (e) {
    logger.warn('Could not read DB proxy endpoint from SSM', { error: e, environment });
  }
  return result;
}

async function getSecretArn(): Promise<string> {
  // Prefer explicit env var if provided
  const envArn = process.env.DB_SECRET_ARN;
  if (envArn) {
    return envArn;
  }

  // Fallback to SSM parameter to discover the secret ARN at runtime
  const environment = process.env.ENVIRONMENT || 'dev';
  try {
    const param = await ssm.send(
      new GetParameterCommand({ Name: `/postolio/${environment}/database/secret-arn` })
    );
    const value = param.Parameter?.Value;
    if (!value) throw new Error('Database secret ARN parameter is empty');
    return value;
  } catch (err) {
    logger.warn('Failed to resolve DB secret ARN from SSM', { error: err, environment });
    throw new Error('DB secret ARN not available');
  }
}

async function getDatabaseUrl(): Promise<string> {
  if (cachedDbUrl) return cachedDbUrl;

  // For local development, use DATABASE_URL if provided
  if (process.env.DATABASE_URL) {
    cachedDbUrl = ensureProxyParams(process.env.DATABASE_URL);
    logger.info('Using DATABASE_URL for local development');
    return cachedDbUrl;
  }

  // In AWS, DATABASE_URL is not used; connection is created via getClient() with password auth
  throw new Error('DATABASE_URL not available; use getClient() for AWS connections');
}

async function getClient(): Promise<LambdaPrismaClient> {
  if (prisma) return prisma;

  // Local/dev path uses DATABASE_URL with static credentials
  if (process.env.DATABASE_URL) {
    const url = await getDatabaseUrl();
    const { client } = createLambdaPrismaClient({
      connectionString: url,
      poolConfig: {
        connectionString: url,
        max: 1,
        connectionTimeoutMillis: 15000,
        idleTimeoutMillis: 10000,
        query_timeout: 30000,
      },
    });
    prisma = client;
    return prisma;
  }

  // AWS path: create Pool with password auth from Secrets Manager
  const { proxy } = await getDatabaseEndpoints();
  if (!proxy) throw new Error('RDS Proxy endpoint not available');
  const dbName = process.env.DB_NAME || 'postolio';

  const secretId = await getSecretArn();
  const res = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!res.SecretString) throw new Error('Empty database secret');
  const credentials = JSON.parse(res.SecretString);

  const username: string = credentials.username;
  const password: string = credentials.password;
  if (!username || !password) throw new Error('Missing credentials in database secret');

  const [host, portStr] = proxy.split(':');
  const port = parseInt(portStr || '5432', 10);

  const passwordPool = new Pool({
    host,
    port,
    database: dbName,
    user: username,
    password,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
  });

  try {
    // Validate the connection quickly
    await passwordPool.query('SELECT 1');
    const { client } = createLambdaPrismaClient({ pool: passwordPool });
    prisma = client;
    logger.info('Connected to database via RDS Proxy with password auth', {
      proxy: `${host}:${port}`,
      database: dbName,
    });
    return prisma;
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string } | undefined;
    const msg = e?.message || 'unknown error';
    const code = e?.code || 'unknown';
    logger.error('Password authentication to RDS Proxy failed', {
      userTried: username,
      errorCode: code,
      message: msg,
    });
    throw err;
  }
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return normalizeErrorMessage(error.message);
  let text = '';
  if (typeof error === 'string') {
    text = error;
  } else if (error) {
    text = String(error);
  }
  const trimmed = text.trim();
  if (!trimmed) return 'Unknown error';
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

function buildPostLink(contentId: string): string {
  const base = (process.env.FRONTEND_URL || 'https://postolio.example').replace(/\/?$/, '');
  return `${base}/posts/${contentId}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return ch;
    }
  });
}

async function recomputeUnreadCount(client: LambdaPrismaClient, userId: string): Promise<void> {
  const unread = await client.notification.count({
    where: { userId, readAt: null, archivedAt: null },
  });

  await client.userNotificationState.upsert({
    where: { userId },
    update: { unreadCount: unread, lastSeenAt: new Date() },
    create: { userId, unreadCount: unread },
  });
}

async function maybeSendFailureEmail(params: {
  client: LambdaPrismaClient;
  userId: string;
  brandId: string;
  email: string | null | undefined;
  brandName?: string | null;
  platform?: string;
  contentId: string;
  errorMessage: string;
}): Promise<void> {
  const { client, userId, brandId, email, brandName, platform, contentId, errorMessage } = params;

  if (!email) {
    return;
  }

  const preference = await client.notificationPreference.findFirst({
    where: {
      userId,
      channel: 'email',
      category: 'publishing',
      type: 'publishing.post_failed',
      OR: [{ brandId }, { brandId: null }],
    },
    orderBy: { brandId: 'desc' },
  });

  const shouldEmail = preference ? preference.enabled : true;
  if (!shouldEmail) {
    return;
  }

  const fromAddress =
    process.env.SES_FROM_EMAIL || process.env.NOTIFICATIONS_FROM_EMAIL || 'noreply@postolio.example';
  const link = buildPostLink(contentId);
  const subject = `Post failed to publish${brandName ? ` – ${brandName}` : ''}`;
  const sanitized = errorMessage;
  const htmlBody = `
    <p>Your scheduled post${platform ? ` for ${platform}` : ''} failed to publish.</p>
    <p><strong>Reason:</strong><br/>${escapeHtml(sanitized).replace(/\n/g, '<br/>')}</p>
    <p><a href="${link}">Review the post in Postolio</a></p>
    <p style="margin-top:16px;">— The Postolio Team</p>
  `;
  const textBody = `Your scheduled post${platform ? ` for ${platform}` : ''} failed to publish.

Reason:
${sanitized}

Review the post: ${link}
`;

  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: fromAddress,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: htmlBody, Charset: 'UTF-8' },
            Text: { Data: textBody, Charset: 'UTF-8' },
          },
        },
      })
    );
  } catch (error) {
    logger.error('Failed to send post failure email', {
      userId,
      brandId,
      error: error instanceof Error ? error.message : error,
    });
    metrics.addMetric('EmailSendFailure', MetricUnit.Count, 1);
  }
}

async function createPostFailureNotification(
  client: LambdaPrismaClient,
  detail: EventDetail,
  errorMessage: string
): Promise<void> {
  const contentId = detail.contentId;
  if (!contentId) return;

  const content = await client.content.findUnique({
    where: { id: contentId },
    select: {
      id: true,
      caption: true,
      brandId: true,
      brand: {
        select: {
          id: true,
          name: true,
          userId: true,
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!content || !content.brand || !content.brand.user) {
    logger.warn('Skipping notification creation; content or brand missing', { contentId });
    return;
  }

  const userId = content.brand.user.id;
  const brandId = content.brandId;

  const masterPreference = await client.notificationPreference.findFirst({
    where: {
      userId,
      category: 'publishing',
      type: 'all',
      channel: 'all',
      OR: [{ brandId }, { brandId: null }],
    },
    orderBy: { brandId: 'desc' },
  });

  if (masterPreference && masterPreference.enabled === false) {
    logger.info('Notification suppressed by master preference', { contentId, userId });
    return;
  }

  const metadata: Record<string, unknown> = {
    platform: detail.platform || null,
    scheduleId: detail.scheduleId || null,
    attemptNumber: detail.attemptNumber ?? null,
  };

  const linkUrl = buildPostLink(contentId);
  const dedupeKey = `content:${contentId}:failed`;
  const now = new Date();
  const existing = await client.notification.findUnique({ where: { dedupeKey } });

  let createdNotificationId: string;
  let sendEmail = true;

  if (existing) {
    const updated = await client.notification.update({
      where: { id: existing.id },
      data: {
        title: 'Post failed to publish',
        body: errorMessage,
        severity: 'error',
        linkUrl,
        metadata: metadata as Prisma.JsonValue,
        resourceType: 'post',
        resourceId: contentId,
        createdAt: now,
      },
      select: { id: true },
    });
    createdNotificationId = updated.id;
    sendEmail = false;
  } else {
    const created = await client.notification.create({
      data: {
        userId,
        brandId,
        type: 'publishing.post_failed',
        category: 'publishing',
        severity: 'error',
        title: 'Post failed to publish',
        body: errorMessage,
        linkUrl,
        resourceType: 'post',
        resourceId: contentId,
        metadata: metadata as Prisma.JsonValue,
        dedupeKey,
      },
      select: { id: true },
    });
    createdNotificationId = created.id;
  }

  await recomputeUnreadCount(client, userId);

  if (sendEmail) {
    await maybeSendFailureEmail({
      client,
      userId,
      brandId,
      email: content.brand.user.email,
      brandName: content.brand.name,
      platform: detail.platform,
      contentId,
      errorMessage,
    });
  }

  logger.info('Created post failure notification', {
    contentId,
    userId,
    brandId,
    notificationId: createdNotificationId,
  });
  metrics.addMetric('NotificationCreated', MetricUnit.Count, 1);
}

async function handlePostPublished(detail: EventDetail) {
  const { contentId, brandId, publishedAt, platformPostId, permalink, platform } = detail;
  if (!contentId) return;
  const client = await getClient();

  // Always mark content as published with postedAt timestamp
  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'published' as ContentStatus,
      postedAt: publishedAt ? new Date(publishedAt) : new Date(),
      schedulingError: null,
    },
  });

  // Record publication using the v2 publication model (append-only)
  try {
    const plt = toDatabasePlatform(platform) || 'instagram';
    const requestedSocialAccountId =
      typeof detail.socialAccountId === 'string' && detail.socialAccountId.trim().length > 0
        ? detail.socialAccountId.trim()
        : null;

    const resolvedById = requestedSocialAccountId
      ? await client.socialAccount.findUnique({
          where: { id: requestedSocialAccountId },
          select: {
            id: true,
            brandId: true,
            platform: true,
            externalAccountId: true,
            externalPageId: true,
          },
        })
      : null;

    const socialAccount =
      resolvedById &&
      (!brandId || resolvedById.brandId === brandId) &&
      resolvedById.platform === plt
        ? resolvedById
        : brandId
          ? await client.socialAccount.findFirst({
              where: { brandId, platform: plt },
              select: {
                id: true,
                brandId: true,
                platform: true,
                externalAccountId: true,
                externalPageId: true,
              },
            })
          : null;

    if (!socialAccount) {
      logger.warn('SocialAccount not found for published post', {
        brandId,
        platform: plt,
        socialAccountId: requestedSocialAccountId || undefined,
      });
      return;
    }

    // Create publication if we have a platform post id
    if (platformPostId) {
      await client.contentPublication.upsert({
        where: {
          // ensure idempotency on repeated events
          socialAccountId_externalPostId: {
            socialAccountId: socialAccount.id,
            externalPostId: platformPostId,
          },
        },
        update: {
          // Re-attach this publication to the latest content record
          // in case it was previously associated with an imported post.
          contentId,
          permalink: permalink || undefined,
          publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
          externalAccountId: socialAccount.externalAccountId || undefined,
          externalPageId: socialAccount.externalPageId || undefined,
          status: 'published',
        },
        create: {
          contentId,
          socialAccountId: socialAccount.id,
          platform: plt,
          externalPostId: platformPostId,
          externalThreadRootId: null,
          externalAccountId: socialAccount.externalAccountId || undefined,
          externalPageId: socialAccount.externalPageId || undefined,
          permalink: permalink || undefined,
          publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
          status: 'published',
        },
      });
    }
  } catch (e) {
    logger.warn('Failed to record publication in status-sync', {
      contentId,
      error: (e as Error)?.message,
    });
  }
}

async function handlePostFailed(detail: EventDetail) {
  const { contentId } = detail;
  if (!contentId) return;
  const client = await getClient();
  const errorMessage = normalizeErrorMessage(detail.error);

  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'failed' as ContentStatus,
      schedulingError: errorMessage,
    },
  });

  try {
    await createPostFailureNotification(client, detail, errorMessage);
  } catch (notificationError) {
    logger.error('Failed to create failure notification', {
      contentId,
      error: notificationError instanceof Error ? notificationError.message : notificationError,
    });
    metrics.addMetric('NotificationFailure', MetricUnit.Count, 1);
  }
}

async function handlePostSkipped(detail: EventDetail) {
  const { contentId, reason } = detail;
  if (!contentId) return;
  const client = await getClient();
  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'draft' as ContentStatus,
      schedulingError: reason?.slice(0, 500) || 'Content skipped',
    },
  });
}

async function handleScheduleFailed(detail: EventDetail) {
  const { contentId, error } = detail;
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
      status: 'failed' as ContentStatus, // Surface scheduling failure instead of silently reverting to draft
      scheduledAt: null, // Clear the scheduled time since scheduling failed
      schedulingError: error?.slice(0, 500) || 'Scheduling failed',
      generationParams: {
        ...existingParams,
        processing: null, // Clear processing state - scheduling failed
        awsScheduleCreated: false,
        failedAt: new Date().toISOString(),
      },
    },
  });
}

async function handleScheduleCreated(detail: EventDetail) {
  const { contentId, scheduledAt, scheduleId } = detail;
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

async function handleScheduleUpdated(detail: EventDetail) {
  const { scheduleId, updates, contentId } = detail;
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

async function handleScheduleCanceled(detail: EventDetail) {
  const { contentId } = detail;
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

const UNAVAILABLE_STATUS: ContentStatus = 'unavailable' as ContentStatus;

async function handlePostUnavailable(detail: EventDetail) {
  const { contentId, publicationId, reason } = detail;
  const client = await getClient();
  const sanitizedReason = reason?.slice(0, 500) || 'Post unavailable on platform';
  let resolvedContentId = contentId || null;

  if (publicationId) {
    const pub = await client.contentPublication.findUnique({
      where: { id: publicationId },
      select: { id: true, contentId: true, metadata: true },
    });
    if (pub) {
      resolvedContentId = resolvedContentId || pub.contentId;
      const base =
        pub.metadata && typeof pub.metadata === 'object' && !Array.isArray(pub.metadata)
          ? { ...(pub.metadata as Record<string, unknown>) }
          : {};
      const updatedMeta = {
        ...base,
        analyticsUnavailable: {
          reason: sanitizedReason,
          recordedAt: new Date().toISOString(),
        },
      };
      await client.contentPublication.update({
        where: { id: pub.id },
        data: {
          status: 'unavailable',
          metadata: updatedMeta as Prisma.JsonObject,
        },
      });
    }
  }

  if (!resolvedContentId) {
    logger.warn('post.unavailable missing contentId', { publicationId });
    return;
  }

  const currentContent = await client.content.findUnique({
    where: { id: resolvedContentId },
    select: { generationParams: true },
  });

  const existingParams = (currentContent?.generationParams as Record<string, unknown>) || {};

  await client.content.update({
    where: { id: resolvedContentId },
    data: {
      status: UNAVAILABLE_STATUS,
      schedulingError: sanitizedReason,
      generationParams: {
        ...existingParams,
        unavailableAt: new Date().toISOString(),
        unavailableReason: sanitizedReason,
      },
    },
  });
}

export async function handler(event: EventBridgeEvent<string, EventDetail>, context: Context) {
  context.callbackWaitsForEmptyEventLoop = false;

  logger.info('StatusSync received event', {
    id: event.id,
    source: event.source,
    detailType: event['detail-type'],
    time: event.time,
  });

  // EventBridge delivers events with 'detail-type' at the top level
  const eventType = event['detail-type'];
  const detail = event.detail;

  if (!eventType || !detail) {
    logger.warn('Missing detail-type or detail in EventBridge event');
    metrics.addMetric('InvalidEvent', MetricUnit.Count, 1);
    return { statusCode: 400 };
  }

  try {
    switch (eventType) {
      case 'post.published':
        await handlePostPublished(detail);
        metrics.addMetric('PostPublished', MetricUnit.Count, 1);
        break;
      case 'post.failed':
        await handlePostFailed(detail);
        metrics.addMetric('PostFailed', MetricUnit.Count, 1);
        break;
      case 'post.skipped':
        await handlePostSkipped(detail);
        metrics.addMetric('PostSkipped', MetricUnit.Count, 1);
        break;
      case 'schedule.created':
        await handleScheduleCreated(detail);
        metrics.addMetric('ScheduleCreated', MetricUnit.Count, 1);
        break;
      case 'schedule.updated':
        await handleScheduleUpdated(detail);
        metrics.addMetric('ScheduleUpdated', MetricUnit.Count, 1);
        break;
      case 'schedule.canceled':
        await handleScheduleCanceled(detail);
        metrics.addMetric('ScheduleCanceled', MetricUnit.Count, 1);
        break;
      case 'schedule.failed':
        await handleScheduleFailed(detail);
        metrics.addMetric('ScheduleFailed', MetricUnit.Count, 1);
        break;
      case 'post.unavailable':
        await handlePostUnavailable(detail);
        metrics.addMetric('PostUnavailable', MetricUnit.Count, 1);
        break;
      default:
        logger.warn('Unhandled event type', { eventType });
        metrics.addMetric('UnhandledEventType', MetricUnit.Count, 1);
    }

    metrics.publishStoredMetrics();
    return { statusCode: 200 };
  } catch (error) {
    logger.error('StatusSync processing error', {
      error: error instanceof Error ? error.message : error,
      eventType,
      detail,
    });
    captureException(error, {
      function: 'status-sync',
      eventType,
    });
    metrics.addMetric('ProcessingError', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();
    // Let EventBridge retries/DLQ handle transient issues
    throw error;
  }
}
