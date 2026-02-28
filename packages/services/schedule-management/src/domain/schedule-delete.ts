import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import {
  docClient,
  getSchedulerEventBusTargetConfig,
  scheduleLogger,
  scheduleMetrics,
  schedulerClient,
} from './schedule-context';
import { emitScheduleEvent, emitScheduleFailedEvent } from './schedule-events';
import type { Schedule, ScheduleResult } from '../types/schedule';

type ScheduleConfig = {
  schedulesTable: string;
};

type GetScheduleFn = (scheduleId: string) => Promise<ScheduleResult>;

interface DeleteScheduleOperationArgs {
  config: ScheduleConfig;
  scheduleId: string;
  getSchedule: GetScheduleFn;
}

export async function deleteScheduleOperation({
  config,
  scheduleId,
  getSchedule,
}: DeleteScheduleOperationArgs): Promise<ScheduleResult> {
  try {
    const existing = await getSchedule(scheduleId);
    if (!existing.success || !existing.schedule) {
      return {
        success: false,
        error: 'Schedule not found',
      };
    }

    await deleteSchedulerSchedule(scheduleId);
    await deleteDynamoSchedule(config, existing.schedule);
    await emitScheduleEvent('schedule.canceled', existing.schedule);

    scheduleLogger.info('Schedule deleted successfully', { scheduleId });
    scheduleMetrics.addMetric('ScheduleDeleted', MetricUnit.Count, 1);

    return {
      success: true,
    };
  } catch (error) {
    scheduleLogger.error('Failed to delete schedule', { error, scheduleId });
    scheduleMetrics.addMetric('ScheduleDeleteFailed', MetricUnit.Count, 1);
    await emitScheduleFailedEvent(
      scheduleId,
      error instanceof Error ? error.message : 'Unknown error',
      'delete'
    );

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function deleteSchedulerSchedule(scheduleId: string): Promise<void> {
  try {
    const target = await getSchedulerEventBusTargetConfig();
    await schedulerClient.send(
      new DeleteScheduleCommand({
        Name: scheduleId,
        GroupName: target.groupName,
      })
    );
  } catch (schedulerError) {
    scheduleLogger.warn('Failed to delete EventBridge schedule (may not exist)', {
      scheduleId,
      error: schedulerError,
    });
  }
}

async function deleteDynamoSchedule(config: ScheduleConfig, schedule: Schedule): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: config.schedulesTable,
      Key: {
        pk: schedule.pk,
        sk: schedule.sk,
      },
    })
  );
}
