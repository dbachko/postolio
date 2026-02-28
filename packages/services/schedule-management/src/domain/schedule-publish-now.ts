import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { SCHEDULE_STATUS } from '../config';
import {
  docClient,
  eventBridgeClient,
  getEventBusName,
  getSchedulerEventBusTargetConfig,
  scheduleLogger,
  scheduleMetrics,
  schedulerClient,
} from './schedule-context';
import { emitScheduleEvent, emitScheduleFailedEvent } from './schedule-events';
import type {
  PublishNowScheduleRequest,
  Schedule,
  ScheduleRequest,
  ScheduleResult,
} from '../types/schedule';

type ScheduleConfig = {
  schedulesTable: string;
};

type GetScheduleFn = (scheduleId: string) => Promise<ScheduleResult>;

interface PublishNowOperationArgs {
  config: ScheduleConfig;
  request: PublishNowScheduleRequest;
  getSchedule: GetScheduleFn;
}

export async function publishNowOperation({
  config,
  request,
  getSchedule,
}: PublishNowOperationArgs): Promise<ScheduleResult> {
  scheduleLogger.info('Publishing now', {
    contentId: request.contentId,
    brandId: request.brandId,
    platform: request.platform,
  });

  try {
    const existingSchedule = await getExistingSchedule(config, request.contentId);
    const next = await upsertPublishNowSchedule(config, request, existingSchedule);

    await deleteSchedulerIfExists(next.scheduleId);

    if (!existingSchedule) {
      const visible = await waitForScheduleVisibility(getSchedule, next.scheduleId);
      if (!visible) {
        return {
          success: false,
          error: 'Schedule record not yet available; please retry',
        };
      }
    }

    await emitScheduleDue(next);
    await emitScheduleEvent('schedule.created', next);
    scheduleMetrics.addMetric('PublishNowEnqueued', MetricUnit.Count, 1);

    return {
      success: true,
      schedule: next,
    };
  } catch (error) {
    scheduleLogger.error('Failed to publish now', {
      error,
      contentId: request.contentId,
    });

    scheduleMetrics.addMetric('PublishNowFailed', MetricUnit.Count, 1);
    await emitScheduleFailedEvent(
      undefined,
      error instanceof Error ? error.message : 'Unknown error',
      'create',
      { contentId: request.contentId, brandId: request.brandId, platform: request.platform }
    );

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function getExistingSchedule(
  config: ScheduleConfig,
  contentId: string
): Promise<Schedule | undefined> {
  const existing = await docClient.send(
    new GetCommand({
      TableName: config.schedulesTable,
      Key: { pk: `SCHEDULE#${contentId}`, sk: 'METADATA' },
      ConsistentRead: true,
    })
  );

  return existing.Item as Schedule | undefined;
}

async function upsertPublishNowSchedule(
  config: ScheduleConfig,
  request: PublishNowScheduleRequest,
  existingSchedule: Schedule | undefined
): Promise<Schedule> {
  const next = buildPublishNowSchedule(request, existingSchedule);

  if (existingSchedule) {
    assertScheduleOwnership(existingSchedule, request.userId);
    await putSchedule(config, next);
    return next;
  }

  try {
    await docClient.send(
      new PutCommand({
        TableName: config.schedulesTable,
        Item: next,
        ConditionExpression: 'attribute_not_exists(pk)',
      })
    );

    return next;
  } catch (error) {
    const resolved = await resolveConcurrentCreate(config, request, next);
    if (!resolved) {
      throw error;
    }

    return resolved;
  }
}

function buildPublishNowSchedule(
  request: PublishNowScheduleRequest,
  existingSchedule: Schedule | undefined
): Schedule {
  const now = new Date().toISOString();
  const pk = `SCHEDULE#${request.contentId}`;
  const idempotencyToken =
    request.idempotencyToken || existingSchedule?.idempotencyToken || randomUUID();

  return {
    pk,
    sk: 'METADATA',
    scheduleId: existingSchedule?.scheduleId || randomUUID(),
    contentId: request.contentId,
    brandId: request.brandId,
    userId: request.userId,
    status: SCHEDULE_STATUS.SCHEDULED,
    scheduledAt: now,
    gsi1pk: `BRAND#${request.brandId}`,
    gsi1sk: now,
    platform: request.platform,
    contentType: request.contentType,
    mediaType: request.mediaType,
    videoUrl: request.videoUrl,
    caption: request.caption,
    firstComment: request.firstComment,
    hashtags: request.hashtags || [],
    mediaAssets: request.mediaAssets,
    metadata: request.metadata,
    shareToFeed: request.shareToFeed,
    thumbOffset: request.thumbOffset,
    createdAt: existingSchedule?.createdAt || now,
    updatedAt: now,
    ttl: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
    eventBridgeScheduleCreated: false,
    eventBridgeScheduleArn: undefined,
    idempotencyToken,
  };
}

function assertScheduleOwnership(schedule: Schedule, userId: string): void {
  if (schedule.userId !== userId) {
    throw new Error('Forbidden: You do not have access to this schedule');
  }
}

async function putSchedule(config: ScheduleConfig, schedule: Schedule): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: config.schedulesTable,
      Item: schedule,
    })
  );
}

async function resolveConcurrentCreate(
  config: ScheduleConfig,
  request: PublishNowScheduleRequest,
  baseSchedule: Schedule
): Promise<Schedule | undefined> {
  const scheduleAgain = await getExistingSchedule(config, request.contentId);
  if (!scheduleAgain) {
    return undefined;
  }

  assertScheduleOwnership(scheduleAgain, request.userId);

  const next: Schedule = {
    ...baseSchedule,
    scheduleId: scheduleAgain.scheduleId,
    createdAt: scheduleAgain.createdAt || baseSchedule.createdAt,
    idempotencyToken: scheduleAgain.idempotencyToken || baseSchedule.idempotencyToken,
  };

  await putSchedule(config, next);
  return next;
}

async function deleteSchedulerIfExists(scheduleId: string): Promise<void> {
  try {
    const targetCfg = await getSchedulerEventBusTargetConfig();
    await schedulerClient.send(
      new DeleteScheduleCommand({
        Name: scheduleId,
        GroupName: targetCfg.groupName,
      })
    );
  } catch (deleteError) {
    scheduleLogger.debug('EventBridge schedule delete skipped/failed (ignored)', {
      scheduleId,
      error: deleteError,
    });
  }
}

async function waitForScheduleVisibility(
  getSchedule: GetScheduleFn,
  scheduleId: string
): Promise<boolean> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const found = await getSchedule(scheduleId);
    if (found.success && found.schedule) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  scheduleLogger.warn('Schedule not visible via scheduleId GSI; aborting publish-now emit', {
    scheduleId,
  });

  return false;
}

async function emitScheduleDue(schedule: Schedule): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'postolio.scheduling',
            DetailType: 'schedule.due',
            Detail: JSON.stringify({
              scheduleId: schedule.scheduleId,
              contentId: schedule.contentId,
              brandId: schedule.brandId,
              userId: schedule.userId,
            }),
            EventBusName: getEventBusName(),
          },
        ],
      })
    );
  } catch (error) {
    scheduleLogger.error('Failed to emit schedule.due event', {
      error,
      scheduleId: schedule.scheduleId,
    });

    throw new Error('Failed to enqueue publish event');
  }
}

export function asScheduleUpdateRequest(
  request: PublishNowScheduleRequest
): Partial<ScheduleRequest> {
  return {
    contentId: request.contentId,
    brandId: request.brandId,
    userId: request.userId,
    platform: request.platform,
    contentType: request.contentType,
    mediaType: request.mediaType,
    videoUrl: request.videoUrl,
    caption: request.caption,
    firstComment: request.firstComment,
    hashtags: request.hashtags,
    mediaAssets: request.mediaAssets,
    metadata: request.metadata,
    shareToFeed: request.shareToFeed,
    thumbOffset: request.thumbOffset,
  };
}
