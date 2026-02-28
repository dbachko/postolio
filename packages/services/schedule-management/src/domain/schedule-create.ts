import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { CreateScheduleCommand } from '@aws-sdk/client-scheduler';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { formatEventBridgeScheduleTime, SCHEDULE_STATUS } from '../config';
import {
  docClient,
  getSchedulerEventBusTargetConfig,
  scheduleLogger,
  scheduleMetrics,
  schedulerClient,
} from './schedule-context';
import { emitScheduleEvent, emitScheduleFailedEvent } from './schedule-events';
import type { Schedule, ScheduleRequest, ScheduleResult } from '../types/schedule';

type ScheduleConfig = {
  schedulesTable: string;
};

type UpdateScheduleFn = (
  scheduleId: string,
  updateRequest: Partial<ScheduleRequest>
) => Promise<ScheduleResult>;

interface CreateScheduleOperationArgs {
  config: ScheduleConfig;
  request: ScheduleRequest;
  updateSchedule: UpdateScheduleFn;
}

export async function createScheduleOperation({
  config,
  request,
  updateSchedule,
}: CreateScheduleOperationArgs): Promise<ScheduleResult> {
  scheduleLogger.info('Creating schedule', {
    contentId: request.contentId,
    brandId: request.brandId,
    scheduledAt: request.scheduledAt,
  });

  try {
    const schedule = buildNewSchedule(request);
    const reused = await insertOrReuseSchedule(config, request, schedule, updateSchedule);

    if (reused) {
      return reused;
    }

    const scheduleArn = await createSchedulerAndConfirm(config, schedule);
    const finalSchedule = {
      ...schedule,
      eventBridgeScheduleCreated: true,
      eventBridgeScheduleArn: scheduleArn,
    };

    await emitScheduleEvent('schedule.created', finalSchedule);
    scheduleMetrics.addMetric('ScheduleCreated', MetricUnit.Count, 1);

    return {
      success: true,
      schedule: finalSchedule,
    };
  } catch (error) {
    scheduleLogger.error('Failed to create schedule', {
      error,
      contentId: request.contentId,
    });

    scheduleMetrics.addMetric('ScheduleCreateFailed', MetricUnit.Count, 1);
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

function buildNewSchedule(request: ScheduleRequest): Schedule {
  const scheduleId = randomUUID();
  const idempotencyToken = request.idempotencyToken || randomUUID();
  const now = new Date().toISOString();

  return {
    pk: `SCHEDULE#${request.contentId}`,
    sk: 'METADATA',
    scheduleId,
    contentId: request.contentId,
    brandId: request.brandId,
    userId: request.userId,
    status: SCHEDULE_STATUS.SCHEDULED,
    scheduledAt: request.scheduledAt,
    gsi1pk: `BRAND#${request.brandId}`,
    gsi1sk: request.scheduledAt,
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
    createdAt: now,
    updatedAt: now,
    ttl: Math.floor((new Date(request.scheduledAt).getTime() + 30 * 24 * 60 * 60 * 1000) / 1000),
    eventBridgeScheduleCreated: false,
    idempotencyToken,
  };
}

async function insertOrReuseSchedule(
  config: ScheduleConfig,
  request: ScheduleRequest,
  schedule: Schedule,
  updateSchedule: UpdateScheduleFn
): Promise<ScheduleResult | undefined> {
  try {
    await docClient.send(
      new PutCommand({
        TableName: config.schedulesTable,
        Item: schedule,
        ConditionExpression: 'attribute_not_exists(pk)',
      })
    );

    return undefined;
  } catch (error) {
    if ((error as Error)?.name !== 'ConditionalCheckFailedException') {
      throw error;
    }

    const existing = await getScheduleByContentId(config, request.contentId);
    if (!existing) {
      throw error;
    }

    if (existing.scheduledAt === request.scheduledAt) {
      return clearStaleSchedulingError(config, existing);
    }

    return updateSchedule(existing.scheduleId, {
      scheduledAt: request.scheduledAt,
    });
  }
}

async function getScheduleByContentId(
  config: ScheduleConfig,
  contentId: string
): Promise<Schedule | undefined> {
  const existingRes = await docClient.send(
    new GetCommand({
      TableName: config.schedulesTable,
      Key: { pk: `SCHEDULE#${contentId}`, sk: 'METADATA' },
    })
  );

  return existingRes.Item as Schedule | undefined;
}

async function clearStaleSchedulingError(
  config: ScheduleConfig,
  existing: Schedule
): Promise<ScheduleResult> {
  scheduleLogger.info('Idempotent create: schedule already exists with same time', {
    scheduleId: existing.scheduleId,
  });

  try {
    const now = new Date().toISOString();
    const updated = await docClient.send(
      new UpdateCommand({
        TableName: config.schedulesTable,
        Key: { pk: existing.pk, sk: existing.sk },
        UpdateExpression: 'SET updatedAt = :now REMOVE #error',
        ExpressionAttributeNames: {
          '#error': 'schedulingError',
        },
        ExpressionAttributeValues: {
          ':now': now,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return { success: true, schedule: (updated.Attributes || existing) as Schedule };
  } catch (ignoreUpdateError) {
    scheduleLogger.warn('Failed to clear stale schedulingError on idempotent create', {
      scheduleId: existing.scheduleId,
      error: ignoreUpdateError,
    });

    return { success: true, schedule: existing };
  }
}

async function createSchedulerAndConfirm(
  config: ScheduleConfig,
  schedule: Schedule
): Promise<string> {
  const eventBridgeTime = formatEventBridgeScheduleTime(new Date(schedule.scheduledAt));

  try {
    const targetCfg = await getSchedulerEventBusTargetConfig();
    await schedulerClient.send(
      new CreateScheduleCommand({
        Name: schedule.scheduleId,
        GroupName: targetCfg.groupName,
        ScheduleExpression: `at(${eventBridgeTime})`,
        Target: {
          Arn: targetCfg.eventBusArn,
          RoleArn: targetCfg.roleArn,
          Input: JSON.stringify({
            scheduleId: schedule.scheduleId,
            contentId: schedule.contentId,
            brandId: schedule.brandId,
            userId: schedule.userId,
          }),
          EventBridgeParameters: {
            DetailType: 'schedule.due',
            Source: 'postolio.scheduling',
          },
        },
        FlexibleTimeWindow: {
          Mode: 'OFF',
        },
      })
    );

    const scheduleArn = buildScheduleArn(
      schedule.scheduleId,
      targetCfg.groupName,
      targetCfg.roleArn
    );
    await markScheduleCreated(config, schedule, scheduleArn);
    return scheduleArn;
  } catch (schedulerError) {
    scheduleLogger.error('EventBridge schedule creation failed, marking in DynamoDB', {
      scheduleId: schedule.scheduleId,
      error: schedulerError,
    });

    await markSchedulingError(config, schedule, schedulerError);
    throw schedulerError;
  }
}

function buildScheduleArn(scheduleId: string, groupName: string, roleArn: string): string {
  const region = process.env.AWS_REGION || 'us-east-1';
  const accountId = roleArn.split(':')[4];
  return `arn:aws:scheduler:${region}:${accountId}:schedule/${groupName}/${scheduleId}`;
}

async function markScheduleCreated(
  config: ScheduleConfig,
  schedule: Schedule,
  scheduleArn: string
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: config.schedulesTable,
      Key: { pk: schedule.pk, sk: schedule.sk },
      UpdateExpression:
        'SET eventBridgeScheduleCreated = :created, eventBridgeScheduleArn = :arn, updatedAt = :now',
      ExpressionAttributeValues: {
        ':created': true,
        ':arn': scheduleArn,
        ':now': new Date().toISOString(),
      },
    })
  );

  scheduleLogger.info('EventBridge schedule created and confirmed in DynamoDB', {
    scheduleId: schedule.scheduleId,
    scheduleArn,
  });
}

async function markSchedulingError(
  config: ScheduleConfig,
  schedule: Schedule,
  schedulerError: unknown
): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: config.schedulesTable,
        Key: { pk: schedule.pk, sk: schedule.sk },
        UpdateExpression: 'SET schedulingError = :error, updatedAt = :now',
        ExpressionAttributeValues: {
          ':error': schedulerError instanceof Error ? schedulerError.message : 'Unknown error',
          ':now': new Date().toISOString(),
        },
      })
    );
  } catch (updateError) {
    scheduleLogger.error('Failed to mark scheduling error in DynamoDB', {
      scheduleId: schedule.scheduleId,
      updateError,
    });
  }
}
