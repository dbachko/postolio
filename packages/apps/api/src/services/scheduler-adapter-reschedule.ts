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
type RescheduleResult = { success: boolean; error?: string };
type LoadedRescheduleContent = NonNullable<Awaited<ReturnType<typeof loadContentForReschedule>>>;

async function loadContentForReschedule(contentId: string) {
  return prisma.content.findUnique({
    where: { id: contentId },
    include: {
      brand: { select: { id: true, name: true, userId: true } },
      mediaAssets: { select: { displayOrder: true, assetId: true } },
    },
  });
}

function newTimeForSchedulingCall(
  newTimeUTC: Date,
  brandTimezone: string,
  isLocalTime: boolean,
  newTime: Date
) {
  return isLocalTime ? newTime : TimezoneService.toLocal(newTimeUTC, brandTimezone);
}

async function attemptRecoverySchedule(params: {
  service: ServiceLike;
  content: LoadedRescheduleContent;
  contentId: string;
  brandTimezone: string;
  newTimeUTC: Date;
  isLocalTime: boolean;
  newTime: Date;
  reason: 'missing_schedule_id' | 'inconsistent_status';
}): Promise<RescheduleResult> {
  const localTime = newTimeForSchedulingCall(
    params.newTimeUTC,
    params.brandTimezone,
    params.isLocalTime,
    params.newTime
  );
  const scheduleResult = await params.service.scheduleContent(
    params.contentId,
    localTime,
    params.content.brand.userId
  );
  if (!scheduleResult.success) {
    return {
      success: false,
      error:
        params.reason === 'missing_schedule_id'
          ? `Failed to schedule content: ${scheduleResult.error}`
          : `Failed to create schedule: ${scheduleResult.error}`,
    };
  }
  if (
    params.reason === 'missing_schedule_id' &&
    params.content.scheduledAt &&
    params.content.scheduledAt.getTime() !== params.newTimeUTC.getTime()
  ) {
    await prisma.content.update({
      where: { id: params.contentId },
      data: {
        scheduledAt: params.newTimeUTC,
        schedulingError: null,
      },
    });
  }
  return { success: true };
}

function readErrorDetailsMessage(details: unknown): string | null {
  if (!details || typeof details !== 'object') {
    return null;
  }
  const parsed = details as Record<string, unknown>;
  if (typeof parsed.error === 'string') {
    return parsed.error;
  }
  if (typeof parsed.message === 'string') {
    return parsed.message;
  }
  return null;
}

function normalizeAwsRescheduleError(error: unknown): string {
  const err = error as
    { code?: string; message?: string; details?: Record<string, unknown> } | undefined;
  const detailsMessage = readErrorDetailsMessage(err?.details);
  if (err?.code === 'CIRCUIT_BREAKER_OPEN' || err?.code === 'EOPENBREAKER') {
    return 'AWS scheduler temporarily unavailable. Please try again in a few minutes.';
  }
  if (err?.code === 'NETWORK_ERROR' || err?.code === 'TIMEOUT') {
    return 'Network error connecting to scheduler service. Please check your connection and try again.';
  }
  if (err?.code === 'SERVICE_BUSY') {
    return 'Scheduler service is busy. Please retry shortly.';
  }
  return `Failed to reschedule: ${detailsMessage || err?.message || 'Unknown AWS scheduler error'}`;
}

function buildReschedulePayload(params: {
  content: LoadedRescheduleContent;
  scheduleId: string;
  brandTimezone: string;
  newTimeUTC: Date;
  isLocalTime: boolean;
  newTime: Date;
  prepared: PreparedSchedulingPayload;
}): UpdateScheduleInput {
  const updatePayload: UpdateScheduleInput = {
    scheduledAt: params.newTimeUTC.toISOString(),
    brandId: params.content.brandId,
    contentId: params.content.id,
    userId: params.content.brand.userId,
    caption: params.content.caption || '',
    platform: params.prepared.schedulerPlatform,
  };
  const localTimeValue = params.isLocalTime
    ? params.newTime
    : TimezoneService.toLocal(params.newTimeUTC, params.brandTimezone);
  updatePayload.metadata = {
    timezone: params.brandTimezone,
    localTime: localTimeValue.toISOString(),
    socialAccountId: params.prepared.socialAccountId,
  };
  if (
    params.prepared.schedulerPlatform === 'instagram' &&
    typeof params.content.firstComment === 'string'
  ) {
    const trimmed = params.content.firstComment.trim();
    if (trimmed.length > 0) {
      updatePayload.firstComment = trimmed;
    }
  }
  if (
    params.prepared.schedulerPlatform === 'instagram' &&
    typeof params.content.shareToFeed === 'boolean'
  ) {
    updatePayload.shareToFeed = Boolean(params.content.shareToFeed);
  }
  updatePayload.mediaAssets = params.prepared.structuredMediaAssets;
  if (Array.isArray(params.content.hashtags) && params.content.hashtags.length) {
    updatePayload.hashtags = params.content.hashtags;
  }
  if (typeof params.content.thumbOffset === 'number' && params.content.thumbOffset >= 0) {
    updatePayload.thumbOffset = params.content.thumbOffset;
  }
  return updatePayload;
}

async function persistRescheduleSuccess(params: {
  contentId: string;
  generationParams: GenerationParams;
  brandTimezone: string;
  newTimeUTC: Date;
  isLocalTime: boolean;
  newTime: Date;
}) {
  await prisma.content.update({
    where: { id: params.contentId },
    data: {
      scheduledAt: params.newTimeUTC,
      schedulingError: null,
      generationParams: JSON.parse(
        JSON.stringify({
          ...params.generationParams,
          scheduledTimezone: params.brandTimezone,
          rescheduledAt: new Date().toISOString(),
          rescheduledLocalTime: params.isLocalTime ? params.newTime.toISOString() : undefined,
        })
      ),
    },
  });
}

async function rescheduleExistingAwsSchedule(params: {
  service: ServiceLike;
  content: LoadedRescheduleContent;
  scheduleId: string;
  brandTimezone: string;
  newTimeUTC: Date;
  isLocalTime: boolean;
  newTime: Date;
}): Promise<RescheduleResult> {
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
    'reschedule',
    false
  );
  if (!prepared.ok) {
    return { success: false, error: prepared.error };
  }
  try {
    const payload = buildReschedulePayload({
      content: params.content,
      scheduleId: params.scheduleId,
      brandTimezone: params.brandTimezone,
      newTimeUTC: params.newTimeUTC,
      isLocalTime: params.isLocalTime,
      newTime: params.newTime,
      prepared: prepared.data,
    });
    await (await params.service.client).updateSchedule(params.scheduleId, payload);
    return { success: true };
  } catch (error) {
    logger.error('Failed to reschedule in AWS', { error });
    return { success: false, error: normalizeAwsRescheduleError(error) };
  }
}

async function persistRescheduleOrLogInconsistency(params: {
  service: ServiceLike;
  contentId: string;
  generationParams: GenerationParams;
  brandTimezone: string;
  newTimeUTC: Date;
  isLocalTime: boolean;
  newTime: Date;
  scheduleId: string;
}): Promise<RescheduleResult> {
  try {
    await persistRescheduleSuccess({
      contentId: params.contentId,
      generationParams: params.generationParams,
      brandTimezone: params.brandTimezone,
      newTimeUTC: params.newTimeUTC,
      isLocalTime: params.isLocalTime,
      newTime: params.newTime,
    });
    return { success: true };
  } catch (dbError) {
    logger.error('CRITICAL: AWS reschedule succeeded but local DB update failed', {
      error: dbError,
    });
    await params.service.logInconsistency(
      params.contentId,
      'LOCAL_DB_UPDATE_FAILED_AFTER_AWS_SUCCESS',
      {
        awsScheduleId: params.scheduleId,
        newTime: params.newTimeUTC.toISOString(),
        error: dbError,
      }
    );
    return {
      success: false,
      error: 'Schedule was updated in AWS but local database sync failed. Please refresh the page.',
    };
  }
}

export async function rescheduleContentImpl(
  service: ServiceLike,
  contentId: string,
  newTime: Date,
  isLocalTime = true
): Promise<RescheduleResult> {
  try {
    const content = await loadContentForReschedule(contentId);
    if (!content) {
      return { success: false, error: 'Content not found' };
    }
    const brandTimezone = await TimezoneService.getBrandTimezone(content.brandId);
    const newTimeUTC = isLocalTime ? TimezoneService.toUTC(newTime, brandTimezone) : newTime;
    const generationParams = (content.generationParams as GenerationParams | null) || {};
    const scheduleId = generationParams.scheduleId;

    if (!scheduleId && content.scheduledAt) {
      return attemptRecoverySchedule({
        service,
        content,
        contentId,
        brandTimezone,
        newTimeUTC,
        isLocalTime,
        newTime,
        reason: 'missing_schedule_id',
      });
    }
    if (!scheduleId && content.status === 'scheduled') {
      return attemptRecoverySchedule({
        service,
        content,
        contentId,
        brandTimezone,
        newTimeUTC,
        isLocalTime,
        newTime,
        reason: 'inconsistent_status',
      });
    }
    if (!scheduleId) {
      return {
        success: false,
        error: 'Content is not scheduled. Please use the schedule action instead of reschedule.',
      };
    }

    const awsResult = await rescheduleExistingAwsSchedule({
      service,
      content,
      scheduleId,
      brandTimezone,
      newTimeUTC,
      isLocalTime,
      newTime,
    });
    if (!awsResult.success) {
      return awsResult;
    }
    return persistRescheduleOrLogInconsistency({
      service,
      contentId,
      generationParams,
      brandTimezone,
      newTimeUTC,
      isLocalTime,
      newTime,
      scheduleId,
    });
  } catch (error) {
    logger.error('Error rescheduling content', { error });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
