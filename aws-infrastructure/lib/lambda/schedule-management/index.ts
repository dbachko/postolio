import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { getDynamoDBConfig, SCHEDULE_STATUS, formatEventBridgeScheduleTime } from './config';

// Initialize Powertools
const logger = new Logger({ serviceName: 'schedule-management' });
const tracer = new Tracer({ serviceName: 'schedule-management' });
const metrics = new Metrics({ namespace: 'ContentScheduler', serviceName: 'schedule-management' });

// Initialize AWS SDK clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);
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
  const scheduleId = `SCH_${Date.now()}_${randomUUID()}`;
  const scheduledAt = new Date(validatedData.scheduledAt).toISOString();
  
  // Format date for EventBridge Scheduler
  const eventBridgeScheduleTime = formatEventBridgeScheduleTime(validatedData.scheduledAt);
  
  logger.info('Creating schedule', { 
    scheduleId, 
    scheduledAt, 
    eventBridgeScheduleTime,
    brandId: validatedData.brandId,
    contentId: validatedData.contentId 
  });

  // Store in DynamoDB first
  await docClient.send(new PutCommand({
    TableName: process.env.SCHEDULES_TABLE!,
    Item: {
      pk: `SCHEDULE#${scheduleId}`,
      sk: 'METADATA',
      scheduleId,
      brandId: validatedData.brandId,
      contentId: validatedData.contentId,
      platform: validatedData.platform,
      scheduledAt,
      status: SCHEDULE_STATUS.SCHEDULED,
      contentType: validatedData.contentType || 'image',
      videoUrl: validatedData.videoUrl,
      caption: validatedData.caption,
      hashtags: validatedData.hashtags,
      mediaUrls: validatedData.mediaUrls,
      userId: validatedData.userId,
      gsi1pk: `BRAND#${validatedData.brandId}`,
      gsi1sk: scheduledAt,
      ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days
      createdAt: new Date().toISOString(),
    },
  }));

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

  return {
    statusCode: 201,
    body: JSON.stringify({ scheduleId, message: 'Schedule created successfully' }),
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
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Schedule not found' }),
      };
    }
    
    // Update the schedule data
    const updatedItem = {
      ...existingSchedule.Item,
      ...data,
      updatedAt: new Date().toISOString(),
    };
    
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
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        scheduleId,
        message: 'Schedule updated successfully',
        data: updatedItem,
      }),
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