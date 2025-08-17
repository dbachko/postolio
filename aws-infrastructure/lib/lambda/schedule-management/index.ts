import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnits } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'crypto';

// Initialize Powertools
const logger = new Logger({ serviceName: 'schedule-management' });
const tracer = new Tracer({ serviceName: 'schedule-management' });
const metrics = new Metrics({ namespace: 'ContentScheduler', serviceName: 'schedule-management' });

// Initialize AWS SDK clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const schedulerClient = tracer.captureAWSv3Client(new SchedulerClient({}));

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Add context to logs
  logger.addContext({
    requestId: event.requestContext.requestId,
    method: event.httpMethod,
    path: event.path,
  });

  logger.info('Processing request', { event });

  try {
    const { httpMethod, path, body, pathParameters } = event;
    const scheduleId = pathParameters?.scheduleId;

    let result: APIGatewayProxyResult;

    switch (httpMethod) {
      case 'POST':
        result = await createSchedule(JSON.parse(body || '{}'));
        metrics.addMetric('ScheduleCreated', MetricUnits.Count, 1);
        break;
      case 'GET':
        if (scheduleId) {
          result = await getSchedule(scheduleId);
          metrics.addMetric('ScheduleRetrieved', MetricUnits.Count, 1);
        } else {
          result = await listSchedules(event.queryStringParameters);
          metrics.addMetric('SchedulesListed', MetricUnits.Count, 1);
        }
        break;
      case 'PUT':
        result = await updateSchedule(scheduleId!, JSON.parse(body || '{}'));
        metrics.addMetric('ScheduleUpdated', MetricUnits.Count, 1);
        break;
      case 'DELETE':
        result = await deleteSchedule(scheduleId!);
        metrics.addMetric('ScheduleDeleted', MetricUnits.Count, 1);
        break;
      default:
        result = {
          statusCode: 405,
          body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }

    // Publish metrics
    metrics.publishStoredMetrics();

    return result;
  } catch (error) {
    logger.error('Error processing request', error as Error);
    metrics.addMetric('ScheduleError', MetricUnits.Count, 1);
    metrics.publishStoredMetrics();

    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

async function createSchedule(data: any): Promise<APIGatewayProxyResult> {
  const scheduleId = `SCH_${Date.now()}_${randomUUID()}`;
  const scheduledAt = new Date(data.scheduledAt).toISOString();

  // Store in DynamoDB
  await docClient.send(new PutCommand({
    TableName: process.env.SCHEDULES_TABLE!,
    Item: {
      pk: `SCHEDULE#${scheduleId}`,
      sk: 'METADATA',
      scheduleId,
      brandId: data.brandId,
      contentId: data.contentId,
      platform: data.platform,
      scheduledAt,
      status: 'scheduled',
      contentType: data.contentType || 'image',
      videoUrl: data.videoUrl,
      caption: data.caption,
      hashtags: data.hashtags,
      gsi1pk: `BRAND#${data.brandId}`,
      gsi1sk: scheduledAt,
      ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days
      createdAt: new Date().toISOString(),
    },
  }));

  // Create EventBridge schedule
  await schedulerClient.send(new CreateScheduleCommand({
    Name: `schedule-${scheduleId}`,
    GroupName: process.env.SCHEDULER_GROUP_NAME,
    ScheduleExpression: `at(${scheduledAt})`,
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
  // Implementation for listing schedules
  return {
    statusCode: 200,
    body: JSON.stringify({ schedules: [] }),
  };
}

async function updateSchedule(scheduleId: string, data: any): Promise<APIGatewayProxyResult> {
  // Implementation for updating schedule
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Schedule updated' }),
  };
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