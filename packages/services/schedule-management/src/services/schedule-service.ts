/**
 * Schedule Service
 *
 * Core business logic for schedule management operations
 * Separated from handlers for better testability and reusability
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
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import {
  getCampaignById,
  canCampaignSchedule,
  getCampaignScheduleBlockReason,
} from '@postolio/aws';
import { randomUUID } from 'crypto';
import { getDynamoDBConfig, SCHEDULE_STATUS, formatEventBridgeScheduleTime } from '../config';

const logger = new Logger({ serviceName: 'schedule-service' });
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
const ssmClient = tracer.captureAWSv3Client(new SSMClient({}));

async function getSchedulerTargetConfig() {
  const environment = process.env.ENVIRONMENT || 'dev';
  let publisherArn = process.env.PUBLISHER_LAMBDA_ARN;
  let schedulerRoleArn = process.env.SCHEDULER_ROLE_ARN;
  const groupName = process.env.SCHEDULER_GROUP_NAME || 'default';

  if (!publisherArn) {
    const param = await ssmClient.send(
      new GetParameterCommand({
        Name: `/postolio/${environment}/publishing/publisher-lambda-arn`,
      })
    );
    publisherArn = param.Parameter?.Value;
  }

  if (!schedulerRoleArn) {
    const param = await ssmClient.send(
      new GetParameterCommand({
        Name: `/postolio/${environment}/publishing/scheduler-role-arn`,
      })
    );
    schedulerRoleArn = param.Parameter?.Value;
  }

  if (!publisherArn || !schedulerRoleArn) {
    throw new Error('Missing scheduler target configuration (publisherArn or schedulerRoleArn)');
  }

  return { publisherArn, schedulerRoleArn, groupName } as const;
}

export interface ScheduleRequest {
  contentId: string;
  brandId: string;
  campaignId?: string;
  userId: string;
  platform: string;
  scheduledAt: string;
  contentType: string;
  caption?: string;
  hashtags?: string[];
  mediaUrls?: string[];
  metadata?: Record<string, unknown>;
}

export interface Schedule {
  pk: string;
  sk: string;
  scheduleId: string;
  contentId: string;
  brandId: string;
  campaignId?: string;
  status: string;
  scheduledAt: string;
  // Keys for Brand GSI
  gsi1pk?: string;
  gsi1sk?: string;
  platform: string;
  contentType: string;
  caption?: string;
  hashtags?: string[];
  mediaUrls?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  ttl?: number;
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
      campaignId: request.campaignId,
      scheduledAt: request.scheduledAt,
    });

    try {
      // 1. Validate campaign if specified
      if (request.campaignId) {
        // Validate directly by campaignId; contentId has no schedule yet at creation time
        const campaign = await getCampaignById(request.campaignId);
        if (!canCampaignSchedule(campaign)) {
          const blockReason = getCampaignScheduleBlockReason(campaign);
          return {
            success: false,
            error: blockReason || 'Campaign does not allow scheduling',
          };
        }
      }

      // 2. Generate schedule ID and create DynamoDB record
      const scheduleId = randomUUID();
      const now = new Date().toISOString();

      const schedule: Schedule = {
        pk: `SCHEDULE#${request.contentId}`,
        sk: 'METADATA',
        scheduleId,
        contentId: request.contentId,
        brandId: request.brandId,
        campaignId: request.campaignId,
        status: SCHEDULE_STATUS.SCHEDULED,
        scheduledAt: request.scheduledAt,
        // Brand GSI keys for brand-based listing
        gsi1pk: `BRAND#${request.brandId}`,
        gsi1sk: request.scheduledAt,
        platform: request.platform,
        contentType: request.contentType,
        caption: request.caption,
        hashtags: request.hashtags || [],
        mediaUrls: request.mediaUrls || [],
        metadata: request.metadata,
        createdAt: now,
        updatedAt: now,
        // Set TTL for 30 days after scheduled time for cleanup
        ttl: Math.floor(
          (new Date(request.scheduledAt).getTime() + 30 * 24 * 60 * 60 * 1000) / 1000
        ),
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
            // If same time, return existing idempotently
            if (existing.scheduledAt === request.scheduledAt) {
              logger.info('Idempotent create: schedule already exists with same time', {
                scheduleId: existing.scheduleId,
              });
              return { success: true, schedule: existing };
            }

            // Use updateSchedule to update time and EB schedule
            return await this.updateSchedule(existing.scheduleId, {
              scheduledAt: request.scheduledAt,
            });
          }
        }
        throw putErr;
      }

      // 3. Create EventBridge schedule
      const eventBridgeTime = formatEventBridgeScheduleTime(new Date(request.scheduledAt));

      try {
        const targetCfg = await getSchedulerTargetConfig();
        await schedulerClient.send(
          new CreateScheduleCommand({
            Name: scheduleId,
            GroupName: targetCfg.groupName,
            ScheduleExpression: `at(${eventBridgeTime})`,
            Target: {
              Arn: targetCfg.publisherArn,
              RoleArn: targetCfg.schedulerRoleArn,
              Input: JSON.stringify({
                scheduleId,
                contentId: request.contentId,
                brandId: request.brandId,
                campaignId: request.campaignId,
              }),
            },
            FlexibleTimeWindow: {
              Mode: 'OFF',
            },
          })
        );
      } catch (schedulerError) {
        // Roll back the DynamoDB item to allow clean retry
        await docClient.send(
          new DeleteCommand({
            TableName: this.config.schedulesTable,
            Key: { pk: `SCHEDULE#${request.contentId}`, sk: 'METADATA' },
          })
        );
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

      return {
        success: true,
        schedule,
      };
    } catch (error) {
      logger.error('Failed to create schedule', {
        error,
        contentId: request.contentId,
      });

      metrics.addMetric('ScheduleCreateFailed', MetricUnit.Count, 1);

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

      // Validate campaign if being updated
      if (updateRequest.campaignId || existingSchedule.campaignId) {
        const campaignIdToValidate = updateRequest.campaignId || existingSchedule.campaignId;
        if (campaignIdToValidate) {
          const campaign = await getCampaignById(campaignIdToValidate);
          if (!canCampaignSchedule(campaign)) {
            const blockReason = getCampaignScheduleBlockReason(campaign);
            return {
              success: false,
              error: blockReason || 'Campaign does not allow scheduling updates',
            };
          }
        }
      }

      // Build update expression
      const updateExpressions: string[] = [];
      const expressionAttributeNames: Record<string, string> = {};
      const expressionAttributeValues: Record<string, unknown> = {};

      if (updateRequest.scheduledAt && updateRequest.scheduledAt !== existingSchedule.scheduledAt) {
        updateExpressions.push('scheduledAt = :scheduledAt');
        expressionAttributeValues[':scheduledAt'] = updateRequest.scheduledAt;

        // Maintain Brand GSI sort key alongside scheduledAt
        updateExpressions.push('gsi1sk = :gsi1sk');
        expressionAttributeValues[':gsi1sk'] = updateRequest.scheduledAt;

        // Update EventBridge schedule
        const eventBridgeTime = formatEventBridgeScheduleTime(new Date(updateRequest.scheduledAt));

        const targetCfg2 = await getSchedulerTargetConfig();
        await schedulerClient.send(
          new UpdateScheduleCommand({
            Name: scheduleId,
            GroupName: targetCfg2.groupName,
            ScheduleExpression: `at(${eventBridgeTime})`,
            Target: {
              Arn: targetCfg2.publisherArn,
              RoleArn: targetCfg2.schedulerRoleArn,
              Input: JSON.stringify({
                scheduleId,
                contentId: existingSchedule.contentId,
                brandId: existingSchedule.brandId,
                campaignId: updateRequest.campaignId || existingSchedule.campaignId,
              }),
            },
            FlexibleTimeWindow: {
              Mode: 'OFF',
            },
          })
        );
      }

      if (updateRequest.caption !== undefined) {
        updateExpressions.push('caption = :caption');
        expressionAttributeValues[':caption'] = updateRequest.caption;
      }

      if (updateRequest.hashtags !== undefined) {
        updateExpressions.push('hashtags = :hashtags');
        expressionAttributeValues[':hashtags'] = updateRequest.hashtags;
      }

      if (updateRequest.metadata !== undefined) {
        updateExpressions.push('metadata = :metadata');
        expressionAttributeValues[':metadata'] = updateRequest.metadata;
      }

      // Always update the updatedAt timestamp
      updateExpressions.push('updatedAt = :updatedAt');
      expressionAttributeValues[':updatedAt'] = new Date().toISOString();

      if (updateExpressions.length === 1) {
        // Only updatedAt changed, nothing to update
        return {
          success: true,
          schedule: existingSchedule,
        };
      }

      // Update DynamoDB record
      await docClient.send(
        new UpdateCommand({
          TableName: this.config.schedulesTable,
          Key: {
            pk: existingSchedule.pk,
            sk: existingSchedule.sk,
          },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
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
            GroupName: (await getSchedulerTargetConfig()).groupName,
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
                campaignId: schedule.campaignId,
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
      const targetCfg = await getSchedulerTargetConfig();
      await schedulerClient.send(
        new CreateScheduleCommand({
          Name: 'health-check-test',
          GroupName: targetCfg.groupName,
          ScheduleExpression: 'at(2030-01-01T00:00:00)',
          Target: {
            Arn: targetCfg.publisherArn,
            RoleArn: targetCfg.schedulerRoleArn,
            Input: JSON.stringify({ test: true }),
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
