import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { eventBridgeClient, getEventBusName, scheduleLogger } from './schedule-context';
import type { Schedule, ScheduleFailureContext, ScheduleOperation } from '../types/schedule';

export async function emitScheduleEvent(eventType: string, schedule: Schedule): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'postolio.scheduler',
            DetailType: eventType,
            Detail: JSON.stringify(createScheduleEventDetail(schedule)),
            EventBusName: getEventBusName(),
          },
        ],
      })
    );

    scheduleLogger.debug('Schedule event emitted', {
      eventType,
      scheduleId: schedule.scheduleId,
    });
  } catch (error) {
    scheduleLogger.warn('Failed to emit schedule event', {
      error,
      eventType,
      scheduleId: schedule.scheduleId,
    });
  }
}

export async function emitScheduleFailedEvent(
  scheduleId: string | undefined,
  errorMessage: string,
  operation: ScheduleOperation,
  partialData?: ScheduleFailureContext
): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'postolio.scheduler',
            DetailType: 'schedule.failed',
            Detail: JSON.stringify({
              scheduleId: scheduleId || 'unknown',
              operation,
              error: errorMessage,
              contentId: partialData?.contentId,
              brandId: partialData?.brandId,
              platform: partialData?.platform,
              timestamp: new Date().toISOString(),
            }),
            EventBusName: getEventBusName(),
          },
        ],
      })
    );

    scheduleLogger.debug('Schedule failure event emitted', {
      scheduleId,
      operation,
    });
  } catch (error) {
    scheduleLogger.warn('Failed to emit schedule failure event', {
      error,
      scheduleId,
      operation,
    });
  }
}

function createScheduleEventDetail(schedule: Schedule): Record<string, string> {
  return {
    scheduleId: schedule.scheduleId,
    contentId: schedule.contentId,
    brandId: schedule.brandId,
    status: schedule.status,
    scheduledAt: schedule.scheduledAt,
    platform: schedule.platform,
    timestamp: new Date().toISOString(),
  };
}
