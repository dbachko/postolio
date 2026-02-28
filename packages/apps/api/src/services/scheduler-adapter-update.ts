import { getDatabaseClient } from '../config/database.js';
import { TimezoneService } from './timezone.js';
import { logger } from '@postolio/logger';
import type { GenerationParams } from '../types/scheduler.js';
import type { UpdateScheduleInput } from '../clients/content-scheduler-client.js';
import {
  prepareSchedulingPayload,
  type PreparedSchedulingPayload,
} from './scheduler-adapter-payload.js';

const prisma = getDatabaseClient();

type ServiceLike = any;

async function loadScheduledContentForUpdate(contentId: string) {
  return prisma.content.findUnique({
    where: { id: contentId },
    include: {
      brand: { select: { id: true, userId: true } },
      mediaAssets: { select: { displayOrder: true, assetId: true } },
    },
  });
}

function scheduledLocalTime(scheduledAt: Date | null, brandTimezone: string) {
  if (!(scheduledAt instanceof Date)) {
    return undefined;
  }
  return TimezoneService.toLocal(scheduledAt, brandTimezone).toISOString();
}

function buildUpdatePayload(params: {
  content: NonNullable<Awaited<ReturnType<typeof loadScheduledContentForUpdate>>>;
  prepared: PreparedSchedulingPayload;
  brandTimezone: string;
  localTime?: string;
}): UpdateScheduleInput {
  const payload: UpdateScheduleInput = {
    brandId: params.content.brandId,
    contentId: params.content.id,
    userId: params.content.brand.userId,
    platform: params.prepared.schedulerPlatform,
    caption: params.content.caption || '',
  };
  if (
    params.prepared.schedulerPlatform === 'instagram' &&
    typeof params.content.firstComment === 'string'
  ) {
    const trimmed = params.content.firstComment.trim();
    if (trimmed.length > 0) {
      payload.firstComment = trimmed;
    }
  }
  if (
    params.prepared.schedulerPlatform === 'instagram' &&
    typeof params.content.shareToFeed === 'boolean'
  ) {
    payload.shareToFeed = Boolean(params.content.shareToFeed);
  }
  payload.metadata = {
    timezone: params.brandTimezone,
    ...(params.localTime ? { localTime: params.localTime } : {}),
    socialAccountId: params.prepared.socialAccountId,
  };
  payload.mediaAssets = params.prepared.structuredMediaAssets;
  if (Array.isArray(params.content.hashtags) && params.content.hashtags.length) {
    payload.hashtags = params.content.hashtags;
  }
  if (typeof params.content.thumbOffset === 'number' && params.content.thumbOffset >= 0) {
    payload.thumbOffset = params.content.thumbOffset;
  }
  return payload;
}

export async function updateScheduledContentImpl(
  service: ServiceLike,
  contentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const content = await loadScheduledContentForUpdate(contentId);
    if (!content?.brand) {
      return { success: false, error: 'Content not found' };
    }

    const generationParams = (content.generationParams as GenerationParams | null) || {};
    const scheduleId = generationParams.scheduleId;
    if (!scheduleId) {
      return { success: false, error: 'Content is not scheduled in AWS' };
    }

    const brandTimezone = await TimezoneService.getBrandTimezone(content.brandId);
    const localTime = scheduledLocalTime(content.scheduledAt, brandTimezone);
    const prepared = await prepareSchedulingPayload(
      {
        brandId: content.brandId,
        contentType: content.contentType,
        caption: content.caption,
        firstComment: content.firstComment,
        hashtags: Array.isArray(content.hashtags) ? content.hashtags : null,
        shareToFeed: content.shareToFeed,
        thumbOffset: content.thumbOffset,
        targetSocialAccountId: (content as any).targetSocialAccountId ?? null,
        mediaAssets: (content.mediaAssets || []).map((asset) => ({
          assetId: asset.assetId,
          displayOrder: asset.displayOrder,
        })),
      },
      'update',
      false
    );
    if (!prepared.ok) {
      return { success: false, error: prepared.error };
    }

    const updatePayload = buildUpdatePayload({
      content,
      prepared: prepared.data,
      brandTimezone,
      localTime,
    });
    await (await service.client).updateSchedule(scheduleId, updatePayload);
    logger.info('AWS schedule content updated successfully', { scheduleId, contentId });
    return { success: true };
  } catch (error) {
    logger.error('Error updating scheduled content payload', { error, contentId });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
