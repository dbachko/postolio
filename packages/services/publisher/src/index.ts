import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridge } from '@aws-sdk/client-eventbridge';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SchedulerClient, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import type { EventBridgeEvent as AwsEventBridgeEvent } from 'aws-lambda';

import {
  toPublishEvent,
  type PublishEvent,
  type ScheduleDueDetail,
  type Schedule,
  type Credentials,
} from './types';
import { PlatformAdapterFactory, InstagramAdapter } from './adapters';
import { getTokenFromTokenService } from './utils/token';
import { getSchedule, updateScheduleStatus, updateFirstCommentStatus } from './utils/audit';
import { getPublishMarker, writePublishMarker } from './utils/idempotency';
import { initSentry, captureException } from '@postolio/observability';

const logger = new Logger({ serviceName: 'publisher' });
const tracer = new Tracer({ serviceName: 'publisher' });
const metrics = new Metrics({
  namespace: 'ContentScheduler',
  serviceName: 'publisher',
});

initSentry({
  serviceName: 'publisher',
});

const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const eventBridge = new EventBridge({});
const sqsClient = tracer.captureAWSv3Client(new SQSClient({}));
const schedulerClient = tracer.captureAWSv3Client(new SchedulerClient({}));

export const handler = async (
  rawEvent: AwsEventBridgeEvent<'schedule.due', ScheduleDueDetail> | PublishEvent
): Promise<void> => {
  const event = toPublishEvent(rawEvent);
  logger.info('Publishing content', { scheduleId: event.scheduleId });

  try {
    const schedule = await getSchedule(docClient, event.scheduleId);
    if (!schedule) {
      logger.error('Schedule not found', {
        scheduleId: event.scheduleId,
        eventBrandId: event.brandId,
        eventUserId: event.userId,
      });

      metrics.addMetric('ScheduleNotFound', MetricUnit.Count, 1);
      metrics.publishStoredMetrics();
      return;
    }

    logger.info('Using content from schedule', {
      contentId: schedule.contentId,
      brandId: schedule.brandId,
      hasCaption: !!schedule.caption,
      hasHashtags: !!schedule.hashtags,
    });

    const publishableSchedule: Schedule = {
      ...schedule,
    };

    const userId = schedule.userId || event.userId;
    const brandId = schedule.brandId || event.brandId;

    if (!brandId) {
      throw new Error('Brand ID not found in schedule or event');
    }

    if (!userId) {
      throw new Error('User ID not found in schedule or event - required for token retrieval');
    }

    const scheduleMetadata =
      publishableSchedule &&
      typeof (publishableSchedule as any).metadata === 'object' &&
      (publishableSchedule as any).metadata !== null &&
      !Array.isArray((publishableSchedule as any).metadata)
        ? ((publishableSchedule as any).metadata as Record<string, unknown>)
        : null;

    const socialAccountId =
      typeof (publishableSchedule as any).socialAccountId === 'string'
        ? String((publishableSchedule as any).socialAccountId)
        : scheduleMetadata && typeof scheduleMetadata.socialAccountId === 'string'
          ? String(scheduleMetadata.socialAccountId)
          : undefined;

    const tokenData = await getTokenFromTokenService(
      brandId,
      userId,
      schedule.platform,
      socialAccountId
    );

    const credentials = {
      accessToken: tokenData.accessToken,
      accountId: tokenData.accountId,
      pageId: tokenData.pageId,
      expiresAt: tokenData.expiresAt,
    };

    logger.info('Fetched credentials', {
      brandId,
      hasToken: !!credentials.accessToken,
    });

    const adapter = PlatformAdapterFactory.getAdapter(schedule.platform);

    if (!adapter.validateCredentials(credentials)) {
      throw new Error(`Invalid credentials for platform: ${schedule.platform}`);
    }

    try {
      const existing = await getPublishMarker(docClient, event.scheduleId);
      if (existing?.platformPostId) {
        logger.warn('Idempotency marker found; skipping re-publish', {
          scheduleId: event.scheduleId,
          platformPostId: existing.platformPostId,
          permalink: existing.permalink,
        });
        await updateScheduleStatus(docClient, event.scheduleId, 'published', {
          platformPostId: existing.platformPostId,
          platformUrl: existing.permalink,
        });

        try {
          await schedulerClient.send(
            new DeleteScheduleCommand({
              Name: event.scheduleId,
              GroupName: process.env.SCHEDULER_GROUP_NAME || 'default',
            })
          );
        } catch {
          // ignore
        }
        return;
      }
    } catch (idemErr) {
      logger.warn('Idempotency check failed; proceeding with publish', {
        scheduleId: event.scheduleId,
        error: (idemErr as Error).message,
      });
    }

    const publishResult = await adapter.publish(publishableSchedule, credentials);

    if (!publishResult.success) {
      const err = new Error(publishResult.error || 'Publishing failed');
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: publishResult.errorCode,
        httpStatus: publishResult.httpStatus,
        platform: schedule.platform,
      };
      throw err;
    }

    try {
      await writePublishMarker(
        docClient,
        event.scheduleId,
        publishResult.platformPostId,
        publishResult.platformUrl
      );
    } catch (markerErr) {
      logger.warn('Failed to write idempotency marker (ignored)', {
        scheduleId: event.scheduleId,
        error: (markerErr as Error).message,
      });
    }

    await updateScheduleStatus(docClient, event.scheduleId, 'published', {
      platformPostId: publishResult.platformPostId,
      platformUrl: publishResult.platformUrl,
    });

    if (
      publishableSchedule.firstComment &&
      publishResult.platformPostId &&
      schedule.platform === 'instagram'
    ) {
      const instagramAdapter = new InstagramAdapter();
      const result = await instagramAdapter.postFirstCommentWithRetry(
        publishResult.platformPostId,
        publishableSchedule.firstComment as string,
        credentials,
        { externalAccountId: credentials.accountId || '' }
      );

      if (result.success) {
        logger.info('First comment posted successfully', {
          scheduleId: event.scheduleId,
          mediaId: publishResult.platformPostId,
          commentId: result.commentId,
          retriesUsed: result.retriesUsed,
        });
        metrics.addMetric('FirstCommentPosted', MetricUnit.Count, 1);
        if (result.retriesUsed > 0) {
          metrics.addMetric('FirstCommentRetrySuccess', MetricUnit.Count, 1);
        }
        await updateFirstCommentStatus(docClient, event.scheduleId, 'posted', result.commentId);
      } else {
        logger.warn('First comment failed after retries', {
          scheduleId: event.scheduleId,
          error: result.error,
          retriesUsed: result.retriesUsed,
        });
        metrics.addMetric('FirstCommentRetryExhausted', MetricUnit.Count, 1);
        await updateFirstCommentStatus(
          docClient,
          event.scheduleId,
          'failed',
          undefined,
          result.error
        );
      }
    }

    try {
      await schedulerClient.send(
        new DeleteScheduleCommand({
          Name: event.scheduleId,
          GroupName: process.env.SCHEDULER_GROUP_NAME || 'default',
        })
      );
      logger.info('Deleted EventBridge schedule after successful publishing', {
        scheduleId: event.scheduleId,
      });
    } catch (deleteError) {
      logger.warn('Failed to delete EventBridge schedule after success', {
        scheduleId: event.scheduleId,
        error: deleteError,
      });
    }

    try {
      await eventBridge.putEvents({
        Entries: [
          {
            Source: 'postolio.platform',
            DetailType: 'post.published',
            Time: new Date(),
            Detail: JSON.stringify({
              scheduleId: event.scheduleId,
              contentId: schedule.contentId,
              brandId: schedule.brandId,
              platform: schedule.platform,
              socialAccountId,
              platformPostId: publishResult.platformPostId,
              permalink: publishResult.platformUrl,
              publishedAt: new Date().toISOString(),
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      });
      logger.info('Emitted post.published event to EventBridge');
    } catch (emitErr) {
      logger.warn('Failed to emit post.published event', { error: emitErr });
    }

    metrics.addMetric('ContentPublished', MetricUnit.Count, 1);
    metrics.addMetric(`ContentPublished_${schedule.platform}`, MetricUnit.Count, 1);

    logger.info('Content published successfully', {
      scheduleId: event.scheduleId,
      platform: schedule.platform,
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to publish content', {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
    });
    captureException(error, {
      function: 'publisher',
      scheduleId: event.scheduleId,
      brandId: event.brandId,
      userId: event.userId,
    });
    metrics.addMetric('PublishingError', MetricUnit.Count, 1);

    await updateScheduleStatus(docClient, event.scheduleId, 'failed', {
      errorMessage: err.message,
    });

    try {
      const schedule = await getSchedule(docClient, event.scheduleId).catch(
        () => null as unknown as Schedule | null
      );
      await eventBridge.putEvents({
        Entries: [
          {
            Source: 'postolio.platform',
            DetailType: 'post.failed',
            Time: new Date(),
            Detail: JSON.stringify({
              scheduleId: event.scheduleId,
              contentId: schedule?.contentId,
              brandId: schedule?.brandId,
              platform: schedule?.platform,
              socialAccountId:
                typeof (schedule as any)?.socialAccountId === 'string'
                  ? String((schedule as any).socialAccountId)
                  : schedule &&
                      typeof (schedule as any).metadata === 'object' &&
                      (schedule as any).metadata !== null &&
                      typeof (schedule as any).metadata.socialAccountId === 'string'
                    ? String((schedule as any).metadata.socialAccountId)
                    : undefined,
              error: (error as Error)?.message || 'Unknown error',
              attemptNumber: 1,
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      });
      logger.info('Emitted post.failed event to EventBridge');
    } catch (emitErr) {
      logger.warn('Failed to emit post.failed event', { error: emitErr });
    }

    try {
      await schedulerClient.send(
        new DeleteScheduleCommand({
          Name: event.scheduleId,
          GroupName: process.env.SCHEDULER_GROUP_NAME || 'default',
        })
      );
      logger.info('Deleted EventBridge schedule to prevent re-triggering', {
        scheduleId: event.scheduleId,
      });
    } catch (deleteError) {
      logger.warn('Failed to delete EventBridge schedule - may cause re-triggering', {
        scheduleId: event.scheduleId,
        error: deleteError,
      });
    }

    try {
      const schedule = await getSchedule(docClient, event.scheduleId).catch(
        () => null as unknown as Schedule | null
      );
      const meta = (error as unknown as { meta?: Record<string, unknown> }).meta || {};
      const errorMeta = {
        ...(meta as Record<string, unknown>),
        platform: schedule?.platform,
      } as { errorCode?: string; httpStatus?: number; retryable?: boolean; platform?: string };
      await sendToRetryQueue(event.scheduleId, error as Error, event, errorMeta);
      logger.info('Sent failed publishing request to retry queue for intelligent handling', {
        scheduleId: event.scheduleId,
        error: (error as Error).message,
      });
    } catch (dlqError) {
      logger.error('Failed to send message to retry queue', dlqError as Error);
      throw error;
    }

    return;
  } finally {
    metrics.publishStoredMetrics();
  }
};

async function sendToRetryQueue(
  scheduleId: string,
  error: Error,
  originalEvent: PublishEvent,
  errorMeta?: {
    errorCode?: string;
    httpStatus?: number;
    retryable?: boolean;
    platform?: string;
    service?: string;
  }
): Promise<void> {
  const queueUrl = process.env.RETRY_QUEUE_URL || process.env.DLQ_URL;
  if (!queueUrl) {
    logger.warn('Neither RETRY_QUEUE_URL nor DLQ_URL configured - cannot send to retry queue');
    return;
  }

  const metaFromError = (error as unknown as { meta?: Record<string, unknown> }).meta || {};
  const mergedMeta = {
    ...(metaFromError as Record<string, unknown>),
    ...(errorMeta || {}),
  } as Record<string, unknown>;

  const retryMessage = {
    scheduleId,
    originalEvent,
    originalError: error.message,
    errorDetails: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    errorMeta: mergedMeta,
    httpStatus:
      typeof (mergedMeta as { httpStatus?: unknown }).httpStatus === 'number'
        ? (mergedMeta as { httpStatus: number }).httpStatus
        : undefined,
    timestamp: new Date().toISOString(),
    source: 'publisher',
    attempt: 1,
  };

  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(retryMessage),
      MessageAttributes: {
        ErrorType: {
          DataType: 'String',
          StringValue: error.name || 'Error',
        },
        ScheduleId: {
          DataType: 'String',
          StringValue: scheduleId,
        },
        Source: {
          DataType: 'String',
          StringValue: 'publisher',
        },
      },
    })
  );

  logger.info('Successfully sent structured error message to retry queue', {
    scheduleId,
    errorType: error.name,
    messageSize: JSON.stringify(retryMessage).length,
    targetQueueUrl: queueUrl,
  });
}
