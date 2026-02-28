import { logger } from '@postolio/logger';
import type { ContentStatus } from '@postolio/database';
import { prepareSchedulingPayload } from './scheduler-adapter-payload.js';
import { rollbackSchedulingFailure } from './scheduler-adapter-schedule-rollback.js';
import {
  buildCreateSchedulePayload,
  createSchedulingAttemptSetup,
  emitScheduleFailed,
  persistSchedulingFailure,
  persistSchedulingSuccess,
  scheduleFailureMessage,
  type LoadedScheduleContent,
  type ScheduleResult,
} from './scheduler-adapter-schedule-helpers.js';

type ServiceLike = any;

async function createAwsScheduleForAttempt(params: {
  service: ServiceLike;
  customTime?: Date;
  userId?: string;
  content: LoadedScheduleContent;
  brandTimezone: string;
  scheduledTimeUTC: Date;
}): Promise<{
  scheduleId?: string;
  scheduleCreationError?: unknown;
  immediateFailureMessage?: string;
}> {
  if (!params.service.schedulerEnabled) {
    return { scheduleCreationError: new Error('Scheduler disabled') };
  }

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
    'schedule',
    true
  );
  if (!prepared.ok) {
    return { immediateFailureMessage: prepared.error };
  }

  try {
    const payload = buildCreateSchedulePayload({
      content: params.content,
      brandTimezone: params.brandTimezone,
      customTime: params.customTime,
      userId: params.userId,
      scheduledTimeUTC: params.scheduledTimeUTC,
      prepared: prepared.data,
    });
    const schedule = await (await params.service.client).createSchedule(payload);
    return { scheduleId: schedule?.scheduleId };
  } catch (error) {
    return { scheduleCreationError: error };
  }
}

async function finalizeScheduleSuccess(params: {
  service: ServiceLike;
  content: LoadedScheduleContent;
  contentId: string;
  currentParams: any;
  operationId: string;
  scheduledTimeUTC: Date;
  scheduleId: string;
  brandTimezone: string;
  originalStatus: ContentStatus | null;
}) {
  await persistSchedulingSuccess({
    content: params.content,
    contentId: params.contentId,
    currentParams: params.currentParams,
    operationId: params.operationId,
    scheduledTimeUTC: params.scheduledTimeUTC,
    scheduleId: params.scheduleId,
  });
  if (!params.service.broadcaster) {
    return;
  }
  await params.service.broadcaster.broadcastStatusChange(
    params.content.id,
    params.content.brandId,
    params.originalStatus,
    'scheduled',
    {
      scheduleId: params.scheduleId,
      scheduledAt: params.scheduledTimeUTC.toISOString(),
      timezone: params.brandTimezone,
    }
  );
}

export async function scheduleContentImpl(
  service: ServiceLike,
  contentId: string,
  customTime?: Date,
  userId?: string
): Promise<ScheduleResult> {
  let rollbackStatus: ContentStatus | null = null;
  let rollbackScheduledAt: Date | null = null;
  let rollbackFetchedContent: { brandId: string; brand: { userId: string } } | null = null;

  try {
    const setup = await createSchedulingAttemptSetup({ service, contentId, customTime, userId });
    if (!setup.ok) {
      return setup.result;
    }

    rollbackStatus = setup.originalStatus;
    rollbackScheduledAt = setup.originalScheduledAt;
    rollbackFetchedContent = setup.fetchedContent;

    const awsResult = await createAwsScheduleForAttempt({
      service,
      customTime,
      userId,
      content: setup.content,
      brandTimezone: setup.brandTimezone,
      scheduledTimeUTC: setup.scheduledTimeUTC,
    });
    if (awsResult.immediateFailureMessage) {
      await emitScheduleFailed(contentId, setup.content.brandId, awsResult.immediateFailureMessage);
      return scheduleFailureMessage(awsResult.immediateFailureMessage);
    }

    if (!awsResult.scheduleId) {
      await persistSchedulingFailure({
        contentId,
        scheduledTimeUTC: setup.scheduledTimeUTC,
        currentParams: setup.currentParams,
        scheduleCreationError: awsResult.scheduleCreationError,
      });
      const failure = 'AWS Scheduler unavailable - content not scheduled';
      await emitScheduleFailed(contentId, setup.content.brandId, failure);
      return scheduleFailureMessage(failure);
    }

    await finalizeScheduleSuccess({
      service,
      content: setup.content,
      contentId,
      currentParams: setup.currentParams,
      operationId: setup.operationId,
      scheduledTimeUTC: setup.scheduledTimeUTC,
      scheduleId: awsResult.scheduleId,
      brandTimezone: setup.brandTimezone,
      originalStatus: rollbackStatus,
    });

    return { success: true, scheduleId: awsResult.scheduleId, brandId: setup.content.brandId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error scheduling content', { error, contentId });
    await emitScheduleFailed(contentId, rollbackFetchedContent?.brandId, message);
    await rollbackSchedulingFailure({
      contentId,
      originalStatus: rollbackStatus,
      originalScheduledAt: rollbackScheduledAt,
      message,
      fetchedContent: rollbackFetchedContent,
      userId,
    });
    return scheduleFailureMessage(message);
  }
}
