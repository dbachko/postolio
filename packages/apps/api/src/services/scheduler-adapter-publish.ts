import type { ContentStatus } from '@postolio/database';
import { getDatabaseClient } from '../config/database.js';
import { TimezoneService } from './timezone.js';
import type { GenerationParams } from '../types/scheduler.js';
import type { CreateScheduleInput } from '../clients/content-scheduler-client.js';
import { logger } from '@postolio/logger';
import { eventEmitter } from './event-emitter.js';
import { prepareSchedulingPayload } from './scheduler-adapter-payload.js';
import { buildCreateSchedulePayload } from './scheduler-adapter-schedule-helpers.js';

const prisma = getDatabaseClient();

type ServiceLike = any;
type PublishResult = {
  success: boolean;
  scheduleId?: string;
  brandId?: string;
  error?: string;
};

type LoadedPublishContent = NonNullable<Awaited<ReturnType<typeof loadContentForPublish>>>;

async function loadContentForPublish(contentId: string) {
  return prisma.content.findUnique({
    where: { id: contentId },
    include: {
      brand: { include: { user: true } },
      mediaAssets: {
        select: { displayOrder: true, assetId: true },
        orderBy: { displayOrder: 'asc' },
      },
    },
  });
}

function readOriginalSchedulingError(content: LoadedPublishContent): string | null {
  return typeof (content as any).schedulingError === 'string'
    ? String((content as any).schedulingError)
    : null;
}

async function setPublishProcessingState(params: {
  contentId: string;
  currentParams: GenerationParams;
  scheduledTimeUTC: Date;
  operationId: string;
}) {
  await prisma.content.update({
    where: { id: params.contentId },
    data: {
      status: 'scheduled' as ContentStatus,
      scheduledAt: params.scheduledTimeUTC,
      schedulingError: null,
      generationParams: {
        ...params.currentParams,
        processing: {
          active: true,
          operation: 'scheduling',
          startedAt: new Date().toISOString(),
          operationId: params.operationId,
        },
      },
    },
  });
}

async function restorePublishFailureState(params: {
  contentId: string;
  originalStatus: ContentStatus | null;
  originalScheduledAt: Date | null;
  originalSchedulingError: string | null;
  currentParams: GenerationParams;
}) {
  if (params.originalStatus === null) {
    return;
  }
  await prisma.content.update({
    where: { id: params.contentId },
    data: {
      status: params.originalStatus,
      scheduledAt: params.originalScheduledAt,
      schedulingError: params.originalSchedulingError,
      generationParams: JSON.parse(
        JSON.stringify({
          ...params.currentParams,
          processing: null,
        })
      ),
    },
  });
}

async function persistPublishScheduleMetadata(params: {
  contentId: string;
  currentParams: GenerationParams;
  operationId: string;
  scheduleId: string;
}) {
  const updatedParams = {
    ...params.currentParams,
    processing: params.currentParams.processing || {
      active: true,
      operation: 'scheduling',
      startedAt: new Date().toISOString(),
      operationId: params.operationId,
    },
    scheduleId: params.scheduleId,
    awsScheduleCreated: true,
  } as GenerationParams;
  await prisma.content.update({
    where: { id: params.contentId },
    data: {
      generationParams: JSON.parse(JSON.stringify(updatedParams)),
    },
  });
}

async function buildPublishPayload(params: {
  content: LoadedPublishContent;
  brandTimezone: string;
  scheduledTimeUTC: Date;
  userId?: string;
}): Promise<{ ok: true; payload: CreateScheduleInput } | { ok: false; error: string }> {
  const prepared = await prepareSchedulingPayload(
    {
      brandId: params.content.brandId,
      contentType: params.content.contentType,
      caption: params.content.caption,
      firstComment: params.content.firstComment,
      hashtags: Array.isArray(params.content.hashtags) ? params.content.hashtags : null,
      shareToFeed: params.content.shareToFeed,
      thumbOffset: params.content.thumbOffset,
      targetSocialAccountId: (params.content as any).targetSocialAccountId ?? null,
      mediaAssets: (params.content.mediaAssets || []).map((asset) => ({
        assetId: asset.assetId,
        displayOrder: asset.displayOrder,
      })),
    },
    'publish',
    true
  );
  if (!prepared.ok) {
    return { ok: false, error: prepared.error };
  }
  const payload = buildCreateSchedulePayload({
    content: params.content as any,
    brandTimezone: params.brandTimezone,
    customTime: params.scheduledTimeUTC,
    userId: params.userId,
    scheduledTimeUTC: params.scheduledTimeUTC,
    prepared: prepared.data,
  });
  return { ok: true, payload };
}

async function handlePublishNowFailure(params: {
  contentId: string;
  fetchedContent: { brandId: string; brand: { userId: string } } | null;
  message: string;
  originalStatus: ContentStatus | null;
  originalScheduledAt: Date | null;
  originalSchedulingError: string | null;
  currentParams: GenerationParams;
  error: unknown;
}) {
  logger.error('Error publishing content (publish-now)', {
    error: params.error,
    contentId: params.contentId,
  });
  try {
    await eventEmitter.emitScheduleFailed({
      contentId: params.contentId,
      brandId: params.fetchedContent?.brandId,
      operation: 'create',
      error: params.message,
    });
  } catch (emitError) {
    logger.warn('Failed to emit schedule.failed event from publish-now catch', {
      contentId: params.contentId,
      error: emitError,
    });
  }
  try {
    await restorePublishFailureState({
      contentId: params.contentId,
      originalStatus: params.originalStatus,
      originalScheduledAt: params.originalScheduledAt,
      originalSchedulingError: params.originalSchedulingError,
      currentParams: params.currentParams,
    });
  } catch (restoreError) {
    logger.error('Failed to restore original state after publish-now failure', {
      error: restoreError,
      contentId: params.contentId,
    });
  }
}

export async function publishNowImpl(
  service: ServiceLike,
  contentId: string,
  userId?: string
): Promise<PublishResult> {
  let originalStatus: ContentStatus | null = null;
  let originalScheduledAt: Date | null = null;
  let originalSchedulingError: string | null = null;
  let currentParams: GenerationParams = {};
  let fetchedContent: { brandId: string; brand: { userId: string } } | null = null;

  try {
    const content = await loadContentForPublish(contentId);
    if (!content) {
      return { success: false, error: 'Content not found' };
    }
    fetchedContent = { brandId: content.brandId, brand: { userId: content.brand.userId } };
    originalStatus = content.status as ContentStatus;
    originalScheduledAt = content.scheduledAt;
    originalSchedulingError = readOriginalSchedulingError(content);
    if ((content.status as unknown as string) === 'published') {
      return { success: false, error: 'Content is already published' };
    }

    currentParams = (content.generationParams as GenerationParams | null) || {};
    const brandTimezone = await TimezoneService.getBrandTimezone(content.brandId);
    const scheduledTimeUTC = new Date();
    const operationId = `${Date.now()}-${contentId}`;
    const payloadResult = await buildPublishPayload({
      content,
      brandTimezone,
      scheduledTimeUTC,
      userId,
    });
    if (!payloadResult.ok) {
      return { success: false, error: payloadResult.error };
    }

    await setPublishProcessingState({
      contentId,
      currentParams,
      scheduledTimeUTC,
      operationId,
    });
    const schedule = await (await service.client).publishNow(payloadResult.payload);
    const scheduleId = schedule?.scheduleId;
    if (!scheduleId) {
      throw new Error('Failed to enqueue publish request');
    }
    await persistPublishScheduleMetadata({ contentId, currentParams, operationId, scheduleId });
    return { success: true, scheduleId, brandId: content.brandId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await handlePublishNowFailure({
      contentId,
      fetchedContent,
      message,
      originalStatus,
      originalScheduledAt,
      originalSchedulingError,
      currentParams,
      error,
    });
    return { success: false, error: message };
  }
}
