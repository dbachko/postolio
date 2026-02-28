import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { CreateScheduleCommand, UpdateScheduleCommand } from '@aws-sdk/client-scheduler';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { formatEventBridgeScheduleTime } from '../config';
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

type GetScheduleFn = (scheduleId: string) => Promise<ScheduleResult>;

interface UpdateScheduleOperationArgs {
  config: ScheduleConfig;
  scheduleId: string;
  updateRequest: Partial<ScheduleRequest>;
  getSchedule: GetScheduleFn;
}

interface UpdateExpressionState {
  setExpressions: string[];
  removeExpressions: string[];
  names: Record<string, string>;
  values: Record<string, unknown>;
  hasTimeChange: boolean;
  wantsUserIdUpdate: boolean;
}

export async function updateScheduleOperation({
  config,
  scheduleId,
  updateRequest,
  getSchedule,
}: UpdateScheduleOperationArgs): Promise<ScheduleResult> {
  try {
    const existing = await getSchedule(scheduleId);
    if (!existing.success || !existing.schedule) {
      return { success: false, error: 'Schedule not found' };
    }

    const state = createUpdateState(existing.schedule, updateRequest);
    await syncSchedulerTarget(scheduleId, existing.schedule, updateRequest, state);
    appendRecordUpdates(updateRequest, state);
    appendSystemUpdates(state);

    await persistUpdate(config, existing.schedule, state);

    const updated = await getSchedule(scheduleId);
    if (!updated.success || !updated.schedule) {
      throw new Error('Failed to retrieve updated schedule');
    }

    await emitScheduleEvent('schedule.updated', updated.schedule);
    scheduleLogger.info('Schedule updated successfully', {
      scheduleId,
      updates: Object.keys(updateRequest),
    });
    scheduleMetrics.addMetric('ScheduleUpdated', MetricUnit.Count, 1);

    return { success: true, schedule: updated.schedule };
  } catch (error) {
    scheduleLogger.error('Failed to update schedule', { error, scheduleId });
    scheduleMetrics.addMetric('ScheduleUpdateFailed', MetricUnit.Count, 1);
    await emitScheduleFailedEvent(
      scheduleId,
      error instanceof Error ? error.message : 'Unknown error',
      'update'
    );

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function createUpdateState(
  existingSchedule: Schedule,
  updateRequest: Partial<ScheduleRequest>
): UpdateExpressionState {
  return {
    setExpressions: [],
    removeExpressions: [],
    names: {},
    values: {},
    hasTimeChange: !!(
      updateRequest.scheduledAt && updateRequest.scheduledAt !== existingSchedule.scheduledAt
    ),
    wantsUserIdUpdate: !!(updateRequest.userId && updateRequest.userId !== existingSchedule.userId),
  };
}

async function syncSchedulerTarget(
  scheduleId: string,
  existingSchedule: Schedule,
  updateRequest: Partial<ScheduleRequest>,
  state: UpdateExpressionState
): Promise<void> {
  if (state.hasTimeChange) {
    applyTimeChangeUpdate(updateRequest, state);
    await upsertSchedulerSchedule(scheduleId, existingSchedule, updateRequest);
    return;
  }

  if (!state.wantsUserIdUpdate) {
    return;
  }

  state.setExpressions.push('userId = :userId');
  state.values[':userId'] = updateRequest.userId;
  await updateSchedulerUserTarget(scheduleId, existingSchedule, updateRequest.userId);
}

function applyTimeChangeUpdate(
  updateRequest: Partial<ScheduleRequest>,
  state: UpdateExpressionState
): void {
  state.setExpressions.push('scheduledAt = :scheduledAt');
  state.values[':scheduledAt'] = updateRequest.scheduledAt;
  state.setExpressions.push('gsi1sk = :gsi1sk');
  state.values[':gsi1sk'] = updateRequest.scheduledAt;

  if (state.wantsUserIdUpdate) {
    state.setExpressions.push('userId = :userId');
    state.values[':userId'] = updateRequest.userId;
  }
}

async function upsertSchedulerSchedule(
  scheduleId: string,
  existingSchedule: Schedule,
  updateRequest: Partial<ScheduleRequest>
): Promise<void> {
  const eventBridgeTime = formatEventBridgeScheduleTime(new Date(updateRequest.scheduledAt));
  const userId = updateRequest.userId ?? existingSchedule.userId;

  try {
    await updateSchedulerSchedule(scheduleId, existingSchedule, eventBridgeTime, userId);
  } catch (error) {
    if ((error as Error)?.name !== 'ResourceNotFoundException') {
      throw error;
    }

    await createSchedulerSchedule(scheduleId, existingSchedule, eventBridgeTime, userId);
  }
}

async function updateSchedulerSchedule(
  scheduleId: string,
  existingSchedule: Schedule,
  eventBridgeTime: string,
  userId: string
): Promise<void> {
  const targetCfg = await getSchedulerEventBusTargetConfig();
  await schedulerClient.send(
    new UpdateScheduleCommand({
      Name: scheduleId,
      GroupName: targetCfg.groupName,
      ScheduleExpression: `at(${eventBridgeTime})`,
      Target: createSchedulerTarget(scheduleId, existingSchedule, targetCfg, userId),
      FlexibleTimeWindow: { Mode: 'OFF' },
    })
  );
}

async function createSchedulerSchedule(
  scheduleId: string,
  existingSchedule: Schedule,
  eventBridgeTime: string,
  userId: string
): Promise<void> {
  const targetCfg = await getSchedulerEventBusTargetConfig();
  await schedulerClient.send(
    new CreateScheduleCommand({
      Name: scheduleId,
      GroupName: targetCfg.groupName,
      ScheduleExpression: `at(${eventBridgeTime})`,
      Target: createSchedulerTarget(scheduleId, existingSchedule, targetCfg, userId),
      FlexibleTimeWindow: { Mode: 'OFF' },
    })
  );
}

function createSchedulerTarget(
  scheduleId: string,
  existingSchedule: Schedule,
  targetCfg: { roleArn: string; eventBusArn: string },
  userId: string
): {
  Arn: string;
  RoleArn: string;
  Input: string;
  EventBridgeParameters: { DetailType: string; Source: string };
} {
  return {
    Arn: targetCfg.eventBusArn,
    RoleArn: targetCfg.roleArn,
    Input: JSON.stringify({
      scheduleId,
      contentId: existingSchedule.contentId,
      brandId: existingSchedule.brandId,
      userId,
    }),
    EventBridgeParameters: {
      DetailType: 'schedule.due',
      Source: 'postolio.scheduling',
    },
  };
}

async function updateSchedulerUserTarget(
  scheduleId: string,
  existingSchedule: Schedule,
  userId: string | undefined
): Promise<void> {
  try {
    const targetCfg = await getSchedulerEventBusTargetConfig();
    const eventBridgeTime = formatEventBridgeScheduleTime(new Date(existingSchedule.scheduledAt));

    await schedulerClient.send(
      new UpdateScheduleCommand({
        Name: scheduleId,
        GroupName: targetCfg.groupName,
        ScheduleExpression: `at(${eventBridgeTime})`,
        Target: createSchedulerTarget(scheduleId, existingSchedule, targetCfg, userId || ''),
        FlexibleTimeWindow: { Mode: 'OFF' },
      })
    );
  } catch (error) {
    scheduleLogger.warn('Failed to update Scheduler target with new userId', {
      scheduleId,
      error,
    });
  }
}

function appendRecordUpdates(
  updateRequest: Partial<ScheduleRequest>,
  state: UpdateExpressionState
): void {
  appendUpdateIfDefined(state, 'caption', updateRequest.caption);
  appendUpdateIfDefined(state, 'firstComment', updateRequest.firstComment);
  appendUpdateIfDefined(state, 'hashtags', updateRequest.hashtags);
  appendUpdateIfDefined(state, 'mediaAssets', updateRequest.mediaAssets);
  appendUpdateIfDefined(state, 'thumbOffset', updateRequest.thumbOffset);
  appendUpdateIfDefined(state, 'shareToFeed', updateRequest.shareToFeed);
  appendUpdateIfDefined(state, 'metadata', updateRequest.metadata);
}

function appendUpdateIfDefined(state: UpdateExpressionState, field: string, value: unknown): void {
  if (value === undefined) {
    return;
  }

  const token = `:${field}`;
  state.setExpressions.push(`${field} = ${token}`);
  state.values[token] = value;
}

function appendSystemUpdates(state: UpdateExpressionState): void {
  state.setExpressions.push('updatedAt = :updatedAt');
  state.values[':updatedAt'] = new Date().toISOString();
  state.names['#error'] = 'schedulingError';
  state.removeExpressions.push('#error');
}

async function persistUpdate(
  config: ScheduleConfig,
  existingSchedule: Schedule,
  state: UpdateExpressionState
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: config.schedulesTable,
      Key: {
        pk: existingSchedule.pk,
        sk: existingSchedule.sk,
      },
      UpdateExpression: buildUpdateExpression(state),
      ExpressionAttributeNames: Object.keys(state.names).length > 0 ? state.names : undefined,
      ExpressionAttributeValues: state.values,
      ReturnValues: 'ALL_NEW',
    })
  );
}

function buildUpdateExpression(state: UpdateExpressionState): string {
  const removeExpression =
    state.removeExpressions.length > 0 ? ` REMOVE ${state.removeExpressions.join(', ')}` : '';

  return `SET ${state.setExpressions.join(', ')}${removeExpression}`;
}
