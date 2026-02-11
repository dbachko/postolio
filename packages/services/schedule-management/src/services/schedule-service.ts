/**
 * Schedule Service
 *
 * Core business logic for schedule management operations
 * Separated from handlers for better testability and reusability
 *
 * RELIABILITY: Two-Phase Commit Pattern
 * =======================================
 * To prevent race conditions between DynamoDB writes and EventBridge schedule creation,
 * this service implements a two-phase commit pattern:
 *
 * Phase 1: Create DynamoDB record with eventBridgeScheduleCreated=false
 * Phase 2: Create EventBridge schedule, then update DynamoDB with eventBridgeScheduleCreated=true
 *
 * This ensures that:
 * - If the process crashes after Phase 1, we have a record that can be detected and cleaned up
 * - If EventBridge creation fails, we mark the error in DynamoDB instead of silently deleting
 * - Idempotency tokens prevent duplicate schedules on retry
 *
 * TODO: Implement reconciliation job to periodically scan for:
 * - Schedules where eventBridgeScheduleCreated=false and createdAt > 5 minutes ago
 * - Orphaned EventBridge schedules without corresponding DynamoDB records
 * - Schedules with schedulingError that should be retried or cleaned up
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import { getDynamoDBConfig, SCHEDULE_STATUS, formatEventBridgeScheduleTime } from '../config';

const logger = new Logger({ serviceName: 'schedule-service' });

/**
 * Structured media asset information for publishing
 * Eliminates need for file extension parsing in publisher
 */
export interface MediaAsset {
  key: string; // S3 key or CDN URL
  type: 'image' | 'video'; // Explicit media type
  order: number; // Display order for carousels
  width?: number; // Asset width in pixels
  height?: number; // Asset height in pixels
  assetId?: string; // Asset service identifier
  duration?: number; // Video duration in seconds
}
const tracer = new Tracer({ serviceName: 'schedule-service' });
const metrics = new Metrics({
  namespace: 'ContentScheduler',
  serviceName: 'schedule-service',
});

// Initialize AWS clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const schedulerClient = tracer.captureAWSv3Client(new SchedulerClient({}));
const eventBridge = tracer.captureAWSv3Client(new EventBridgeClient({}));

async function getSchedulerEventBusTargetConfig() {
  const groupName = process.env.SCHEDULER_GROUP_NAME || 'default';
  const roleArn = process.env.SCHEDULER_EVENTS_ROLE_ARN;
  const eventBusArn = process.env.SCHEDULING_EVENT_BUS_ARN;

  if (!roleArn || !eventBusArn) {
    throw new Error('Missing scheduler event bus configuration (roleArn or eventBusArn)');
  }

  return { roleArn, eventBusArn, groupName } as const;
}

export interface ScheduleRequest {
  contentId: string;
  brandId: string;
  userId: string;
  platform: string;
  scheduledAt: string;
  contentType?: string; // User-facing type: post/reel/story
  mediaType?: string; // Media format: image/video/reel/carousel
  videoUrl?: string; // Video CDN URL for video content
  caption?: string;
  firstComment?: string;
  hashtags?: string[];
  mediaAssets?: MediaAsset[]; // Structured media asset information
  metadata?: Record<string, unknown>;
  shareToFeed?: boolean;
  thumbOffset?: number; // Video thumbnail offset in milliseconds
  // RELIABILITY: Idempotency token to prevent duplicate schedules
  idempotencyToken?: string;
}

export interface PublishNowScheduleRequest extends Omit<ScheduleRequest, 'scheduledAt'> {
  // Optional client-provided value; ignored by the service.
  scheduledAt?: string;
}

export interface Schedule {
  pk: string;
  sk: string;
  scheduleId: string;
  contentId: string;
  brandId: string;
  userId: string;
  status: string;
  scheduledAt: string;
  // Keys for Brand GSI
  gsi1pk?: string;
  gsi1sk?: string;
  platform: string;
  contentType?: string; // User-facing type: post/reel/story
  mediaType?: string; // Media format: image/video/reel/carousel
  videoUrl?: string; // Video CDN URL for video content
  caption?: string;
  firstComment?: string;
  hashtags?: string[];
  mediaAssets?: MediaAsset[]; // Structured media asset information
  metadata?: Record<string, unknown>;
  shareToFeed?: boolean;
  thumbOffset?: number; // Video thumbnail offset in milliseconds
  createdAt: string;
  updatedAt: string;
  ttl?: number;
  // RELIABILITY: Track EventBridge schedule creation state
  eventBridgeScheduleArn?: string;
  eventBridgeScheduleCreated?: boolean;
  idempotencyToken?: string;
}

export interface ScheduleResult {
  success: boolean;
  schedule?: Schedule;
  error?: string;
}

export interface ListSchedulesResult {
  success: boolean;
  schedules?: Schedule[];
  pagination?: {
    nextToken?: string;
    hasMore: boolean;
  };
  error?: string;
}

export class ScheduleService {
  private config = getDynamoDBConfig();

  /**
   * Create a new schedule
   */
  async createSchedule(request: ScheduleRequest): Promise<ScheduleResult> {
    logger.info('Creating schedule', {
      contentId: request.contentId,
      brandId: request.brandId,
      scheduledAt: request.scheduledAt,
    });

    try {
      // 1. Generate schedule ID and create DynamoDB record
      // RELIABILITY: Use idempotency token to prevent duplicate schedules on retry
      const scheduleId = randomUUID();
      const idempotencyToken = request.idempotencyToken || randomUUID();
      const now = new Date().toISOString();

      const schedule: Schedule = {
        pk: `SCHEDULE#${request.contentId}`,
        sk: 'METADATA',
        scheduleId,
        contentId: request.contentId,
        brandId: request.brandId,
        userId: request.userId,
        status: SCHEDULE_STATUS.SCHEDULED,
        scheduledAt: request.scheduledAt,
        // Brand GSI keys for brand-based listing
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
        // Set TTL for 30 days after scheduled time for cleanup
        ttl: Math.floor(
          (new Date(request.scheduledAt).getTime() + 30 * 24 * 60 * 60 * 1000) / 1000
        ),
        // RELIABILITY: Track EventBridge schedule creation state (two-phase commit)
        eventBridgeScheduleCreated: false,
        idempotencyToken,
      };

      // Try to insert; if a schedule for this content already exists, treat as idempotent and update
      try {
        await docClient.send(
          new PutCommand({
            TableName: this.config.schedulesTable,
            Item: schedule,
            ConditionExpression: 'attribute_not_exists(pk)', // Prevent overwrites
          })
        );
      } catch (putErr) {
        if ((putErr as Error)?.name === 'ConditionalCheckFailedException') {
          // Existing schedule — update time instead of failing
          const existingRes = await docClient.send(
            new GetCommand({
              TableName: this.config.schedulesTable,
              Key: { pk: `SCHEDULE#${request.contentId}`, sk: 'METADATA' },
            })
          );
          const existing = existingRes.Item as Schedule | undefined;
          if (existing) {
            // If same time, clear any previous schedulingError and return existing idempotently
            if (existing.scheduledAt === request.scheduledAt) {
              logger.info('Idempotent create: schedule already exists with same time', {
                scheduleId: existing.scheduleId,
              });

              // Proactively clear stale schedulingError from previous attempts
              try {
                const nowTs = new Date().toISOString();
                const updated = await docClient.send(
                  new UpdateCommand({
                    TableName: this.config.schedulesTable,
                    Key: { pk: existing.pk, sk: existing.sk },
                    UpdateExpression: 'SET updatedAt = :now REMOVE #error',
                    ExpressionAttributeNames: {
                      '#error': 'schedulingError',
                    },
                    ExpressionAttributeValues: {
                      ':now': nowTs,
                    },
                    ReturnValues: 'ALL_NEW',
                  })
                );

                const updatedSchedule = (updated.Attributes || existing) as Schedule;
                return { success: true, schedule: updatedSchedule };
              } catch (ignoreUpdateError) {
                // If we cannot update, return the existing item as-is (non-fatal)
                logger.warn('Failed to clear stale schedulingError on idempotent create', {
                  scheduleId: existing.scheduleId,
                  error: ignoreUpdateError,
                });
                return { success: true, schedule: existing };
              }
            }

            // Use updateSchedule to update time and EB schedule
            return await this.updateSchedule(existing.scheduleId, {
              scheduledAt: request.scheduledAt,
            });
          }
        }
        throw putErr;
      }

      // 3. Create EventBridge schedule (target: EventBus)
      // RELIABILITY: Two-phase commit - EventBridge creation is step 2
      const eventBridgeTime = formatEventBridgeScheduleTime(new Date(request.scheduledAt));
      let scheduleArn: string | undefined;

      try {
        const targetCfg = await getSchedulerEventBusTargetConfig();
        await schedulerClient.send(
          new CreateScheduleCommand({
            Name: scheduleId,
            GroupName: targetCfg.groupName,
            ScheduleExpression: `at(${eventBridgeTime})`,
            Target: {
              Arn: targetCfg.eventBusArn,
              RoleArn: targetCfg.roleArn,
              Input: JSON.stringify({
                scheduleId,
                contentId: request.contentId,
                brandId: request.brandId,
                userId: request.userId,
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

        // Construct ARN (EventBridge Scheduler doesn't return ARN in response)
        const region = process.env.AWS_REGION || 'us-east-1';
        const accountId = targetCfg.roleArn.split(':')[4]; // Extract from role ARN
        scheduleArn = `arn:aws:scheduler:${region}:${accountId}:schedule/${targetCfg.groupName}/${scheduleId}`;

        // RELIABILITY: Update DynamoDB to mark EventBridge schedule as created (phase 2 complete)
        await docClient.send(
          new UpdateCommand({
            TableName: this.config.schedulesTable,
            Key: { pk: `SCHEDULE#${request.contentId}`, sk: 'METADATA' },
            UpdateExpression:
              'SET eventBridgeScheduleCreated = :true, eventBridgeScheduleArn = :arn, updatedAt = :now',
            ExpressionAttributeValues: {
              ':true': true,
              ':arn': scheduleArn,
              ':now': new Date().toISOString(),
            },
          })
        );

        logger.info('EventBridge schedule created and confirmed in DynamoDB', {
          scheduleId,
          scheduleArn,
        });
      } catch (schedulerError) {
        // RELIABILITY: Mark the DynamoDB record as failed but DON'T delete it
        // This allows reconciliation job to detect and clean up orphaned records
        logger.error('EventBridge schedule creation failed, marking in DynamoDB', {
          scheduleId,
          error: schedulerError,
        });

        try {
          await docClient.send(
            new UpdateCommand({
              TableName: this.config.schedulesTable,
              Key: { pk: `SCHEDULE#${request.contentId}`, sk: 'METADATA' },
              UpdateExpression: 'SET schedulingError = :error, updatedAt = :now',
              ExpressionAttributeValues: {
                ':error':
                  schedulerError instanceof Error ? schedulerError.message : 'Unknown error',
                ':now': new Date().toISOString(),
              },
            })
          );
        } catch (updateError) {
          logger.error('Failed to mark scheduling error in DynamoDB', {
            scheduleId,
            updateError,
          });
        }

        throw schedulerError;
      }

      // 4. Emit schedule created event
      await this.emitScheduleEvent('schedule.created', schedule);

      logger.info('Schedule created successfully', {
        scheduleId,
        contentId: request.contentId,
        scheduledAt: request.scheduledAt,
      });

      metrics.addMetric('ScheduleCreated', MetricUnit.Count, 1);

      // RELIABILITY: Return the updated schedule with EventBridge confirmation
      const finalSchedule: Schedule = {
        ...schedule,
        eventBridgeScheduleCreated: true,
        eventBridgeScheduleArn: scheduleArn,
      };

      return {
        success: true,
        schedule: finalSchedule,
      };
    } catch (error) {
      logger.error('Failed to create schedule', {
        error,
        contentId: request.contentId,
      });

      metrics.addMetric('ScheduleCreateFailed', MetricUnit.Count, 1);

      // Emit schedule.failed event for status-sync
      await this.emitScheduleFailedEvent(
        undefined,
        error instanceof Error ? error.message : 'Unknown error',
        'create',
        {
          contentId: request.contentId,
          brandId: request.brandId,
          platform: request.platform,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Publish immediately.
   *
   * Creates (or updates) a schedule record with scheduledAt="now" and emits a schedule.due event.
   *
   * Reliability note: publisher reads schedules via scheduleId GSI, which is eventually consistent.
   * We confirm the GSI has the record before emitting schedule.due to avoid "Schedule not found" races.
   */
  async publishNow(request: PublishNowScheduleRequest): Promise<ScheduleResult> {
    logger.info('Publishing now', {
      contentId: request.contentId,
      brandId: request.brandId,
      platform: request.platform,
    });

    try {
      const now = new Date().toISOString();
      const scheduledAt = now;
      const ttl = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);
      const pk = `SCHEDULE#${request.contentId}`;

      const existing = await docClient.send(
        new GetCommand({
          TableName: this.config.schedulesTable,
          Key: { pk, sk: 'METADATA' },
          ConsistentRead: true,
        })
      );

      const existingSchedule = existing.Item as Schedule | undefined;
      const scheduleId = existingSchedule?.scheduleId || randomUUID();
      const idempotencyToken =
        request.idempotencyToken || existingSchedule?.idempotencyToken || randomUUID();

      const base: Schedule = {
        pk,
        sk: 'METADATA',
        scheduleId,
        contentId: request.contentId,
        brandId: request.brandId,
        userId: request.userId,
        status: SCHEDULE_STATUS.SCHEDULED,
        scheduledAt,
        gsi1pk: `BRAND#${request.brandId}`,
        gsi1sk: scheduledAt,
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
        ttl,
        eventBridgeScheduleCreated: false,
        eventBridgeScheduleArn: undefined,
        idempotencyToken,
      };

      let next: Schedule = base;

      if (existingSchedule) {
        // Security: ensure only the schedule owner can mutate/trigger.
        if (existingSchedule.userId !== request.userId) {
          return { success: false, error: 'Forbidden: You do not have access to this schedule' };
        }

        await docClient.send(
          new PutCommand({
            TableName: this.config.schedulesTable,
            Item: next,
          })
        );
      } else {
        // Create record (idempotent).
        try {
          await docClient.send(
            new PutCommand({
              TableName: this.config.schedulesTable,
              Item: next,
              ConditionExpression: 'attribute_not_exists(pk)',
            })
          );
        } catch (putErr) {
          // If a concurrent writer created the schedule, re-read and continue.
          const existingAgain = await docClient.send(
            new GetCommand({
              TableName: this.config.schedulesTable,
              Key: { pk, sk: 'METADATA' },
              ConsistentRead: true,
            })
          );
          const scheduleAgain = existingAgain.Item as Schedule | undefined;
          if (!scheduleAgain) throw putErr;
          if (scheduleAgain.userId !== request.userId) {
            return { success: false, error: 'Forbidden: You do not have access to this schedule' };
          }

          next = {
            ...base,
            scheduleId: scheduleAgain.scheduleId,
            createdAt: scheduleAgain.createdAt || now,
            idempotencyToken: scheduleAgain.idempotencyToken || idempotencyToken,
          };

          // Overwrite the existing schedule with the publish-now payload.
          await docClient.send(
            new PutCommand({
              TableName: this.config.schedulesTable,
              Item: next,
            })
          );
        }
      }

      // Best-effort: delete any existing EventBridge schedule to prevent later triggers.
      // We do this after scheduleId is finalized (handles rare races on initial creation).
      try {
        const targetCfg = await getSchedulerEventBusTargetConfig();
        await schedulerClient.send(
          new DeleteScheduleCommand({
            Name: next.scheduleId,
            GroupName: targetCfg.groupName,
          })
        );
      } catch (deleteError) {
        logger.debug('EventBridge schedule delete skipped/failed (ignored)', {
          scheduleId: next.scheduleId,
          error: deleteError,
        });
      }

      // Confirm schedule is visible via scheduleId GSI before emitting schedule.due.
      if (!existingSchedule) {
        const deadline = Date.now() + 5000;
        let visible = false;
        while (Date.now() < deadline) {
          const found = await this.getSchedule(next.scheduleId);
          if (found.success && found.schedule) {
            visible = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!visible) {
          logger.warn('Schedule not visible via scheduleId GSI; aborting publish-now emit', {
            scheduleId: next.scheduleId,
            contentId: request.contentId,
          });
          return {
            success: false,
            error: 'Schedule record not yet available; please retry',
          };
        }
      }

      try {
        await eventBridge.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: 'postolio.scheduling',
                DetailType: 'schedule.due',
                Detail: JSON.stringify({
                  scheduleId: next.scheduleId,
                  contentId: request.contentId,
                  brandId: request.brandId,
                  userId: request.userId,
                }),
                EventBusName: process.env.EVENT_BUS_NAME || 'default',
              },
            ],
          })
        );
      } catch (emitErr) {
        logger.error('Failed to emit schedule.due event', { error: emitErr, scheduleId });
        return {
          success: false,
          error: 'Failed to enqueue publish event',
        };
      }

      // Emit schedule.created after schedule.due is enqueued (keeps status-sync behavior consistent).
      await this.emitScheduleEvent('schedule.created', next);

      metrics.addMetric('PublishNowEnqueued', MetricUnit.Count, 1);

      return {
        success: true,
        schedule: next,
      };
    } catch (error) {
      logger.error('Failed to publish now', {
        error,
        contentId: request.contentId,
      });

      metrics.addMetric('PublishNowFailed', MetricUnit.Count, 1);

      await this.emitScheduleFailedEvent(
        undefined,
        error instanceof Error ? error.message : 'Unknown error',
        'create',
        {
          contentId: request.contentId,
          brandId: request.brandId,
          platform: request.platform,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get a schedule by ID
   */
  async getSchedule(scheduleId: string): Promise<ScheduleResult> {
    try {
      // Find schedule by scheduleId using GSI
      const result = await docClient.send(
        new QueryCommand({
          TableName: this.config.schedulesTable,
          IndexName: this.config.indexes.schedule.name,
          KeyConditionExpression: 'scheduleId = :scheduleId',
          ExpressionAttributeValues: {
            ':scheduleId': scheduleId,
          },
        })
      );

      if (!result.Items || result.Items.length === 0) {
        return {
          success: true,
          schedule: undefined,
        };
      }

      const schedule = result.Items[0] as Schedule;

      return {
        success: true,
        schedule,
      };
    } catch (error) {
      logger.error('Failed to get schedule', { error, scheduleId });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * List schedules with optional filters
   */
  async listSchedules(queryParams: Record<string, string>): Promise<ListSchedulesResult> {
    try {
      const { brandId, status, limit = '20', nextToken } = queryParams;

      let command: QueryCommand;

      if (brandId) {
        // Query by brand using GSI
        if (!this.config.indexes.brand.name) {
          throw new Error('Brand index not configured');
        }
        command = new QueryCommand({
          TableName: this.config.schedulesTable,
          IndexName: this.config.indexes.brand.name,
          KeyConditionExpression: 'gsi1pk = :brandKey',
          ExpressionAttributeValues: {
            ':brandKey': `BRAND#${brandId}`,
          },
          Limit: parseInt(limit, 10),
          ExclusiveStartKey: nextToken ? JSON.parse(nextToken) : undefined,
        });
      } else if (status) {
        // Query by status using GSI
        if (!this.config.indexes.status.name) {
          throw new Error('Status index not configured');
        }
        command = new QueryCommand({
          TableName: this.config.schedulesTable,
          IndexName: this.config.indexes.status.name,
          KeyConditionExpression: 'status = :status',
          ExpressionAttributeValues: {
            ':status': status,
          },
          Limit: parseInt(limit, 10),
          ExclusiveStartKey: nextToken ? JSON.parse(nextToken) : undefined,
        });
      } else {
        // Scan all schedules (expensive - should be limited)
        command = new QueryCommand({
          TableName: this.config.schedulesTable,
          // Note: This would need to be a ScanCommand for all items
          // For now, require at least brandId or status filter
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: {
            ':pk': 'SCHEDULE#',
          },
          Limit: parseInt(limit, 10),
          ExclusiveStartKey: nextToken ? JSON.parse(nextToken) : undefined,
        });
      }

      const result = await docClient.send(command);

      const schedules = (result.Items || []) as Schedule[];

      return {
        success: true,
        schedules,
        pagination: {
          nextToken: result.LastEvaluatedKey ? JSON.stringify(result.LastEvaluatedKey) : undefined,
          hasMore: !!result.LastEvaluatedKey,
        },
      };
    } catch (error) {
      logger.error('Failed to list schedules', { error, queryParams });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update a schedule
   */
  async updateSchedule(
    scheduleId: string,
    updateRequest: Partial<ScheduleRequest>
  ): Promise<ScheduleResult> {
    try {
      // First, get the existing schedule
      const getResult = await this.getSchedule(scheduleId);
      if (!getResult.success || !getResult.schedule) {
        return {
          success: false,
          error: 'Schedule not found',
        };
      }

      const existingSchedule = getResult.schedule;

      // Build update expression
      const updateExpressions: string[] = [];
      const removeExpressions: string[] = [];
      const expressionAttributeNames: Record<string, string> = {};
      const expressionAttributeValues: Record<string, unknown> = {};
      const hasTimeChange = !!(
        updateRequest.scheduledAt && updateRequest.scheduledAt !== existingSchedule.scheduledAt
      );
      const wantsUserIdUpdate = !!(
        updateRequest.userId && updateRequest.userId !== existingSchedule.userId
      );

      if (hasTimeChange) {
        updateExpressions.push('scheduledAt = :scheduledAt');
        expressionAttributeValues[':scheduledAt'] = updateRequest.scheduledAt;

        // Maintain Brand GSI sort key alongside scheduledAt
        updateExpressions.push('gsi1sk = :gsi1sk');
        expressionAttributeValues[':gsi1sk'] = updateRequest.scheduledAt;

        // If userId provided on update, persist it
        if (wantsUserIdUpdate) {
          updateExpressions.push('userId = :userId');
          expressionAttributeValues[':userId'] = updateRequest.userId;
        }

        // Update EventBridge schedule
        const eventBridgeTime = formatEventBridgeScheduleTime(new Date(updateRequest.scheduledAt));
        const userIdForTarget = updateRequest.userId ?? existingSchedule.userId;
        try {
          const targetCfg2 = await getSchedulerEventBusTargetConfig();
          await schedulerClient.send(
            new UpdateScheduleCommand({
              Name: scheduleId,
              GroupName: targetCfg2.groupName,
              ScheduleExpression: `at(${eventBridgeTime})`,
              Target: {
                Arn: targetCfg2.eventBusArn,
                RoleArn: targetCfg2.roleArn,
                Input: JSON.stringify({
                  scheduleId,
                  contentId: existingSchedule.contentId,
                  brandId: existingSchedule.brandId,
                  userId: userIdForTarget,
                }),
                EventBridgeParameters: {
                  DetailType: 'schedule.due',
                  Source: 'postolio.scheduling',
                },
              },
              FlexibleTimeWindow: { Mode: 'OFF' },
            })
          );
        } catch (err) {
          if ((err as Error)?.name === 'ResourceNotFoundException') {
            const targetCfg2 = await getSchedulerEventBusTargetConfig();
            await schedulerClient.send(
              new CreateScheduleCommand({
                Name: scheduleId,
                GroupName: targetCfg2.groupName,
                ScheduleExpression: `at(${eventBridgeTime})`,
                Target: {
                  Arn: targetCfg2.eventBusArn,
                  RoleArn: targetCfg2.roleArn,
                  Input: JSON.stringify({
                    scheduleId,
                    contentId: existingSchedule.contentId,
                    brandId: existingSchedule.brandId,
                    userId: userIdForTarget,
                  }),
                  EventBridgeParameters: {
                    DetailType: 'schedule.due',
                    Source: 'postolio.scheduling',
                  },
                },
                FlexibleTimeWindow: { Mode: 'OFF' },
              })
            );
          } else {
            throw err;
          }
        }
      }

      // If only userId changed (time stayed the same), update userId in Dynamo and
      // also update the EventBridge schedule Target input so publisher receives userId
      if (!hasTimeChange && wantsUserIdUpdate) {
        updateExpressions.push('userId = :userId');
        expressionAttributeValues[':userId'] = updateRequest.userId;

        try {
          const targetCfg = await getSchedulerEventBusTargetConfig();
          const eventBridgeTime = formatEventBridgeScheduleTime(
            new Date(existingSchedule.scheduledAt)
          );
          await schedulerClient.send(
            new UpdateScheduleCommand({
              Name: scheduleId,
              GroupName: targetCfg.groupName,
              ScheduleExpression: `at(${eventBridgeTime})`,
              Target: {
                Arn: targetCfg.eventBusArn,
                RoleArn: targetCfg.roleArn,
                Input: JSON.stringify({
                  scheduleId,
                  contentId: existingSchedule.contentId,
                  brandId: existingSchedule.brandId,
                  userId: updateRequest.userId,
                }),
                EventBridgeParameters: {
                  DetailType: 'schedule.due',
                  Source: 'postolio.scheduling',
                },
              },
              FlexibleTimeWindow: { Mode: 'OFF' },
            })
          );
        } catch (err) {
          logger.warn('Failed to update Scheduler target with new userId', {
            scheduleId,
            error: err,
          });
          // Continue with DynamoDB update even if Scheduler target update fails
        }
      }

      if (updateRequest.caption !== undefined) {
        updateExpressions.push('caption = :caption');
        expressionAttributeValues[':caption'] = updateRequest.caption;
      }

      if (updateRequest.firstComment !== undefined) {
        updateExpressions.push('firstComment = :firstComment');
        expressionAttributeValues[':firstComment'] = updateRequest.firstComment;
      }

      if (updateRequest.hashtags !== undefined) {
        updateExpressions.push('hashtags = :hashtags');
        expressionAttributeValues[':hashtags'] = updateRequest.hashtags;
      }

      if (updateRequest.mediaAssets !== undefined) {
        updateExpressions.push('mediaAssets = :mediaAssets');
        expressionAttributeValues[':mediaAssets'] = updateRequest.mediaAssets;
      }

      if (updateRequest.thumbOffset !== undefined) {
        updateExpressions.push('thumbOffset = :thumbOffset');
        expressionAttributeValues[':thumbOffset'] = updateRequest.thumbOffset;
      }

      if (updateRequest.shareToFeed !== undefined) {
        updateExpressions.push('shareToFeed = :shareToFeed');
        expressionAttributeValues[':shareToFeed'] = updateRequest.shareToFeed;
      }

      if (updateRequest.metadata !== undefined) {
        updateExpressions.push('metadata = :metadata');
        expressionAttributeValues[':metadata'] = updateRequest.metadata;
      }

      // Always update the updatedAt timestamp
      updateExpressions.push('updatedAt = :updatedAt');
      expressionAttributeValues[':updatedAt'] = new Date().toISOString();

      // On any successful update, clear any previous schedulingError
      expressionAttributeNames['#error'] = 'schedulingError';
      removeExpressions.push('#error');

      if (updateExpressions.length === 1 && removeExpressions.length === 0) {
        // Only updatedAt changed, nothing to update
        return {
          success: true,
          schedule: existingSchedule,
        };
      }

      // Build UpdateExpression supporting SET ... and conditional REMOVE ...
      const updateExpression = `SET ${updateExpressions.join(', ')}${
        removeExpressions.length > 0 ? ' REMOVE ' + removeExpressions.join(', ') : ''
      }`;

      // Update DynamoDB record
      await docClient.send(
        new UpdateCommand({
          TableName: this.config.schedulesTable,
          Key: {
            pk: existingSchedule.pk,
            sk: existingSchedule.sk,
          },
          UpdateExpression: updateExpression,
          ExpressionAttributeNames:
            Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
          ExpressionAttributeValues: expressionAttributeValues,
          ReturnValues: 'ALL_NEW',
        })
      );

      // Get updated schedule
      const updatedResult = await this.getSchedule(scheduleId);
      if (!updatedResult.success || !updatedResult.schedule) {
        throw new Error('Failed to retrieve updated schedule');
      }

      // Emit schedule updated event
      await this.emitScheduleEvent('schedule.updated', updatedResult.schedule);

      logger.info('Schedule updated successfully', {
        scheduleId,
        updates: Object.keys(updateRequest),
      });

      metrics.addMetric('ScheduleUpdated', MetricUnit.Count, 1);

      return {
        success: true,
        schedule: updatedResult.schedule,
      };
    } catch (error) {
      logger.error('Failed to update schedule', { error, scheduleId });

      metrics.addMetric('ScheduleUpdateFailed', MetricUnit.Count, 1);

      // Emit schedule.failed event for status-sync
      await this.emitScheduleFailedEvent(
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

  /**
   * Delete a schedule
   */
  async deleteSchedule(scheduleId: string): Promise<ScheduleResult> {
    try {
      // First, get the existing schedule
      const getResult = await this.getSchedule(scheduleId);
      if (!getResult.success || !getResult.schedule) {
        return {
          success: false,
          error: 'Schedule not found',
        };
      }

      const schedule = getResult.schedule;

      // Delete from EventBridge first
      try {
        await schedulerClient.send(
          new DeleteScheduleCommand({
            Name: scheduleId,
            GroupName: (await getSchedulerEventBusTargetConfig()).groupName,
          })
        );
      } catch (schedulerError) {
        logger.warn('Failed to delete EventBridge schedule (may not exist)', {
          scheduleId,
          error: schedulerError,
        });
        // Continue with DynamoDB deletion even if EventBridge fails
      }

      // Delete from DynamoDB
      await docClient.send(
        new DeleteCommand({
          TableName: this.config.schedulesTable,
          Key: {
            pk: schedule.pk,
            sk: schedule.sk,
          },
        })
      );

      // Emit schedule canceled event
      await this.emitScheduleEvent('schedule.canceled', schedule);

      logger.info('Schedule deleted successfully', { scheduleId });

      metrics.addMetric('ScheduleDeleted', MetricUnit.Count, 1);

      return {
        success: true,
      };
    } catch (error) {
      logger.error('Failed to delete schedule', { error, scheduleId });

      metrics.addMetric('ScheduleDeleteFailed', MetricUnit.Count, 1);

      // Emit schedule.failed event for monitoring
      await this.emitScheduleFailedEvent(
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

  /**
   * Emit schedule events for downstream processing
   */
  private async emitScheduleEvent(eventType: string, schedule: Schedule): Promise<void> {
    try {
      await eventBridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'postolio.scheduler',
              DetailType: eventType,
              Detail: JSON.stringify({
                scheduleId: schedule.scheduleId,
                contentId: schedule.contentId,
                brandId: schedule.brandId,
                status: schedule.status,
                scheduledAt: schedule.scheduledAt,
                platform: schedule.platform,
                timestamp: new Date().toISOString(),
              }),
              EventBusName: process.env.EVENT_BUS_NAME || 'default',
            },
          ],
        })
      );

      logger.debug('Schedule event emitted', {
        eventType,
        scheduleId: schedule.scheduleId,
      });
    } catch (error) {
      logger.warn('Failed to emit schedule event', {
        error,
        eventType,
        scheduleId: schedule.scheduleId,
      });
      // Don't fail the operation if event emission fails
    }
  }

  /**
   * Emit schedule failure event with partial data
   */
  private async emitScheduleFailedEvent(
    scheduleId: string | undefined,
    errorMessage: string,
    operation: 'create' | 'update' | 'delete',
    partialData?: {
      contentId?: string;
      brandId?: string;
      platform?: string;
    }
  ): Promise<void> {
    try {
      await eventBridge.send(
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
              EventBusName: process.env.EVENT_BUS_NAME || 'default',
            },
          ],
        })
      );

      logger.debug('Schedule failure event emitted', {
        scheduleId,
        operation,
      });
    } catch (error) {
      logger.warn('Failed to emit schedule failure event', {
        error,
        scheduleId,
        operation,
      });
      // Don't fail the operation if event emission fails
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ healthy: boolean; details: string }> {
    try {
      // Test DynamoDB connectivity
      await docClient.send(
        new GetCommand({
          TableName: this.config.schedulesTable,
          Key: { pk: 'HEALTH_CHECK', sk: 'TEST' },
        })
      );

      // Test EventBridge connectivity
      const targetCfg = await getSchedulerEventBusTargetConfig();
      await schedulerClient.send(
        new CreateScheduleCommand({
          Name: 'health-check-test',
          GroupName: targetCfg.groupName,
          ScheduleExpression: 'at(2030-01-01T00:00:00)',
          Target: {
            Arn: targetCfg.eventBusArn,
            RoleArn: targetCfg.roleArn,
            Input: JSON.stringify({ test: true }),
            EventBridgeParameters: { DetailType: 'schedule.due', Source: 'postolio.scheduling' },
          },
          FlexibleTimeWindow: { Mode: 'OFF' },
        })
      );

      // Clean up test schedule
      await schedulerClient.send(
        new DeleteScheduleCommand({
          Name: 'health-check-test',
          GroupName: targetCfg.groupName,
        })
      );

      return {
        healthy: true,
        details: 'All schedule service components are healthy',
      };
    } catch (error) {
      logger.error('Schedule service health check failed', { error });
      return {
        healthy: false,
        details: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
