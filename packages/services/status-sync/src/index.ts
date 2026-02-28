/**
 * Status Sync Lambda
 *
 * EventBridge dispatcher for content/schedule status synchronization.
 */

import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { captureException } from '@postolio/observability';
import type { Context, EventBridgeEvent } from 'aws-lambda';
import { logger, metrics } from './runtime';
import {
  handlePostFailed,
  handlePostPublished,
  handlePostSkipped,
  handlePostUnavailable,
} from './handlers/post-events';
import {
  handleScheduleCanceled,
  handleScheduleCreated,
  handleScheduleFailed,
  handleScheduleUpdated,
} from './handlers/schedule-events';
import type { EventDetail } from './types';

type EventHandler = (detail: EventDetail) => Promise<void>;

const EVENT_HANDLERS: Record<string, EventHandler> = {
  'post.published': handlePostPublished,
  'post.failed': handlePostFailed,
  'post.skipped': handlePostSkipped,
  'post.unavailable': handlePostUnavailable,
  'schedule.created': handleScheduleCreated,
  'schedule.updated': handleScheduleUpdated,
  'schedule.canceled': handleScheduleCanceled,
  'schedule.failed': handleScheduleFailed,
};

const EVENT_METRIC_NAMES: Record<string, string> = {
  'post.published': 'PostPublished',
  'post.failed': 'PostFailed',
  'post.skipped': 'PostSkipped',
  'post.unavailable': 'PostUnavailable',
  'schedule.created': 'ScheduleCreated',
  'schedule.updated': 'ScheduleUpdated',
  'schedule.canceled': 'ScheduleCanceled',
  'schedule.failed': 'ScheduleFailed',
};

export async function handler(
  event: EventBridgeEvent<string, EventDetail>,
  context: Context
): Promise<{ statusCode: number }> {
  context.callbackWaitsForEmptyEventLoop = false;

  logger.info('StatusSync received event', {
    id: event.id,
    source: event.source,
    detailType: event['detail-type'],
    time: event.time,
  });

  const eventType = event['detail-type'];
  const detail = event.detail;

  if (!eventType || !detail) {
    logger.warn('Missing detail-type or detail in EventBridge event');
    metrics.addMetric('InvalidEvent', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();
    return { statusCode: 400 };
  }

  try {
    await dispatchEvent(eventType, detail);
    metrics.publishStoredMetrics();
    return { statusCode: 200 };
  } catch (error) {
    logger.error('StatusSync processing error', {
      error: error instanceof Error ? error.message : error,
      eventType,
      detail,
    });

    captureException(error, {
      function: 'status-sync',
      eventType,
    });

    metrics.addMetric('ProcessingError', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();
    throw error;
  }
}

async function dispatchEvent(eventType: string, detail: EventDetail): Promise<void> {
  const handlerFn = EVENT_HANDLERS[eventType];
  if (!handlerFn) {
    logger.warn('Unhandled event type', { eventType });
    metrics.addMetric('UnhandledEventType', MetricUnit.Count, 1);
    return;
  }

  await handlerFn(detail);
  const metricName = EVENT_METRIC_NAMES[eventType] || 'HandledEvent';
  metrics.addMetric(metricName, MetricUnit.Count, 1);
}
