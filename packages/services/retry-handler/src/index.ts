import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
// import { LambdaClient } from '@aws-sdk/client-lambda';
import { SchedulerClient, CreateScheduleCommand } from '@aws-sdk/client-scheduler';
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { RetryStrategy } from './retry-strategy';

// Initialize Powertools
const logger = new Logger({ serviceName: 'retry-handler' });
const tracer = new Tracer({ serviceName: 'retry-handler' });
const metrics = new Metrics({
  namespace: 'ContentScheduler',
  serviceName: 'retry-handler',
});

// Initialize AWS SDK clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);
// Lambda client currently not used; initialize when needed
// const lambdaClient = tracer.captureAWSv3Client(new LambdaClient({}));
const schedulerClient = tracer.captureAWSv3Client(new SchedulerClient({}));

// Initialize retry strategy with industry best practices
const retryStrategy = new RetryStrategy(metrics);

// Legacy constant kept for backward compatibility in logs
const MAX_RETRY_ATTEMPTS = 5; // Increased to match industry standard

export const handler = async (
  event: SQSEvent | Record<string, unknown> | undefined
): Promise<void> => {
  // 🚨 RECURSIVE LOOP PREVENTION: Add circuit breaker with timestamp tracking
  const processingStartTime = Date.now();
  const maxProcessingTime = 45000; // 45 seconds max processing time

  const records: SQSRecord[] = Array.isArray((event as any)?.Records)
    ? ((event as any).Records as SQSRecord[])
    : [];

  // Handle non-SQS invocations gracefully (e.g., EventBridge schedule rule)
  if (records.length === 0) {
    logger.info('Non-SQS invocation or empty batch; skipping processing', {
      trigger: (event as any)?.['detail-type'] || (event as any)?.source || 'unknown',
    });
    metrics.publishStoredMetrics();
    return;
  }

  logger.info('Processing retry messages', {
    messageCount: records.length,
    processingStartTime,
  });

  // 🚨 PREVENT RECURSIVE LOOPS: Validate message count is reasonable
  if (records.length > 50) {
    logger.error('Received too many messages in single batch - potential recursive loop detected', {
      messageCount: records.length,
    });
    metrics.addMetric('RecursiveLoopPrevented', MetricUnit.Count, 1);
    return; // Exit early to prevent processing potentially malformed batch
  }

  for (const record of records) {
    // 🚨 TIMEOUT PROTECTION: Check if we're approaching timeout
    if (Date.now() - processingStartTime > maxProcessingTime) {
      logger.warn('Approaching timeout - stopping message processing to prevent incomplete work', {
        processedTime: Date.now() - processingStartTime,
        maxProcessingTime,
      });
      break;
    }

    try {
      await processRetryMessage(record);
      metrics.addMetric('RetryProcessed', MetricUnit.Count, 1);
    } catch (error) {
      logger.error(
        'Failed to process retry message - marking as permanently failed',
        error as Error
      );
      metrics.addMetric('RetryFailed', MetricUnit.Count, 1);

      // 🔥 CRITICAL FIX: Never throw errors to prevent SQS from retrying the retry-handler
      // Instead, mark the message as processed but failed
      try {
        const message = JSON.parse(record.body);
        const { scheduleId } = message;
        if (scheduleId) {
          await markAsFailed(scheduleId, 'Retry handler processing failed', error as Error);
        }
      } catch (parseError) {
        logger.error('Failed to parse message for error handling', parseError as Error);
        // 🚨 CRITICAL: Even if we can't parse the message, we MUST NOT throw
        // This would cause SQS to retry and potentially create a recursive loop
      }

      // Always succeed to prevent SQS retry loop
      // The message has been processed (marked as failed) and should not be retried
    }
  }

  metrics.publishStoredMetrics();
};

async function processRetryMessage(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body);
  const { scheduleId, originalError } = message;

  // 🚨 RECURSIVE LOOP PREVENTION: Validate scheduleId exists and is reasonable
  if (!scheduleId || typeof scheduleId !== 'string' || scheduleId.length > 100) {
    logger.error('Invalid scheduleId in retry message - skipping to prevent loops', {
      scheduleId,
      messageLength: JSON.stringify(message).length,
    });
    metrics.addMetric('InvalidScheduleIdSkipped', MetricUnit.Count, 1);
    return; // Skip invalid messages to prevent infinite processing
  }

  logger.info('Processing retry for schedule', { scheduleId });

  // Get retry information
  const retryInfo = await getRetryInfo(scheduleId);
  const attemptNumber = (retryInfo?.attemptNumber || 0) + 1;

  // 🚨 RECURSIVE LOOP PREVENTION: Hard limit on retry attempts to prevent infinite loops
  const absoluteMaxRetries = 10; // Absolute hard limit regardless of retry strategy
  if (attemptNumber > absoluteMaxRetries) {
    logger.error('Retry attempt exceeds absolute maximum - preventing potential infinite loop', {
      scheduleId,
      attemptNumber,
      absoluteMaxRetries,
    });
    await markAsFailed(
      scheduleId,
      `Exceeded absolute maximum retry limit (${absoluteMaxRetries})`,
      new Error('Absolute retry limit exceeded')
    );
    metrics.addMetric('AbsoluteRetryLimitExceeded', MetricUnit.Count, 1);
    return;
  }

  // Parse the original error from the message
  let lastError: Error;
  try {
    lastError = originalError ? new Error(originalError) : new Error('Unknown publishing error');
  } catch {
    lastError = new Error('Failed to parse error from retry message');
  }

  // Use industry-standard retry strategy to determine if we should retry
  const retryDecision = retryStrategy.shouldRetry(lastError, attemptNumber, scheduleId);

  logger.info('Retry decision made', {
    scheduleId,
    attemptNumber,
    shouldRetry: retryDecision.shouldRetry,
    reason: retryDecision.reason,
    delayMs: retryDecision.delayMs,
    circuitBreakerOpen: retryDecision.circuitBreakerOpen,
    errorAnalysis: retryStrategy.analyzeError(lastError),
  });

  // If we shouldn't retry, mark as failed
  if (!retryDecision.shouldRetry) {
    await markAsFailed(scheduleId, retryDecision.reason, lastError);

    // Record metrics based on failure reason
    if (retryDecision.circuitBreakerOpen) {
      metrics.addMetric('CircuitBreakerActivated', MetricUnit.Count, 1);
    } else {
      metrics.addMetric('MaxRetriesExceeded', MetricUnit.Count, 1);
    }
    return;
  }

  // Record retry attempt
  await recordRetryAttempt(scheduleId, attemptNumber, retryDecision.delayMs);

  try {
    // Get schedule metadata to include brandId and userId
    const scheduleData = await getScheduleData(scheduleId);

    if (!scheduleData) {
      await markAsFailed(scheduleId, 'Schedule data not found', lastError);
      return;
    }

    // Schedule the retry with proper exponential backoff delay
    // Use AWS EventBridge Scheduler for precise timing
    await scheduleRetryWithDelay(scheduleId, scheduleData, retryDecision.delayMs, attemptNumber);

    logger.info('Retry scheduled with exponential backoff', {
      scheduleId,
      attemptNumber,
      delayMs: retryDecision.delayMs,
      brandId: scheduleData.brandId,
      userId: scheduleData.userId,
    });

    metrics.addMetric('RetryScheduled', MetricUnit.Count, 1);
    metrics.addMetric('RetryDelayMs', MetricUnit.Milliseconds, retryDecision.delayMs);
  } catch (error) {
    logger.error('Failed to schedule retry', error as Error);

    // Mark as failed if we can't even schedule the retry
    await markAsFailed(scheduleId, 'Failed to schedule retry after error analysis', error as Error);

    // 🔥 CRITICAL: Never throw errors - this would cause SQS to retry the retry-handler
    // The message has been processed (marked as failed) successfully
    logger.warn('Retry message processed with failure - will not be retried', {
      scheduleId,
      error: (error as Error).message,
    });
  }
}

interface ScheduleRecord {
  pk: string;
  sk: string;
  brandId?: string;
  userId?: string;
  contentId?: string;
  [key: string]: unknown;
}

async function getScheduleData(scheduleId: string): Promise<ScheduleRecord | null> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        IndexName: process.env.SCHEDULES_TABLE_SCHEDULE_INDEX || 'ScheduleIdIndex',
        KeyConditionExpression: 'scheduleId = :sid',
        ExpressionAttributeValues: {
          ':sid': scheduleId,
        },
        Limit: 1,
      })
    );

    const item = (result.Items && result.Items[0]) as ScheduleRecord | undefined;
    if (!item) {
      logger.warn('No schedule data found via GSI', { scheduleId });
      return null;
    }
    return item;
  } catch (err) {
    logger.warn('Failed to read schedule via GSI', { scheduleId, error: (err as Error).message });
    return null;
  }
}

interface RetryInfo {
  scheduleId: string;
  attemptNumber: number;
  [key: string]: unknown;
}

async function getRetryInfo(scheduleId: string): Promise<RetryInfo | null> {
  try {
    // Query the latest attempt (highest sort key) for this scheduleId
    const result = await docClient.send(
      new QueryCommand({
        TableName: process.env.RETRY_QUEUE_TABLE!,
        KeyConditionExpression: 'scheduleId = :sid',
        ExpressionAttributeValues: {
          ':sid': scheduleId,
        },
        ScanIndexForward: false, // descending order by sort key (attemptNumber)
        Limit: 1,
      })
    );

    const latest = result.Items && result.Items[0];
    return (latest as RetryInfo) || null;
  } catch (err) {
    logger.warn('No retry info found or query failed', {
      scheduleId,
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * Schedule a retry with exponential backoff delay using AWS EventBridge Scheduler
 * This replaces immediate Lambda invocation to prevent recursive loops
 */
async function scheduleRetryWithDelay(
  scheduleId: string,
  scheduleData: ScheduleRecord,
  delayMs: number,
  attemptNumber: number
): Promise<void> {
  const scheduleAt = new Date(Date.now() + delayMs);
  const scheduleName = `retry-${scheduleId}-attempt-${attemptNumber}`;

  // Create one-time schedule for the retry
  await schedulerClient.send(
    new CreateScheduleCommand({
      Name: scheduleName,
      GroupName: process.env.SCHEDULER_GROUP_NAME!,
      ScheduleExpression: `at(${scheduleAt.toISOString().slice(0, -5)})`, // EventBridge format
      Target: {
        Arn: process.env.PUBLISHER_LAMBDA_ARN!,
        RoleArn: process.env.SCHEDULER_ROLE_ARN!,
        Input: JSON.stringify({
          scheduleId,
          brandId: scheduleData.brandId,
          userId: scheduleData.userId,
          retryAttempt: attemptNumber,
        }),
      },
      FlexibleTimeWindow: {
        Mode: 'OFF',
      },
      Description: `Retry attempt ${attemptNumber} for schedule ${scheduleId}`,
    })
  );

  logger.info('Retry scheduled successfully', {
    scheduleId,
    attemptNumber,
    scheduleName,
    scheduleAt: scheduleAt.toISOString(),
    delayMs,
  });
}

async function recordRetryAttempt(
  scheduleId: string,
  attemptNumber: number,
  delayMs?: number
): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: process.env.RETRY_QUEUE_TABLE!,
      Item: {
        scheduleId,
        attemptNumber,
        timestamp: new Date().toISOString(),
        delayMs: delayMs || 0,
        nextRetryAt: delayMs ? new Date(Date.now() + delayMs).toISOString() : undefined,
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
      },
    })
  );

  // Also update the main schedule record (lookup keys via GSI)
  const sched = await getScheduleData(scheduleId);
  if (sched && sched.pk && sched.sk) {
    await docClient.send(
      new UpdateCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: {
          pk: sched.pk,
          sk: sched.sk,
        },
        UpdateExpression: 'SET #retryCount = :count, #lastRetry = :timestamp',
        ExpressionAttributeNames: {
          '#retryCount': 'retryCount',
          '#lastRetry': 'lastRetryAt',
        },
        ExpressionAttributeValues: {
          ':count': attemptNumber,
          ':timestamp': new Date().toISOString(),
        },
      })
    );
  } else {
    logger.warn('Could not update schedule retry fields; schedule not found via GSI', {
      scheduleId,
    });
  }
}

async function markAsFailed(
  scheduleId: string,
  reason: string,
  originalError?: Error | unknown
): Promise<void> {
  try {
    // Analyze error to get structured information
    const errorAnalysis = retryStrategy.analyzeError(originalError || reason);

    const sched = await getScheduleData(scheduleId);
    if (sched && sched.pk && sched.sk) {
      await docClient.send(
        new UpdateCommand({
          TableName: process.env.SCHEDULES_TABLE!,
          Key: {
            pk: sched.pk,
            sk: sched.sk,
          },
          UpdateExpression:
            'SET #status = :status, #error = :error, #errorType = :errorType, #updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#error': 'schedulingError',
            '#errorType': 'errorType',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':status': 'failed',
            ':error': reason,
            ':errorType': errorAnalysis.errorType,
            ':updatedAt': new Date().toISOString(),
          },
        })
      );
    } else {
      logger.warn('Could not mark schedule as failed; schedule not found via GSI', {
        scheduleId,
        reason,
      });
    }

    // Log to audit table - wrapped in try/catch to prevent audit logging failures from causing recursion
    try {
      await docClient.send(
        new PutCommand({
          TableName: process.env.AUDIT_LOG_TABLE!,
          Item: {
            pk: `SCHEDULE#${scheduleId}`,
            timestamp: new Date().toISOString(),
            action: 'FAILED_AFTER_RETRIES',
            reason,
            metadata: {
              maxAttempts: MAX_RETRY_ATTEMPTS,
            },
          },
        })
      );
    } catch (auditError) {
      // 🚨 CRITICAL: Never let audit logging failures prevent marking as failed
      logger.warn('Failed to write to audit log but schedule marked as failed', {
        scheduleId,
        auditError: (auditError as Error).message,
      });
      metrics.addMetric('AuditLogWriteFailed', MetricUnit.Count, 1);
      // Continue - the main schedule update succeeded
    }
  } catch (error) {
    // 🚨 CRITICAL: Log error but don't throw to prevent recursion
    logger.error('Failed to mark schedule as failed - this could cause retry loops', {
      scheduleId,
      reason,
      error: (error as Error).message,
    });
    metrics.addMetric('MarkAsFailedError', MetricUnit.Count, 1);
    // Don't throw - this would cause the entire handler to fail and potentially retry
  }
}

// Removed scheduleNextRetry function to prevent recursive invocations
// The DLQ's built-in retry mechanism with exponential backoff handles retries automatically
