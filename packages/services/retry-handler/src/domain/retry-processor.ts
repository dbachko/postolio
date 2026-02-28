import type { Logger } from '@aws-lambda-powertools/logger';
import { type Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { CreateScheduleCommand, type SchedulerClient } from '@aws-sdk/client-scheduler';
import {
  type DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { SQSRecord } from 'aws-lambda';
import type { RetryStrategy, RetryResult } from '../retry-strategy';
import { resolveUserFacingReason, writeFailureAuditLog } from './failure-handling';

const ABSOLUTE_MAX_RETRIES = 10;

interface RetryMessage {
  scheduleId?: unknown;
  originalError?: string;
  errorMeta?: unknown;
  httpStatus?: unknown;
}

interface ScheduleRecord {
  pk: string;
  sk: string;
  brandId?: string;
  userId?: string;
  contentId?: string;
  [key: string]: unknown;
}

interface RetryInfo {
  scheduleId: string;
  attemptNumber: number;
  [key: string]: unknown;
}

interface RetryProcessorDependencies {
  logger: Logger;
  metrics: Metrics;
  docClient: DynamoDBDocumentClient;
  schedulerClient: SchedulerClient;
  retryStrategy: RetryStrategy;
}

export class RetryProcessor {
  private readonly logger: Logger;
  private readonly metrics: Metrics;
  private readonly docClient: DynamoDBDocumentClient;
  private readonly schedulerClient: SchedulerClient;
  private readonly retryStrategy: RetryStrategy;

  constructor(deps: RetryProcessorDependencies) {
    this.logger = deps.logger;
    this.metrics = deps.metrics;
    this.docClient = deps.docClient;
    this.schedulerClient = deps.schedulerClient;
    this.retryStrategy = deps.retryStrategy;
  }

  extractScheduleId(record: SQSRecord): string | null {
    try {
      const message = this.parseMessage(record);
      return typeof message.scheduleId === 'string' ? message.scheduleId : null;
    } catch {
      return null;
    }
  }

  async processRetryMessage(record: SQSRecord): Promise<void> {
    const message = this.parseMessage(record);

    if (!this.hasValidScheduleId(message)) {
      return;
    }

    const scheduleId = message.scheduleId as string;
    this.logger.info('Processing retry for schedule', { scheduleId });

    const attemptNumber = await this.getNextAttemptNumber(scheduleId);
    if (await this.hitAbsoluteRetryLimit(scheduleId, attemptNumber)) {
      return;
    }

    const analysisInput = this.buildAnalysisInput(message);
    const retryDecision = this.retryStrategy.shouldRetry(analysisInput, attemptNumber, scheduleId);

    this.logRetryDecision(scheduleId, attemptNumber, analysisInput, retryDecision);

    if (!retryDecision.shouldRetry) {
      await this.handleNoRetryDecision(scheduleId, retryDecision, analysisInput);
      return;
    }

    await this.recordRetryAttempt(scheduleId, attemptNumber, retryDecision.delayMs);
    await this.scheduleRetryAttempt(
      scheduleId,
      attemptNumber,
      retryDecision.delayMs,
      analysisInput
    );
  }

  async markAsFailed(
    scheduleId: string,
    reason: string,
    originalError?: Error | unknown
  ): Promise<void> {
    try {
      const errorAnalysis = this.retryStrategy.analyzeError(originalError || reason);
      const userReason = resolveUserFacingReason(reason, originalError);
      await this.updateScheduleFailure(scheduleId, userReason, errorAnalysis.errorType, reason);
      await writeFailureAuditLog(this.docClient, this.logger, this.metrics, scheduleId, reason);
    } catch (error) {
      this.logger.error('Failed to mark schedule as failed - this could cause retry loops', {
        scheduleId,
        reason,
        error: (error as Error).message,
      });
      this.metrics.addMetric('MarkAsFailedError', MetricUnit.Count, 1);
    }
  }

  private parseMessage(record: SQSRecord): RetryMessage {
    return JSON.parse(record.body) as RetryMessage;
  }

  private hasValidScheduleId(
    message: RetryMessage
  ): message is RetryMessage & { scheduleId: string } {
    const { scheduleId } = message;

    if (typeof scheduleId === 'string' && scheduleId.length > 0 && scheduleId.length <= 100) {
      return true;
    }

    this.logger.error('Invalid scheduleId in retry message - skipping to prevent loops', {
      scheduleId,
      messageLength: JSON.stringify(message).length,
    });
    this.metrics.addMetric('InvalidScheduleIdSkipped', MetricUnit.Count, 1);
    return false;
  }

  private async getNextAttemptNumber(scheduleId: string): Promise<number> {
    const retryInfo = await this.getRetryInfo(scheduleId);
    return (retryInfo?.attemptNumber || 0) + 1;
  }

  private async hitAbsoluteRetryLimit(scheduleId: string, attemptNumber: number): Promise<boolean> {
    if (attemptNumber <= ABSOLUTE_MAX_RETRIES) {
      return false;
    }

    this.logger.error(
      'Retry attempt exceeds absolute maximum - preventing potential infinite loop',
      {
        scheduleId,
        attemptNumber,
        absoluteMaxRetries: ABSOLUTE_MAX_RETRIES,
      }
    );

    await this.markAsFailed(
      scheduleId,
      `Exceeded absolute maximum retry limit (${ABSOLUTE_MAX_RETRIES})`,
      new Error('Absolute retry limit exceeded')
    );
    this.metrics.addMetric('AbsoluteRetryLimitExceeded', MetricUnit.Count, 1);
    return true;
  }

  private buildAnalysisInput(message: RetryMessage): unknown {
    if (message.errorMeta && typeof message.errorMeta === 'object') {
      const errorMeta = message.errorMeta as Record<string, unknown>;
      const structuredHttpStatus =
        typeof errorMeta.httpStatus === 'number' ? errorMeta.httpStatus : undefined;
      const fallbackHttpStatus =
        typeof message.httpStatus === 'number' ? message.httpStatus : undefined;

      return {
        ...errorMeta,
        httpStatusCode: structuredHttpStatus ?? fallbackHttpStatus,
      };
    }

    if (message.originalError) {
      return new Error(message.originalError);
    }

    return new Error('Unknown publishing error');
  }

  private logRetryDecision(
    scheduleId: string,
    attemptNumber: number,
    analysisInput: unknown,
    retryDecision: RetryResult
  ): void {
    this.logger.info('Retry decision made', {
      scheduleId,
      attemptNumber,
      shouldRetry: retryDecision.shouldRetry,
      reason: retryDecision.reason,
      delayMs: retryDecision.delayMs,
      circuitBreakerOpen: retryDecision.circuitBreakerOpen,
      errorAnalysis: this.retryStrategy.analyzeError(analysisInput),
    });
  }

  private async handleNoRetryDecision(
    scheduleId: string,
    retryDecision: RetryResult,
    analysisInput: unknown
  ): Promise<void> {
    await this.markAsFailed(scheduleId, retryDecision.reason, analysisInput);

    if (retryDecision.circuitBreakerOpen) {
      this.metrics.addMetric('CircuitBreakerActivated', MetricUnit.Count, 1);
      return;
    }

    this.metrics.addMetric('MaxRetriesExceeded', MetricUnit.Count, 1);
  }

  private async scheduleRetryAttempt(
    scheduleId: string,
    attemptNumber: number,
    delayMs: number,
    analysisInput: unknown
  ): Promise<void> {
    try {
      const scheduleData = await this.getScheduleData(scheduleId);

      if (!scheduleData) {
        await this.markAsFailed(scheduleId, 'Schedule data not found', analysisInput);
        return;
      }

      await this.scheduleRetryWithDelay(scheduleId, scheduleData, delayMs, attemptNumber);

      this.logger.info('Retry scheduled with exponential backoff', {
        scheduleId,
        attemptNumber,
        delayMs,
        brandId: scheduleData.brandId,
        userId: scheduleData.userId,
      });

      this.metrics.addMetric('RetryScheduled', MetricUnit.Count, 1);
      this.metrics.addMetric('RetryDelayMs', MetricUnit.Milliseconds, delayMs);
    } catch (error) {
      this.logger.error('Failed to schedule retry', error as Error);
      await this.markAsFailed(scheduleId, 'Failed to schedule retry after error analysis', error);
      this.logger.warn('Retry message processed with failure - will not be retried', {
        scheduleId,
        error: (error as Error).message,
      });
    }
  }

  private async getScheduleData(scheduleId: string): Promise<ScheduleRecord | null> {
    try {
      const result = await this.docClient.send(
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

      const item = result.Items?.[0] as ScheduleRecord | undefined;
      if (!item) {
        this.logger.warn('No schedule data found via GSI', { scheduleId });
        return null;
      }

      return item;
    } catch (error) {
      this.logger.warn('Failed to read schedule via GSI', {
        scheduleId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  private async getRetryInfo(scheduleId: string): Promise<RetryInfo | null> {
    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: process.env.RETRY_QUEUE_TABLE!,
          KeyConditionExpression: 'scheduleId = :sid',
          ExpressionAttributeValues: {
            ':sid': scheduleId,
          },
          ScanIndexForward: false,
          Limit: 1,
        })
      );

      return (result.Items?.[0] as RetryInfo | undefined) || null;
    } catch (error) {
      this.logger.warn('No retry info found or query failed', {
        scheduleId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  private async scheduleRetryWithDelay(
    scheduleId: string,
    scheduleData: ScheduleRecord,
    delayMs: number,
    attemptNumber: number
  ): Promise<void> {
    const scheduleAt = new Date(Date.now() + delayMs);
    const scheduleName = `retry-${scheduleId}-attempt-${attemptNumber}`;

    await this.schedulerClient.send(
      new CreateScheduleCommand({
        Name: scheduleName,
        GroupName: process.env.SCHEDULER_GROUP_NAME!,
        ScheduleExpression: `at(${scheduleAt.toISOString().slice(0, -5)})`,
        Target: {
          Arn: process.env.SCHEDULING_EVENT_BUS_ARN!,
          RoleArn: process.env.SCHEDULER_EVENTS_ROLE_ARN!,
          Input: JSON.stringify({
            scheduleId,
            brandId: scheduleData.brandId,
            userId: scheduleData.userId,
            retryAttempt: attemptNumber,
          }),
          EventBridgeParameters: {
            DetailType: 'schedule.due',
            Source: 'postolio.scheduling',
          },
        },
        FlexibleTimeWindow: {
          Mode: 'OFF',
        },
        Description: `Retry attempt ${attemptNumber} for schedule ${scheduleId}`,
      })
    );

    this.logger.info('Retry scheduled successfully', {
      scheduleId,
      attemptNumber,
      scheduleName,
      scheduleAt: scheduleAt.toISOString(),
      delayMs,
    });
  }

  private async recordRetryAttempt(
    scheduleId: string,
    attemptNumber: number,
    delayMs?: number
  ): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: process.env.RETRY_QUEUE_TABLE!,
        Item: {
          scheduleId,
          attemptNumber,
          timestamp: new Date().toISOString(),
          delayMs: delayMs || 0,
          nextRetryAt: delayMs ? new Date(Date.now() + delayMs).toISOString() : undefined,
          ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
        },
      })
    );

    const schedule = await this.getScheduleData(scheduleId);
    if (!schedule?.pk || !schedule?.sk) {
      this.logger.warn('Could not update schedule retry fields; schedule not found via GSI', {
        scheduleId,
      });
      return;
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: {
          pk: schedule.pk,
          sk: schedule.sk,
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
  }

  private async updateScheduleFailure(
    scheduleId: string,
    userReason: string,
    errorType: string,
    originalReason: string
  ): Promise<void> {
    const schedule = await this.getScheduleData(scheduleId);
    if (!schedule?.pk || !schedule?.sk) {
      this.logger.warn('Could not mark schedule as failed; schedule not found via GSI', {
        scheduleId,
        reason: originalReason,
      });
      return;
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: {
          pk: schedule.pk,
          sk: schedule.sk,
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
          ':error': userReason,
          ':errorType': errorType,
          ':updatedAt': new Date().toISOString(),
        },
      })
    );
  }
}
