import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
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
const metrics = new Metrics({ namespace: 'ContentScheduler', serviceName: 'schedule-management' });

// Initialize AWS SDK clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: false, // Keep undefined values as empty to ensure all fields are stored
    convertEmptyValues: true,     // Convert empty strings/arrays to DynamoDB empty values
  }
});
const schedulerClient = tracer.captureAWSv3Client(new SchedulerClient({}));

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
}

// Input validation helper
function validateScheduleRequest(data: any): { valid: boolean; errors?: string[]; data?: ScheduleRequest } {
  const errors: string[] = [];
  
  // Required fields
  if (!data.brandId) errors.push('brandId is required');
  if (!data.contentId) errors.push('contentId is required');
  if (!data.platform) errors.push('platform is required');
  if (!data.scheduledAt) errors.push('scheduledAt is required');
  
  // Platform validation
  const validPlatforms = ['instagram', 'facebook', 'twitter', 'linkedin', 'youtube'];
  if (data.platform && !validPlatforms.includes(data.platform)) {
    errors.push(`platform must be one of: ${validPlatforms.join(', ')}`);
  }
  
  // Date validation
  if (data.scheduledAt) {
    const scheduledDate = new Date(data.scheduledAt);
    const now = new Date();
    if (isNaN(scheduledDate.getTime())) {
      errors.push('scheduledAt must be a valid ISO 8601 date string');
    } else if (scheduledDate <= now) {
      errors.push('scheduledAt must be in the future');
    }
  }
  
  // Content type validation
  const validContentTypes = ['image', 'video', 'carousel', 'reel', 'story'];
  if (data.contentType && !validContentTypes.includes(data.contentType)) {
    errors.push(`contentType must be one of: ${validContentTypes.join(', ')}`);
  }
  
  // Video URL required for video content types
  if (['video', 'reel'].includes(data.contentType) && !data.videoUrl) {
    errors.push('videoUrl is required for video content');
  }
  
  // Caption length validation (platform-specific)
  if (data.caption) {
    const maxLengths: Record<string, number> = {
      instagram: 2200,
      facebook: 63206,
      twitter: 280,
      linkedin: 3000,
      youtube: 5000,
    };
    const maxLength = maxLengths[data.platform] || 2200;
    if (data.caption.length > maxLength) {
      errors.push(`caption exceeds maximum length of ${maxLength} characters for ${data.platform}`);
    }
  }
  
  // Hashtag validation
  if (data.hashtags) {
    if (!Array.isArray(data.hashtags)) {
      errors.push('hashtags must be an array');
    } else if (data.hashtags.length > 30) {
      errors.push('maximum 30 hashtags allowed');
    }
  }
  
  return errors.length > 0 
    ? { valid: false, errors }
    : { valid: true, data: data as ScheduleRequest };
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

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Add context to logs
  logger.addPersistentLogAttributes({
    requestId: event.requestContext.requestId,
    method: event.httpMethod,
    path: event.path,
  });

  logger.info('Processing request', { event });

  try {
    const { httpMethod, path, body, pathParameters } = event;
    const scheduleId = pathParameters?.scheduleId;

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
          result = await listSchedules(event.queryStringParameters);
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

async function createSchedule(data: any): Promise<APIGatewayProxyResult> {
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
  const existingSchedules = await docClient.send(new QueryCommand({
    TableName: dbConfig.tableName,
    IndexName: dbConfig.indexes.content.name,
    KeyConditionExpression: `${dbConfig.indexes.content.partitionKey} = :contentId`,
    ExpressionAttributeValues: {
      ':contentId': validatedData.contentId,
    },
    Limit: 1, // We only need to know if one exists
  }));
  
  if (existingSchedules.Items && existingSchedules.Items.length > 0) {
    const existingSchedule = existingSchedules.Items[0];
    logger.info('Found existing schedule for contentId, updating instead of creating new', { 
      existingScheduleId: existingSchedule.scheduleId,
      existingStatus: existingSchedule.status,
      contentId: validatedData.contentId 
    });
    
    // Update the existing schedule instead of creating a new one
    return updateSchedule(existingSchedule.scheduleId, data);
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
        }
      }),
    };
  }

  let scheduleId = `SCH_${Date.now()}_${randomUUID()}`;
  const scheduledAt = new Date(validatedData.scheduledAt).toISOString();
  
  // Format date for EventBridge Scheduler
  const eventBridgeScheduleTime = formatEventBridgeScheduleTime(validatedData.scheduledAt);
  
  logger.info('Creating new schedule (no existing schedule found)', { 
    scheduleId, 
    scheduledAt, 
    eventBridgeScheduleTime,
    brandId: validatedData.brandId,
    contentId: validatedData.contentId,
    userId: validatedData.userId
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
    ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days
    createdAt: new Date().toISOString(),
  };

  // Store in DynamoDB first - with conditional put to ensure uniqueness
  try {
    await docClient.send(new PutCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      Item: scheduleItem,
      ConditionExpression: 'attribute_not_exists(pk)', // Ensure schedule doesn't already exist
    }));
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      logger.warn('Schedule already exists with this ID, likely a race condition', { scheduleId });
      // Generate a new ID and retry once
      const newScheduleId = `SCH_${Date.now()}_${randomUUID()}`;
      scheduleItem.pk = `SCHEDULE#${newScheduleId}`;
      scheduleItem.scheduleId = newScheduleId;
      
      await docClient.send(new PutCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Item: scheduleItem,
      }));
      
      // Update scheduleId for EventBridge creation
      scheduleId = newScheduleId;
    } else {
      throw error;
    }
  }

  // Create EventBridge schedule - with rollback on failure
  try {
    await schedulerClient.send(new CreateScheduleCommand({
      Name: `schedule-${scheduleId}`,
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
    }));
    
    logger.info('EventBridge schedule created successfully', { 
      scheduleId, 
      scheduleExpression: `at(${eventBridgeScheduleTime})`,
      groupName: process.env.SCHEDULER_GROUP_NAME
    });
  } catch (error) {
    logger.error('Failed to create EventBridge schedule, rolling back DynamoDB entry', {
      error,
      scheduleId,
      scheduleExpression: `at(${eventBridgeScheduleTime})`,
      groupName: process.env.SCHEDULER_GROUP_NAME
    });
    
    // Rollback: Delete the DynamoDB entry since EventBridge schedule failed
    try {
      await docClient.send(new DeleteCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: {
          pk: `SCHEDULE#${scheduleId}`,
          sk: 'METADATA',
        },
      }));
      logger.info('Successfully rolled back DynamoDB entry', { scheduleId });
    } catch (rollbackError) {
      logger.error('Failed to rollback DynamoDB entry', { 
        scheduleId, 
        originalError: error,
        rollbackError 
      });
      // Continue to throw original error even if rollback fails
    }
    
    throw error;
  }

  logger.info('Schedule created successfully', { scheduleId });

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
  const result = await docClient.send(new GetCommand({
    TableName: process.env.SCHEDULES_TABLE!,
    Key: {
      pk: `SCHEDULE#${scheduleId}`,
      sk: 'METADATA',
    },
  }));

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

async function listSchedules(queryParams: any): Promise<APIGatewayProxyResult> {
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
        brandId 
      });
      
      const result = await docClient.send(new QueryCommand({
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
      }));
      
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          schedules: result.Items || [],
          lastEvaluatedKey: result.LastEvaluatedKey,
        }),
      };
    }
    
    // Scan all schedules if no brandId
    const result = await docClient.send(new ScanCommand({
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
    }));
    
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

async function updateSchedule(scheduleId: string, data: any): Promise<APIGatewayProxyResult> {
  try {
    // First, get the existing schedule
    const existingSchedule = await docClient.send(new GetCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      Key: {
        pk: `SCHEDULE#${scheduleId}`,
        sk: 'METADATA',
      },
    }));
    
    if (!existingSchedule.Item) {
      // Schedule doesn't exist - create it instead (upsert pattern for resilience)
      logger.warn('Schedule not found during update, creating new schedule', { 
        scheduleId,
        reason: 'Data inconsistency recovery - schedule missing from DynamoDB'
      });
      
      // Validate the data has required fields for creation
      const validation = validateScheduleRequest(data);
      if (!validation.valid) {
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            error: 'Cannot create schedule - missing required fields',
            validationErrors: validation.errors 
          }),
        };
      }
      
      // Create the schedule (reuse creation logic)
      return createSchedule(data);
    }
    
    // Update the schedule data, preserving content fields
    const updatedItem = {
      ...existingSchedule.Item,
      ...data,
      // Ensure content fields are preserved or updated
      caption: data.caption !== undefined ? data.caption : existingSchedule.Item.caption,
      hashtags: data.hashtags !== undefined ? data.hashtags : existingSchedule.Item.hashtags,
      mediaUrls: data.mediaUrls !== undefined ? data.mediaUrls : existingSchedule.Item.mediaUrls,
      userId: data.userId !== undefined ? data.userId : existingSchedule.Item.userId, // Preserve userId
      updatedAt: new Date().toISOString(),
    };
    
    logger.info('Updating existing schedule', { 
      scheduleId,
      hasContentUpdates: !!(data.caption || data.hashtags || data.mediaUrls)
    });
    
    // If scheduledAt changed, we need to update EventBridge
    if (data.scheduledAt && data.scheduledAt !== existingSchedule.Item.scheduledAt) {
      const newScheduledAt = new Date(data.scheduledAt).toISOString();
      // Format date for EventBridge Scheduler
      const eventBridgeScheduleTime = formatEventBridgeScheduleTime(data.scheduledAt);
      
      logger.info('Updating schedule time', { 
        scheduleId, 
        oldTime: existingSchedule.Item.scheduledAt,
        newTime: newScheduledAt,
        eventBridgeTime: eventBridgeScheduleTime
      });
      
      // Delete old EventBridge schedule
      try {
        await schedulerClient.send(new DeleteScheduleCommand({
          Name: `schedule-${scheduleId}`,
          GroupName: process.env.SCHEDULER_GROUP_NAME,
        }));
      } catch (err) {
        logger.warn('Could not delete old schedule, it may not exist', { scheduleId });
      }
      
      // Create new EventBridge schedule
      await schedulerClient.send(new CreateScheduleCommand({
        Name: `schedule-${scheduleId}`,
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
      }));
      
      updatedItem.scheduledAt = newScheduledAt;
      updatedItem.gsi1sk = newScheduledAt;
    }
    
    // Update in DynamoDB
    await docClient.send(new PutCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      Item: updatedItem,
    }));
    
    logger.info('Schedule updated successfully', { scheduleId });
    
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
  // Delete from DynamoDB
  await docClient.send(new DeleteCommand({
    TableName: process.env.SCHEDULES_TABLE!,
    Key: {
      pk: `SCHEDULE#${scheduleId}`,
      sk: 'METADATA',
    },
  }));

  // Delete EventBridge schedule
  await schedulerClient.send(new DeleteScheduleCommand({
    Name: `schedule-${scheduleId}`,
    GroupName: process.env.SCHEDULER_GROUP_NAME,
  }));

  logger.info('Schedule deleted successfully', { scheduleId });

  return {
    statusCode: 204,
    body: '',
  };
}