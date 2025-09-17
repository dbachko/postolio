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
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyEventV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { getDynamoDBConfig, SCHEDULE_STATUS, formatEventBridgeScheduleTime } from './config';

/**
 * Schedule Management Lambda
 *
 * This Lambda handles CRUD operations for content schedules with resilience patterns:
 * - PUT operations implement "upsert" (update or insert) for data consistency recovery
 * - If a schedule is missing during update (e.g., DynamoDB data loss), it will be recreated
 * - This ensures the system can recover from data inconsistencies between services
 */

// Initialize Powertools
const logger = new Logger({ serviceName: 'schedule-management' });
const tracer = new Tracer({ serviceName: 'schedule-management' });
const metrics = new Metrics({
  namespace: 'ContentScheduler',
  serviceName: 'schedule-management',
});

// Initialize AWS SDK clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: false, // Keep undefined values as empty to ensure all fields are stored
    convertEmptyValues: true, // Convert empty strings/arrays to DynamoDB empty values
  },
});
const schedulerClient = tracer.captureAWSv3Client(new SchedulerClient({}));
const eventBridgeClient = tracer.captureAWSv3Client(new EventBridgeClient({}));

// Validation schemas
interface ScheduleRequest {
  brandId: string;
  contentId: string;
  platform: 'instagram' | 'facebook' | 'twitter' | 'linkedin' | 'youtube';
  scheduledAt: string;
  contentType?: 'image' | 'video' | 'carousel' | 'reel' | 'story';
  videoUrl?: string;
  caption?: string;
  hashtags?: string[];
  mediaUrls?: string[];
  userId?: string;
  metadata?: Record<string, unknown>;
}

interface ScheduleItem extends ScheduleRequest {
  scheduleId: string;
  pk: string;
  sk: 'METADATA';
  status: string;
  gsi1pk?: string;
  gsi1sk?: string;
  retryCount?: number;
  createdAt: string;
  updatedAt?: string;
  publishedAt?: string;
  errorMessage?: string;
  videoUrl?: string;
  caption?: string;
  hashtags?: string[];
  mediaUrls?: string[];
  metadata?: Record<string, unknown>;
}

// Input validation helper
function validateScheduleRequest(data: unknown): {
  valid: boolean;
  errors?: string[];
  data?: ScheduleRequest;
} {
  const d = data as Record<string, unknown>;
  const errors: string[] = [];

  // Required fields
  if (!d.brandId) errors.push('brandId is required');
  if (!d.contentId) errors.push('contentId is required');
  if (!d.platform) errors.push('platform is required');
  if (!d.scheduledAt) errors.push('scheduledAt is required');

  // Platform validation
  const validPlatforms = ['instagram', 'facebook', 'twitter', 'linkedin', 'youtube'];
  if (d.platform && typeof d.platform === 'string' && !validPlatforms.includes(d.platform)) {
    errors.push(`platform must be one of: ${validPlatforms.join(', ')}`);
  }

  // Date validation
  if (d.scheduledAt && typeof d.scheduledAt === 'string') {
    const scheduledDate = new Date(d.scheduledAt);
    const now = new Date();
    if (isNaN(scheduledDate.getTime())) {
      errors.push('scheduledAt must be a valid ISO 8601 date string');
    } else if (scheduledDate <= now) {
      errors.push('scheduledAt must be in the future');
    }
  }

  // Content type validation
  const validContentTypes = ['image', 'video', 'carousel', 'reel', 'story'];
  if (
    d.contentType &&
    typeof d.contentType === 'string' &&
    !validContentTypes.includes(d.contentType)
  ) {
    errors.push(`contentType must be one of: ${validContentTypes.join(', ')}`);
  }

  // Video URL required for video content types
  if (['video', 'reel'].includes(d.contentType as string) && !d.videoUrl) {
    errors.push('videoUrl is required for video content');
  }

  // Caption length validation (platform-specific)
  if (d.caption && typeof d.caption === 'string') {
    const maxLengths: Record<string, number> = {
      instagram: 2200,
      facebook: 63206,
      twitter: 280,
      linkedin: 3000,
      youtube: 5000,
    };
    const maxLength = maxLengths[d.platform as string] || 2200;
    if (d.caption.length > maxLength) {
      errors.push(`caption exceeds maximum length of ${maxLength} characters for ${d.platform}`);
    }
  }

  // Hashtag validation
  if (d.hashtags) {
    if (!Array.isArray(d.hashtags)) {
      errors.push('hashtags must be an array');
    } else if (d.hashtags.length > 30) {
      errors.push('maximum 30 hashtags allowed');
    }
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, data: d as unknown as ScheduleRequest };
}

// EventBridge event publisher
async function publishScheduleEvent(
  eventType: 'schedule.created' | 'schedule.updated' | 'schedule.canceled',
  scheduleData: {
    scheduleId: string;
    contentId: string;
    brandId?: string;
    scheduledAt?: string;
    updates?: { scheduledAt?: string };
  }
): Promise<void> {
  const eventDetail = {
    id: scheduleData.scheduleId,
    source: 'schedule-management',
    type: eventType,
    timestamp: new Date().toISOString(),
    data: scheduleData,
    metadata: {
      version: '1.0',
      traceId: tracer.getRootXrayTraceId(),
    },
  };

  const eventBridgeEvent = {
    Source: process.env.EVENT_SOURCE || 'postolio.scheduler',
    DetailType: 'Schedule Event',
    Detail: JSON.stringify(eventDetail),
    EventBusName: process.env.EVENT_BUS_NAME, // Use custom event bus if configured
  };

  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [eventBridgeEvent],
      })
    );

    logger.info('EventBridge event published', {
      eventType,
      scheduleId: scheduleData.scheduleId,
      contentId: scheduleData.contentId,
    });
  } catch (error) {
    logger.error('Failed to publish EventBridge event', {
      error,
      eventType,
      scheduleData,
    });
    // Don't fail the main operation if event publishing fails
    // Status-sync can be reconciled later
  }
}

// CORS headers helper
function addCorsHeaders(response: APIGatewayProxyResult): APIGatewayProxyResult {
  return {
    ...response,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...response.headers,
    },
  };
}

export const handler = async (
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): Promise<APIGatewayProxyResult> => {
  // Determine if this is a Function URL event (API Gateway v2.0 also uses version '2.0', so check for requestContext.http)
  const isV2Event =
    'requestContext' in event &&
    event.requestContext &&
    'http' in event.requestContext &&
    typeof event.requestContext.http === 'object';

  // Extract HTTP method from the appropriate event format
  const httpMethod = isV2Event
    ? (event as APIGatewayProxyEventV2).requestContext.http.method
    : (event as APIGatewayProxyEvent).httpMethod;

  // Extract path from the appropriate event format
  const path = isV2Event
    ? (event as APIGatewayProxyEventV2).requestContext.http.path
    : (event as APIGatewayProxyEvent).path;

  // Extract path parameters - for Function URLs, we need to parse from the path
  let scheduleId: string | undefined;
  if (isV2Event) {
    // For Function URLs, parse schedule ID from path like /schedules/123
    const pathMatch = path.match(/\/schedules\/([^/]+)/);
    scheduleId = pathMatch ? pathMatch[1] : undefined;
  } else {
    scheduleId = (event as APIGatewayProxyEvent).pathParameters?.scheduleId;
  }

  // Add context to logs
  logger.addPersistentLogAttributes({
    requestId: event.requestContext.requestId,
    method: httpMethod,
    path: path,
    eventVersion: isV2Event ? '2.0' : '1.0',
  });

  logger.info('Processing request', { event });

  try {
    const { body } = event;

    // Extract query string parameters from the appropriate event format
    const queryStringParameters = isV2Event
      ? (event as APIGatewayProxyEventV2).queryStringParameters
      : (event as APIGatewayProxyEvent).queryStringParameters;

    let result: APIGatewayProxyResult;

    // Handle CORS preflight
    if (httpMethod === 'OPTIONS') {
      return addCorsHeaders({
        statusCode: 200,
        body: '',
      });
    }

    switch (httpMethod) {
      case 'POST':
        result = await createSchedule(JSON.parse(body || '{}'));
        metrics.addMetric('ScheduleCreated', MetricUnit.Count, 1);
        break;
      case 'GET':
        if (scheduleId) {
          result = await getSchedule(scheduleId);
          metrics.addMetric('ScheduleRetrieved', MetricUnit.Count, 1);
        } else {
          result = await listSchedules(queryStringParameters);
          metrics.addMetric('SchedulesListed', MetricUnit.Count, 1);
        }
        break;
      case 'PUT':
        result = await updateSchedule(scheduleId!, JSON.parse(body || '{}'));
        metrics.addMetric('ScheduleUpdated', MetricUnit.Count, 1);
        break;
      case 'DELETE':
        result = await deleteSchedule(scheduleId!);
        metrics.addMetric('ScheduleDeleted', MetricUnit.Count, 1);
        break;
      default:
        result = {
          statusCode: 405,
          body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }

    // Publish metrics
    metrics.publishStoredMetrics();

    return addCorsHeaders(result);
  } catch (error) {
    logger.error('Error processing request', error as Error);
    metrics.addMetric('ScheduleError', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();

    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    });
  }
};

async function createSchedule(data: unknown): Promise<APIGatewayProxyResult> {
  // Validate input
  const validation = validateScheduleRequest(data);
  if (!validation.valid) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Validation failed',
        errors: validation.errors,
      }),
    };
  }

  const validatedData = validation.data!;

  // Get index configuration
  const dbConfig = getDynamoDBConfig();

  // Check if a schedule already exists for this contentId
  const existingSchedules = await docClient.send(
    new QueryCommand({
      TableName: dbConfig.tableName,
      IndexName: dbConfig.indexes.content.name,
      KeyConditionExpression: `${dbConfig.indexes.content.partitionKey} = :contentId`,
      ExpressionAttributeValues: {
        ':contentId': validatedData.contentId,
      },
      Limit: 1, // We only need to know if one exists
    })
  );

  if (existingSchedules.Items && existingSchedules.Items.length > 0) {
    const existingSchedule = existingSchedules.Items[0];
    logger.info('Found existing schedule for contentId, updating instead of creating new', {
      existingScheduleId: existingSchedule.scheduleId,
      existingStatus: existingSchedule.status,
      contentId: validatedData.contentId,
    });

    // Update the existing schedule instead of creating a new one
    return updateSchedule(existingSchedule.scheduleId, data as Record<string, unknown>);
  }

  // Validate required fields before any operations
  if (!validatedData.brandId || !validatedData.userId || !validatedData.contentId) {
    logger.error('Missing required fields for schedule creation', {
      brandId: validatedData.brandId,
      userId: validatedData.userId,
      contentId: validatedData.contentId,
    });
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Missing required fields',
        missing: {
          brandId: !validatedData.brandId,
          userId: !validatedData.userId,
          contentId: !validatedData.contentId,
        },
      }),
    };
  }

  // Generate hexadecimal-only schedule ID for AWS EventBridge compatibility
  // EventBridge Scheduler requires schedule names to contain only hexadecimal digits
  const timestamp = Date.now().toString(16).toUpperCase(); // Convert to hex
  const randomHex = randomUUID().replace(/-/g, '').toUpperCase(); // Remove hyphens, ensure uppercase hex
  let scheduleId = `${timestamp}${randomHex}`;
  const scheduledAt = new Date(validatedData.scheduledAt).toISOString();

  // Format date for EventBridge Scheduler
  const eventBridgeScheduleTime = formatEventBridgeScheduleTime(validatedData.scheduledAt);

  logger.info('Creating new schedule (no existing schedule found)', {
    scheduleId,
    scheduledAt,
    eventBridgeScheduleTime,
    brandId: validatedData.brandId,
    contentId: validatedData.contentId,
    userId: validatedData.userId,
  });

  // Prepare the DynamoDB item with guaranteed non-null values
  const scheduleItem = {
    pk: `SCHEDULE#${scheduleId}`,
    sk: 'METADATA',
    scheduleId,
    brandId: validatedData.brandId,
    contentId: validatedData.contentId,
    userId: validatedData.userId, // Ensure userId is always present
    platform: validatedData.platform,
    scheduledAt,
    status: SCHEDULE_STATUS.SCHEDULED,
    contentType: validatedData.contentType || 'image',
    videoUrl: validatedData.videoUrl || '',
    // Ensure content fields always have values (not undefined)
    caption: validatedData.caption || '',
    hashtags: validatedData.hashtags || [],
    mediaUrls: validatedData.mediaUrls || [],
    gsi1pk: `BRAND#${validatedData.brandId}`,
    gsi1sk: scheduledAt,
    ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days
    createdAt: new Date().toISOString(),
  };

  // Store in DynamoDB first - with conditional put to ensure uniqueness
  try {
    await docClient.send(
      new PutCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Item: scheduleItem,
        ConditionExpression: 'attribute_not_exists(pk)', // Ensure schedule doesn't already exist
      })
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      logger.warn('Schedule already exists with this ID, likely a race condition', { scheduleId });
      // Generate a new hex-only ID and retry once
      const retryTimestamp = Date.now().toString(16).toUpperCase();
      const retryRandomHex = randomUUID().replace(/-/g, '').toUpperCase();
      const newScheduleId = `${retryTimestamp}${retryRandomHex}`;
      scheduleItem.pk = `SCHEDULE#${newScheduleId}`;
      scheduleItem.scheduleId = newScheduleId;

      await docClient.send(
        new PutCommand({
          TableName: process.env.SCHEDULES_TABLE!,
          Item: scheduleItem,
          ConditionExpression: 'attribute_not_exists(pk)', // Ensure uniqueness on retry
        })
      );

      // Update scheduleId for EventBridge creation
      scheduleId = newScheduleId;
    } else {
      throw error;
    }
  }

  // Create EventBridge schedule - with rollback on failure
  try {
    await schedulerClient.send(
      new CreateScheduleCommand({
        Name: scheduleId, // Use hex-only schedule ID directly for EventBridge compatibility
        GroupName: process.env.SCHEDULER_GROUP_NAME,
        ScheduleExpression: `at(${eventBridgeScheduleTime})`,
        Target: {
          Arn: process.env.PUBLISHER_LAMBDA_ARN,
          RoleArn: process.env.SCHEDULER_ROLE_ARN,
          Input: JSON.stringify({ scheduleId }),
        },
        FlexibleTimeWindow: {
          Mode: 'OFF',
        },
        Description: `Content publishing schedule for ${scheduleId}`,
      })
    );

    logger.info('EventBridge schedule created successfully', {
      scheduleId,
      scheduleExpression: `at(${eventBridgeScheduleTime})`,
      groupName: process.env.SCHEDULER_GROUP_NAME,
    });
  } catch (error) {
    logger.error('Failed to create EventBridge schedule, rolling back DynamoDB entry', {
      error,
      scheduleId,
      scheduleExpression: `at(${eventBridgeScheduleTime})`,
      groupName: process.env.SCHEDULER_GROUP_NAME,
    });

    // Rollback: Delete the DynamoDB entry since EventBridge schedule failed
    try {
      await docClient.send(
        new DeleteCommand({
          TableName: process.env.SCHEDULES_TABLE!,
          Key: {
            pk: `SCHEDULE#${scheduleId}`,
            sk: 'METADATA',
          },
        })
      );
      logger.info('Successfully rolled back DynamoDB entry', { scheduleId });
    } catch (rollbackError) {
      logger.error('Failed to rollback DynamoDB entry', {
        scheduleId,
        originalError: error,
        rollbackError,
      });
      // Continue to throw original error even if rollback fails
    }

    throw error;
  }

  logger.info('Schedule created successfully', { scheduleId });

  // Publish EventBridge event to notify status-sync Lambda
  await publishScheduleEvent('schedule.created', {
    scheduleId,
    contentId: validatedData.contentId,
    brandId: validatedData.brandId,
    scheduledAt,
  });

  // Return complete schedule object that matches client expectations
  const scheduleResponse = {
    scheduleId,
    contentId: validatedData.contentId,
    brandId: validatedData.brandId,
    userId: validatedData.userId,
    platform: validatedData.platform,
    scheduledAt,
    contentType: validatedData.contentType || 'image',
    videoUrl: validatedData.videoUrl,
    caption: validatedData.caption,
    hashtags: validatedData.hashtags,
    mediaUrls: validatedData.mediaUrls,
    status: SCHEDULE_STATUS.SCHEDULED,
    retryCount: 0,
    metadata: validatedData.metadata,
    createdAt: new Date().toISOString(),
  };

  return {
    statusCode: 201,
    body: JSON.stringify(scheduleResponse),
  };
}

async function getSchedule(scheduleId: string): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(
    new GetCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      Key: {
        pk: `SCHEDULE#${scheduleId}`,
        sk: 'METADATA',
      },
    })
  );

  if (!result.Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Schedule not found' }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(result.Item),
  };
}

async function listSchedules(
  queryParams: { [key: string]: string | undefined } | null
): Promise<APIGatewayProxyResult> {
  const brandId = queryParams?.brandId;
  const status = queryParams?.status || SCHEDULE_STATUS.SCHEDULED;
  const limit = parseInt(queryParams?.limit || '50');

  logger.info('Listing schedules', { brandId, status, limit });

  try {
    const dbConfig = getDynamoDBConfig();

    // Query schedules by brand if brandId provided
    if (brandId) {
      const brandIndex = dbConfig.indexes.brand;
      logger.info('Using brand index for query', {
        indexName: brandIndex.name,
        partitionKey: brandIndex.partitionKey,
        brandId,
      });

      const result = await docClient.send(
        new QueryCommand({
          TableName: dbConfig.tableName,
          IndexName: brandIndex.name,
          KeyConditionExpression: `${brandIndex.partitionKey} = :brandId`,
          FilterExpression: '#status = :status',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':brandId': `BRAND#${brandId}`,
            ':status': status,
          },
          Limit: limit,
        })
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          schedules: result.Items || [],
          lastEvaluatedKey: result.LastEvaluatedKey,
        }),
      };
    }

    // Scan all schedules if no brandId
    const result = await docClient.send(
      new ScanCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        FilterExpression: '#status = :status AND sk = :sk',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':sk': 'METADATA',
        },
        Limit: limit,
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        schedules: result.Items || [],
        lastEvaluatedKey: result.LastEvaluatedKey,
      }),
    };
  } catch (error) {
    logger.error('Error listing schedules', error as Error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to list schedules' }),
    };
  }
}

async function updateSchedule(
  scheduleId: string,
  data: Record<string, unknown>
): Promise<APIGatewayProxyResult> {
  try {
    // First, get the existing schedule
    const existingSchedule = await docClient.send(
      new GetCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: {
          pk: `SCHEDULE#${scheduleId}`,
          sk: 'METADATA',
        },
      })
    );

    if (!existingSchedule.Item) {
      // Schedule doesn't exist - create it instead (upsert pattern for resilience)
      logger.warn('Schedule not found during update, creating new schedule', {
        scheduleId,
        reason: 'Data inconsistency recovery - schedule missing from DynamoDB',
      });

      // Validate the data has required fields for creation
      const validation = validateScheduleRequest(data);
      if (!validation.valid) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: 'Cannot create schedule - missing required fields',
            validationErrors: validation.errors,
          }),
        };
      }

      // Create the schedule (reuse creation logic)
      return createSchedule(data);
    }

    // Update the schedule data, preserving content fields
    const baseItem = existingSchedule.Item as ScheduleItem;
    const partial = data as Partial<ScheduleItem>;
    const updatedItem: ScheduleItem = {
      ...baseItem,
      ...partial,
      caption: partial.caption !== undefined ? String(partial.caption) : baseItem.caption,
      hashtags: partial.hashtags !== undefined ? (partial.hashtags as string[]) : baseItem.hashtags,
      mediaUrls:
        partial.mediaUrls !== undefined ? (partial.mediaUrls as string[]) : baseItem.mediaUrls,
      userId: partial.userId !== undefined ? String(partial.userId) : baseItem.userId,
      updatedAt: new Date().toISOString(),
    };

    logger.info('Updating existing schedule', {
      scheduleId,
      hasContentUpdates: !!(data.caption || data.hashtags || data.mediaUrls),
    });

    // If scheduledAt changed, we need to update EventBridge
    if (partial.scheduledAt && partial.scheduledAt !== baseItem.scheduledAt) {
      const newScheduledAt = new Date(partial.scheduledAt).toISOString();
      // Format date for EventBridge Scheduler
      const eventBridgeScheduleTime = formatEventBridgeScheduleTime(partial.scheduledAt);

      logger.info('Updating schedule time', {
        scheduleId,
        oldTime: existingSchedule.Item.scheduledAt,
        newTime: newScheduledAt,
        eventBridgeTime: eventBridgeScheduleTime,
      });

      // Delete old EventBridge schedule
      try {
        await schedulerClient.send(
          new DeleteScheduleCommand({
            Name: scheduleId, // Use hex-only schedule ID directly for EventBridge compatibility
            GroupName: process.env.SCHEDULER_GROUP_NAME,
          })
        );
      } catch {
        logger.warn('Could not delete old schedule, it may not exist', {
          scheduleId,
        });
      }

      // Create new EventBridge schedule
      await schedulerClient.send(
        new CreateScheduleCommand({
          Name: scheduleId, // Use hex-only schedule ID directly for EventBridge compatibility
          GroupName: process.env.SCHEDULER_GROUP_NAME,
          ScheduleExpression: `at(${eventBridgeScheduleTime})`,
          Target: {
            Arn: process.env.PUBLISHER_LAMBDA_ARN,
            RoleArn: process.env.SCHEDULER_ROLE_ARN,
            Input: JSON.stringify({ scheduleId }),
          },
          FlexibleTimeWindow: {
            Mode: 'OFF',
          },
          Description: `Updated content publishing schedule for ${scheduleId}`,
        })
      );

      updatedItem.scheduledAt = newScheduledAt;
      updatedItem.gsi1sk = newScheduledAt;
    }

    // Update in DynamoDB
    await docClient.send(
      new PutCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Item: updatedItem,
      })
    );

    logger.info('Schedule updated successfully', { scheduleId });

    // Publish EventBridge event to notify status-sync Lambda
    await publishScheduleEvent('schedule.updated', {
      scheduleId,
      contentId: updatedItem.contentId,
      brandId: updatedItem.brandId,
      scheduledAt: updatedItem.scheduledAt,
      updates: partial.scheduledAt ? { scheduledAt: updatedItem.scheduledAt } : undefined,
    });

    // Return complete schedule object that matches client expectations
    const scheduleResponse = {
      scheduleId: updatedItem.scheduleId,
      contentId: updatedItem.contentId,
      brandId: updatedItem.brandId,
      userId: updatedItem.userId,
      platform: updatedItem.platform,
      scheduledAt: updatedItem.scheduledAt,
      contentType: updatedItem.contentType,
      videoUrl: updatedItem.videoUrl,
      caption: updatedItem.caption,
      hashtags: updatedItem.hashtags,
      mediaUrls: updatedItem.mediaUrls,
      status: updatedItem.status,
      retryCount: updatedItem.retryCount || 0,
      metadata: updatedItem.metadata,
      createdAt: updatedItem.createdAt,
      updatedAt: updatedItem.updatedAt,
      publishedAt: updatedItem.publishedAt,
      errorMessage: updatedItem.errorMessage,
    };

    return {
      statusCode: 200,
      body: JSON.stringify(scheduleResponse),
    };
  } catch (error) {
    logger.error('Error updating schedule', error as Error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to update schedule',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

async function deleteSchedule(scheduleId: string): Promise<APIGatewayProxyResult> {
  // Get the schedule first to extract contentId for the event
  const existingSchedule = await docClient.send(
    new GetCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      Key: {
        pk: `SCHEDULE#${scheduleId}`,
        sk: 'METADATA',
      },
    })
  );

  // Delete from DynamoDB
  await docClient.send(
    new DeleteCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      Key: {
        pk: `SCHEDULE#${scheduleId}`,
        sk: 'METADATA',
      },
    })
  );

  // Delete EventBridge schedule
  await schedulerClient.send(
    new DeleteScheduleCommand({
      Name: scheduleId, // Use hex-only schedule ID directly for EventBridge compatibility
      GroupName: process.env.SCHEDULER_GROUP_NAME,
    })
  );

  logger.info('Schedule deleted successfully', { scheduleId });

  // Publish EventBridge event to notify status-sync Lambda
  if (existingSchedule.Item) {
    await publishScheduleEvent('schedule.canceled', {
      scheduleId,
      contentId: existingSchedule.Item.contentId,
      brandId: existingSchedule.Item.brandId,
    });
  }

  return {
    statusCode: 204,
    body: '',
  };
}
