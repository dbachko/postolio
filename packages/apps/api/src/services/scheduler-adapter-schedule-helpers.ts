import { randomUUID } from 'crypto';
import type { ContentStatus } from '@postolio/database';
import type { CreateScheduleInput } from '../clients/content-scheduler-client.js';
import { SCHEDULER_TIME_INTERVALS } from '../constants/scheduler.js';
import { getDatabaseClient } from '../config/database.js';
import { TimezoneService } from './timezone.js';
import type { GenerationParams } from '../types/scheduler.js';
import { eventEmitter } from './event-emitter.js';
import { logger } from '@postolio/logger';
import { getMaxScheduledAheadForTier } from '../constants/subscription.js';
import type { PreparedSchedulingPayload } from './scheduler-adapter-payload.js';

const prisma: ReturnType<typeof getDatabaseClient> = getDatabaseClient();

type ServiceLike = any;

export type ScheduleResult = {
  success: boolean;
  scheduleId?: string;
  brandId?: string;
  error?: string;
};

export type LoadedScheduleContent = {
  id: string;
  brandId: string;
  caption: string | null;
  contentType: string | null;
  firstComment: string | null;
  hashtags: string[] | null;
  shareToFeed: boolean | null;
  thumbOffset: number | null;
  scheduledAt: Date | null;
  status: ContentStatus;
  generationParams: unknown;
  mediaAssets: Array<{ displayOrder: number | null; assetId: string }>;
  brand: {
    id: string;
    userId: string;
    user: {
      subscriptionTier: string | null;
    } | null;
  };
};

export function scheduleFailureMessage(message: string): ScheduleResult {
  return { success: false, error: message };
}

async function loadContentForScheduling(contentId: string): Promise<LoadedScheduleContent | null> {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: {
      brand: { include: { user: true } },
      mediaAssets: {
        select: { displayOrder: true, assetId: true },
        orderBy: { displayOrder: 'asc' },
      },
    },
  });
  return content as LoadedScheduleContent | null;
}

export async function emitScheduleFailed(
  contentId: string,
  brandId: string | undefined,
  message: string
) {
  try {
    await eventEmitter.emitScheduleFailed({
      contentId,
      brandId,
      operation: 'create',
      error: message,
    });
  } catch (error) {
    logger.warn('Failed to emit schedule.failed event', { contentId, error });
  }
}

export async function enforcePlanLimit(content: LoadedScheduleContent): Promise<string | null> {
  try {
    const tier = content.brand?.user?.subscriptionTier || 'free';
    const maxAhead = getMaxScheduledAheadForTier(tier);
    if (!Number.isFinite(maxAhead)) {
      return null;
    }
    const futureCountExcludingThis = await prisma.content.count({
      where: {
        brandId: content.brandId,
        id: { not: content.id },
        scheduledAt: { gte: new Date() },
        status: { in: ['scheduled', 'draft'] },
      },
    });
    if (futureCountExcludingThis + 1 > maxAhead) {
      return `Upgrade required: your plan allows up to ${maxAhead} scheduled posts ahead`;
    }
    return null;
  } catch (error) {
    logger.warn('Plan limit check failed; proceeding without limit enforcement', { error });
    return null;
  }
}

export function resolveScheduledTime(params: {
  customTime?: Date;
  existingScheduledAt?: Date | null;
  brandTimezone: string;
  brandId: string;
}): { scheduledTimeUTC?: Date; error?: string } {
  if (params.customTime) {
    const candidate =
      params.customTime instanceof Date ? params.customTime : new Date(params.customTime);
    if (Number.isNaN(candidate.getTime())) {
      return { error: 'Invalid scheduled time provided' };
    }
    const needsConversion =
      typeof params.customTime === 'string' && !/[zZ]|[+-]\d{2}:\d{2}$/.test(params.customTime);
    if (needsConversion) {
      const scheduledTimeUTC = TimezoneService.toUTC(candidate, params.brandTimezone);
      logger.warn('Received timezone-naive customTime; converted using brand timezone', {
        brandId: params.brandId,
        timezone: params.brandTimezone,
        requestedAt: params.customTime,
        scheduledAtUTC: scheduledTimeUTC.toISOString(),
      });
      return { scheduledTimeUTC };
    }
    return { scheduledTimeUTC: candidate };
  }
  if (params.existingScheduledAt) {
    return { scheduledTimeUTC: new Date(params.existingScheduledAt) };
  }
  const defaultTimeLocal = new Date(
    Date.now() + SCHEDULER_TIME_INTERVALS.DEFAULT_SCHEDULE_DELAY_MS
  );
  return { scheduledTimeUTC: TimezoneService.toUTC(defaultTimeLocal, params.brandTimezone) };
}

export async function cancelExistingProcessingIfNeeded(params: {
  service: ServiceLike;
  contentId: string;
  content: LoadedScheduleContent;
  currentParams: GenerationParams;
  userId?: string;
}) {
  if (!params.currentParams.processing?.active || !params.currentParams.scheduleId) {
    return;
  }
  try {
    await (
      await params.service.client
    ).deleteSchedule(params.currentParams.scheduleId, {
      userId: params.userId || params.content.brand.userId,
    });
    logger.info('Deleted existing AWS schedule', { scheduleId: params.currentParams.scheduleId });
  } catch (error) {
    const code =
      typeof error === 'object' && error && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
    if (code === 'NOT_FOUND') {
      logger.info('Schedule already deleted in scheduler service', {
        scheduleId: params.currentParams.scheduleId,
      });
      return;
    }
    logger.warn('Failed to cancel existing schedule', {
      scheduleId: params.currentParams.scheduleId,
      error,
    });
  }
}

export async function setSchedulingProcessingState(
  contentId: string,
  currentParams: GenerationParams,
  operationId: string
) {
  await prisma.content.update({
    where: { id: contentId },
    data: {
      generationParams: {
        ...currentParams,
        processing: {
          active: true,
          operation: 'scheduling',
          startedAt: new Date().toISOString(),
          operationId,
        },
      },
    },
  });
}

function scheduleCreationErrorMessage(error: unknown): string {
  const validationErrors =
    typeof (error as { details?: { errors?: unknown[] } }).details?.errors === 'object'
      ? ((error as { details?: { errors?: unknown[] } }).details?.errors as unknown[])
      : undefined;
  if (Array.isArray(validationErrors) && validationErrors.length > 0) {
    return String(validationErrors[0]);
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'AWS Scheduler unavailable - content not scheduled';
}

export async function persistSchedulingFailure(params: {
  contentId: string;
  scheduledTimeUTC: Date;
  currentParams: GenerationParams;
  scheduleCreationError: unknown;
}) {
  await prisma.content.update({
    where: { id: params.contentId },
    data: {
      status: 'failed',
      scheduledAt: params.scheduledTimeUTC,
      schedulingError: scheduleCreationErrorMessage(params.scheduleCreationError),
      generationParams: {
        ...params.currentParams,
        processing: null,
        awsScheduleCreated: false,
      },
    },
  });
}

export async function persistSchedulingSuccess(params: {
  content: LoadedScheduleContent;
  contentId: string;
  currentParams: GenerationParams;
  operationId: string;
  scheduledTimeUTC: Date;
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
  const needsScheduledAtUpdate =
    !params.content.scheduledAt ||
    params.content.scheduledAt.getTime() !== params.scheduledTimeUTC.getTime();
  await prisma.content.update({
    where: { id: params.contentId },
    data: {
      ...(needsScheduledAtUpdate ? { scheduledAt: params.scheduledTimeUTC } : {}),
      generationParams: JSON.parse(JSON.stringify(updatedParams)),
    },
  });
}

function resolveScheduleUserId(params: {
  userId?: string;
  content: LoadedScheduleContent;
}): string {
  return params.userId || params.content.brand.userId;
}

function buildCreateScheduleMetadata(params: {
  prepared: PreparedSchedulingPayload;
  brandTimezone: string;
  customTime?: Date;
}) {
  return {
    socialAccountId: params.prepared.socialAccountId,
    timezone: params.brandTimezone,
    localTime: params.customTime ? params.customTime.toISOString() : undefined,
  };
}

function buildInstagramScheduleFields(params: {
  content: LoadedScheduleContent;
  prepared: PreparedSchedulingPayload;
}): Partial<CreateScheduleInput> {
  const fields: Partial<CreateScheduleInput> = {};
  if (params.prepared.schedulerPlatform !== 'instagram') {
    return fields;
  }

  if (
    typeof params.content.firstComment === 'string' &&
    params.content.firstComment.trim().length > 0
  ) {
    fields.firstComment = params.content.firstComment.trim();
  }

  if (Array.isArray(params.content.hashtags) && params.content.hashtags.length > 0) {
    fields.hashtags = params.content.hashtags;
  }

  if (
    params.prepared.normalizedContentType === 'reel' &&
    typeof params.content.shareToFeed === 'boolean'
  ) {
    fields.shareToFeed = Boolean(params.content.shareToFeed);
  }

  if (typeof params.content.thumbOffset === 'number' && params.content.thumbOffset >= 0) {
    fields.thumbOffset = params.content.thumbOffset;
  }

  return fields;
}

function buildMediaAssetsField(prepared: PreparedSchedulingPayload): Partial<CreateScheduleInput> {
  if (prepared.structuredMediaAssets.length === 0) {
    return {};
  }
  return { mediaAssets: prepared.structuredMediaAssets };
}

export function buildCreateSchedulePayload(params: {
  content: LoadedScheduleContent;
  brandTimezone: string;
  customTime?: Date;
  userId?: string;
  scheduledTimeUTC: Date;
  prepared: PreparedSchedulingPayload;
}): CreateScheduleInput {
  const { content, prepared } = params;
  const optionalInstagramFields = buildInstagramScheduleFields({ content, prepared });
  return {
    contentId: content.id,
    brandId: content.brandId,
    userId: resolveScheduleUserId({ userId: params.userId, content }),
    platform: prepared.schedulerPlatform,
    scheduledAt: params.scheduledTimeUTC.toISOString(),
    contentType: prepared.normalizedContentType,
    ...(prepared.normalizedMediaType ? { mediaType: prepared.normalizedMediaType } : {}),
    caption: content.caption || '',
    ...optionalInstagramFields,
    metadata: buildCreateScheduleMetadata({
      prepared,
      brandTimezone: params.brandTimezone,
      customTime: params.customTime,
    }),
    ...buildMediaAssetsField(prepared),
  };
}

export async function createSchedulingAttemptSetup(params: {
  service: ServiceLike;
  contentId: string;
  customTime?: Date;
  userId?: string;
}): Promise<
  | {
      ok: true;
      content: LoadedScheduleContent;
      brandTimezone: string;
      scheduledTimeUTC: Date;
      currentParams: GenerationParams;
      operationId: string;
      originalStatus: ContentStatus;
      originalScheduledAt: Date | null;
      fetchedContent: { brandId: string; brand: { userId: string } };
    }
  | { ok: false; result: ScheduleResult }
> {
  const content = await loadContentForScheduling(params.contentId);
  if (!content) {
    await emitScheduleFailed(params.contentId, undefined, 'Content not found');
    return { ok: false, result: scheduleFailureMessage('Content not found') };
  }
  const fetchedContent = { brandId: content.brandId, brand: { userId: content.brand.userId } };
  const originalStatus = content.status as ContentStatus;
  const originalScheduledAt = content.scheduledAt;

  const planLimitError = await enforcePlanLimit(content);
  if (planLimitError) {
    await emitScheduleFailed(params.contentId, content.brandId, planLimitError);
    return { ok: false, result: scheduleFailureMessage(planLimitError) };
  }

  const brandTimezone = await TimezoneService.getBrandTimezone(content.brandId);
  const timeResolution = resolveScheduledTime({
    customTime: params.customTime,
    existingScheduledAt: content.scheduledAt,
    brandTimezone,
    brandId: content.brandId,
  });
  if (!timeResolution.scheduledTimeUTC) {
    return {
      ok: false,
      result: scheduleFailureMessage(timeResolution.error || 'Invalid scheduled time'),
    };
  }

  const currentParams = (content.generationParams as GenerationParams | null) || {};
  const operationId = randomUUID();
  await cancelExistingProcessingIfNeeded({
    service: params.service,
    contentId: params.contentId,
    content,
    currentParams,
    userId: params.userId,
  });
  await setSchedulingProcessingState(params.contentId, currentParams, operationId);

  return {
    ok: true,
    content,
    brandTimezone,
    scheduledTimeUTC: timeResolution.scheduledTimeUTC,
    currentParams,
    operationId,
    originalStatus,
    originalScheduledAt,
    fetchedContent,
  };
}
