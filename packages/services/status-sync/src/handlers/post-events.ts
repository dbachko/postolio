import type {
  ContentStatus,
  Platform,
  Prisma,
  PrismaClient as LambdaPrismaClient,
} from '@postolio/database/lambda';
import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { getClient, logger, metrics, toDatabasePlatform } from '../runtime';
import { createPostFailureNotification, normalizeErrorMessage } from '../domain/notifications';
import type { EventDetail } from '../types';

const UNAVAILABLE_STATUS: ContentStatus = 'unavailable' as ContentStatus;

interface SocialAccountProjection {
  id: string;
  brandId: string;
  platform: Platform;
  externalAccountId: string | null;
  externalPageId: string | null;
}

export async function handlePostPublished(detail: EventDetail): Promise<void> {
  const contentId = detail.contentId;
  if (!contentId) {
    return;
  }

  const client = await getClient();
  await markContentPublished(client, detail, contentId);

  try {
    await recordPublication(client, detail, contentId);
  } catch (error) {
    logger.warn('Failed to record publication in status-sync', {
      contentId,
      error: (error as Error)?.message,
    });
  }
}

export async function handlePostFailed(detail: EventDetail): Promise<void> {
  const contentId = detail.contentId;
  if (!contentId) {
    return;
  }

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

export async function handlePostSkipped(detail: EventDetail): Promise<void> {
  const contentId = detail.contentId;
  if (!contentId) {
    return;
  }

  const client = await getClient();
  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'draft' as ContentStatus,
      schedulingError: detail.reason?.slice(0, 500) || 'Content skipped',
    },
  });
}

export async function handlePostUnavailable(detail: EventDetail): Promise<void> {
  const client = await getClient();
  const sanitizedReason = detail.reason?.slice(0, 500) || 'Post unavailable on platform';
  const resolvedContentId = await annotateUnavailablePublication(client, detail, sanitizedReason);

  if (!resolvedContentId) {
    logger.warn('post.unavailable missing contentId', { publicationId: detail.publicationId });
    return;
  }

  await markContentUnavailable(client, resolvedContentId, sanitizedReason);
}

async function markContentPublished(
  client: LambdaPrismaClient,
  detail: EventDetail,
  contentId: string
): Promise<void> {
  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'published' as ContentStatus,
      postedAt: detail.publishedAt ? new Date(detail.publishedAt) : new Date(),
      schedulingError: null,
    },
  });
}

async function recordPublication(
  client: LambdaPrismaClient,
  detail: EventDetail,
  contentId: string
): Promise<void> {
  const platform = toDatabasePlatform(detail.platform) || 'instagram';
  const socialAccount = await resolveSocialAccount(client, detail, platform);

  if (!socialAccount) {
    logger.warn('SocialAccount not found for published post', {
      brandId: detail.brandId,
      platform,
      socialAccountId: sanitizeOptionalId(detail.socialAccountId) || undefined,
    });
    return;
  }

  if (!detail.platformPostId) {
    return;
  }

  await upsertPublicationRecord(client, detail, contentId, platform, socialAccount);
}

async function resolveSocialAccount(
  client: LambdaPrismaClient,
  detail: EventDetail,
  platform: Platform
): Promise<SocialAccountProjection | null> {
  const requestedId = sanitizeOptionalId(detail.socialAccountId);
  const resolvedById = requestedId ? await findSocialAccountById(client, requestedId) : null;

  if (isCompatibleSocialAccount(resolvedById, detail.brandId, platform)) {
    return resolvedById;
  }

  if (!detail.brandId) {
    return null;
  }

  return findSocialAccountByBrandAndPlatform(client, detail.brandId, platform);
}

function sanitizeOptionalId(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function findSocialAccountById(
  client: LambdaPrismaClient,
  socialAccountId: string
): Promise<SocialAccountProjection | null> {
  return client.socialAccount.findUnique({
    where: { id: socialAccountId },
    select: {
      id: true,
      brandId: true,
      platform: true,
      externalAccountId: true,
      externalPageId: true,
    },
  }) as Promise<SocialAccountProjection | null>;
}

async function findSocialAccountByBrandAndPlatform(
  client: LambdaPrismaClient,
  brandId: string,
  platform: Platform
): Promise<SocialAccountProjection | null> {
  return client.socialAccount.findFirst({
    where: { brandId, platform },
    select: {
      id: true,
      brandId: true,
      platform: true,
      externalAccountId: true,
      externalPageId: true,
    },
  }) as Promise<SocialAccountProjection | null>;
}

function isCompatibleSocialAccount(
  socialAccount: SocialAccountProjection | null,
  brandId: string | undefined,
  platform: Platform
): socialAccount is SocialAccountProjection {
  return (
    !!socialAccount &&
    (!brandId || socialAccount.brandId === brandId) &&
    socialAccount.platform === platform
  );
}

async function upsertPublicationRecord(
  client: LambdaPrismaClient,
  detail: EventDetail,
  contentId: string,
  platform: Platform,
  socialAccount: SocialAccountProjection
): Promise<void> {
  const publishedAt = detail.publishedAt ? new Date(detail.publishedAt) : new Date();

  await client.contentPublication.upsert({
    where: {
      socialAccountId_externalPostId: {
        socialAccountId: socialAccount.id,
        externalPostId: detail.platformPostId || '',
      },
    },
    update: {
      contentId,
      permalink: detail.permalink || undefined,
      publishedAt,
      externalAccountId: socialAccount.externalAccountId || undefined,
      externalPageId: socialAccount.externalPageId || undefined,
      status: 'published',
    },
    create: {
      contentId,
      socialAccountId: socialAccount.id,
      platform,
      externalPostId: detail.platformPostId || '',
      externalThreadRootId: null,
      externalAccountId: socialAccount.externalAccountId || undefined,
      externalPageId: socialAccount.externalPageId || undefined,
      permalink: detail.permalink || undefined,
      publishedAt,
      status: 'published',
    },
  });
}

async function annotateUnavailablePublication(
  client: LambdaPrismaClient,
  detail: EventDetail,
  sanitizedReason: string
): Promise<string | null> {
  let resolvedContentId = detail.contentId || null;
  if (!detail.publicationId) {
    return resolvedContentId;
  }

  const publication = await client.contentPublication.findUnique({
    where: { id: detail.publicationId },
    select: { id: true, contentId: true, metadata: true },
  });

  if (!publication) {
    return resolvedContentId;
  }

  resolvedContentId = resolvedContentId || publication.contentId;
  const metadata = mergeUnavailableMetadata(publication.metadata, sanitizedReason);

  await client.contentPublication.update({
    where: { id: publication.id },
    data: {
      status: 'unavailable',
      metadata: metadata as Prisma.JsonObject,
    },
  });

  return resolvedContentId;
}

function mergeUnavailableMetadata(
  currentMetadata: unknown,
  sanitizedReason: string
): Record<string, unknown> {
  const base =
    currentMetadata && typeof currentMetadata === 'object' && !Array.isArray(currentMetadata)
      ? { ...(currentMetadata as Record<string, unknown>) }
      : {};

  return {
    ...base,
    analyticsUnavailable: {
      reason: sanitizedReason,
      recordedAt: new Date().toISOString(),
    },
  };
}

async function markContentUnavailable(
  client: LambdaPrismaClient,
  contentId: string,
  sanitizedReason: string
): Promise<void> {
  const currentContent = await client.content.findUnique({
    where: { id: contentId },
    select: { generationParams: true },
  });

  const existingParams = (currentContent?.generationParams as Record<string, unknown>) || {};

  await client.content.update({
    where: { id: contentId },
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
