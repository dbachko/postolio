import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SchedulerClient } from '@aws-sdk/client-scheduler';
import type { ScheduledEvent, SQSEvent, SQSRecord } from 'aws-lambda';
import { RetryStrategy } from './retry-strategy';
import { RetryProcessor } from './domain/retry-processor';
import { initSentry, captureException } from '@postolio/observability';

const logger = new Logger({ serviceName: 'retry-handler' });
const tracer = new Tracer({ serviceName: 'retry-handler' });
const metrics = new Metrics({
  namespace: 'ContentScheduler',
  serviceName: 'retry-handler',
});

initSentry({
  serviceName: 'retry-handler',
});

const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const schedulerClient = tracer.captureAWSv3Client(new SchedulerClient({}));

const retryStrategy = new RetryStrategy(metrics);
const retryProcessor = new RetryProcessor({
  logger,
  metrics,
  docClient,
  schedulerClient,
  retryStrategy,
});

const MAX_PROCESSING_TIME_MS = 45000;
const MAX_BATCH_RECORDS = 50;

function isSQSEvent(event: unknown): event is SQSEvent {
  return (
    !!event && typeof event === 'object' && Array.isArray((event as { Records?: unknown }).Records)
  );
}

function getSqsRecords(event: SQSEvent | ScheduledEvent | undefined): SQSRecord[] {
  return isSQSEvent(event) ? event.Records : [];
}

function isApproachingTimeout(startTime: number): boolean {
  return Date.now() - startTime > MAX_PROCESSING_TIME_MS;
}

async function handleProcessingError(record: SQSRecord, error: unknown): Promise<void> {
  logger.error('Failed to process retry message - marking as permanently failed', error as Error);
  captureException(error, {
    function: 'retry-handler',
  });
  metrics.addMetric('RetryFailed', MetricUnit.Count, 1);

  const scheduleId = retryProcessor.extractScheduleId(record);
  if (scheduleId) {
    await retryProcessor.markAsFailed(scheduleId, 'Retry handler processing failed', error);
    return;
  }

  logger.error('Failed to parse message for error handling', error as Error);
}

export const handler = async (event: SQSEvent | ScheduledEvent | undefined): Promise<void> => {
  const processingStartTime = Date.now();
  const records = getSqsRecords(event);

  if (records.length === 0) {
    logger.info('Non-SQS invocation or empty batch; skipping processing');
    metrics.publishStoredMetrics();
    return;
  }

  logger.info('Processing retry messages', {
    messageCount: records.length,
    processingStartTime,
  });

  if (records.length > MAX_BATCH_RECORDS) {
    logger.error('Received too many messages in single batch - potential recursive loop detected', {
      messageCount: records.length,
    });
    metrics.addMetric('RecursiveLoopPrevented', MetricUnit.Count, 1);
    return;
  }

  for (const record of records) {
    if (isApproachingTimeout(processingStartTime)) {
      logger.warn('Approaching timeout - stopping message processing to prevent incomplete work', {
        processedTime: Date.now() - processingStartTime,
        maxProcessingTime: MAX_PROCESSING_TIME_MS,
      });
      break;
    }

    try {
      await retryProcessor.processRetryMessage(record);
      metrics.addMetric('RetryProcessed', MetricUnit.Count, 1);
    } catch (error) {
      await handleProcessingError(record, error);
    }
  }

  metrics.publishStoredMetrics();
};
