import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { SendEmailCommand } from '@aws-sdk/client-ses';
import type { Prisma, PrismaClient as LambdaPrismaClient } from '@postolio/database/lambda';
import { metrics, logger, sesClient } from '../runtime';
import type { EventDetail } from '../types';

interface ContentForNotification {
  id: string;
  caption: string | null;
  brandId: string;
  brand: {
    id: string;
    name: string | null;
    userId: string;
    user: {
      id: string;
      email: string | null;
      name: string | null;
    } | null;
  } | null;
}

interface UpsertNotificationResult {
  id: string;
  sendEmail: boolean;
}

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return normalizeErrorMessage(error.message);
  }

  let text = '';
  if (typeof error === 'string') {
    text = error;
  } else if (error) {
    text = String(error);
  }
  const trimmed = text.trim();

  if (!trimmed) {
    return 'Unknown error';
  }

  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

export async function createPostFailureNotification(
  client: LambdaPrismaClient,
  detail: EventDetail,
  errorMessage: string
): Promise<void> {
  const contentId = detail.contentId;
  if (!contentId) {
    return;
  }

  const content = await getContentForNotification(client, contentId);
  if (!content?.brand?.user) {
    logger.warn('Skipping notification creation; content or brand missing', { contentId });
    return;
  }

  const userId = content.brand.user.id;
  const brandId = content.brandId;

  if (await isNotificationSuppressed(client, userId, brandId)) {
    logger.info('Notification suppressed by master preference', { contentId, userId });
    return;
  }

  const { id, sendEmail } = await upsertFailureNotification(client, detail, errorMessage, content);
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
    notificationId: id,
  });

  metrics.addMetric('NotificationCreated', MetricUnit.Count, 1);
}

function buildPostLink(contentId: string): string {
  const base = (process.env.FRONTEND_URL || 'https://postolio.example').replace(/\/?$/, '');
  return `${base}/posts/${contentId}`;
}

async function getContentForNotification(
  client: LambdaPrismaClient,
  contentId: string
): Promise<ContentForNotification | null> {
  return client.content.findUnique({
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
  }) as Promise<ContentForNotification | null>;
}

async function isNotificationSuppressed(
  client: LambdaPrismaClient,
  userId: string,
  brandId: string
): Promise<boolean> {
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

  return masterPreference?.enabled === false;
}

async function upsertFailureNotification(
  client: LambdaPrismaClient,
  detail: EventDetail,
  errorMessage: string,
  content: ContentForNotification
): Promise<UpsertNotificationResult> {
  const metadata = {
    platform: detail.platform || null,
    scheduleId: detail.scheduleId || null,
    attemptNumber: detail.attemptNumber ?? null,
  } as Record<string, unknown>;

  const contentId = content.id;
  const linkUrl = buildPostLink(contentId);
  const dedupeKey = `content:${contentId}:failed`;
  const existing = await client.notification.findUnique({ where: { dedupeKey } });

  if (!existing) {
    const created = await client.notification.create({
      data: {
        userId: content.brand?.user?.id || '',
        brandId: content.brandId,
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

    return { id: created.id, sendEmail: true };
  }

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
      createdAt: new Date(),
    },
    select: { id: true },
  });

  return { id: updated.id, sendEmail: false };
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

  const shouldEmail = await shouldSendFailureEmail(client, userId, brandId);
  if (!shouldEmail) {
    return;
  }

  const fromAddress =
    process.env.SES_FROM_EMAIL ||
    process.env.NOTIFICATIONS_FROM_EMAIL ||
    'noreply@postolio.example';

  const message = buildFailureEmailMessage({
    platform,
    brandName,
    contentId,
    errorMessage,
  });

  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: fromAddress,
        Destination: { ToAddresses: [email] },
        Message: message,
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

async function shouldSendFailureEmail(
  client: LambdaPrismaClient,
  userId: string,
  brandId: string
): Promise<boolean> {
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

  return preference ? preference.enabled : true;
}

function buildFailureEmailMessage(args: {
  platform?: string;
  brandName?: string | null;
  contentId: string;
  errorMessage: string;
}): {
  Subject: { Data: string; Charset: string };
  Body: {
    Html: { Data: string; Charset: string };
    Text: { Data: string; Charset: string };
  };
} {
  const { platform, brandName, contentId, errorMessage } = args;
  const link = buildPostLink(contentId);
  const subject = `Post failed to publish${brandName ? ` – ${brandName}` : ''}`;
  const htmlBody = createFailureHtmlBody(platform, link, errorMessage);
  const textBody = createFailureTextBody(platform, link, errorMessage);

  return {
    Subject: { Data: subject, Charset: 'UTF-8' },
    Body: {
      Html: { Data: htmlBody, Charset: 'UTF-8' },
      Text: { Data: textBody, Charset: 'UTF-8' },
    },
  };
}

function createFailureHtmlBody(
  platform: string | undefined,
  link: string,
  message: string
): string {
  return `
    <p>Your scheduled post${platform ? ` for ${platform}` : ''} failed to publish.</p>
    <p><strong>Reason:</strong><br/>${escapeHtml(message).replace(/\n/g, '<br/>')}</p>
    <p><a href="${link}">Review the post in Postolio</a></p>
    <p style="margin-top:16px;">— The Postolio Team</p>
  `;
}

function createFailureTextBody(
  platform: string | undefined,
  link: string,
  message: string
): string {
  return `Your scheduled post${platform ? ` for ${platform}` : ''} failed to publish.

Reason:
${message}

Review the post: ${link}
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
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
        return char;
    }
  });
}
