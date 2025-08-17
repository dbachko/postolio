import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnits } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Initialize Powertools
const logger = new Logger({ serviceName: 'publisher' });
const tracer = new Tracer({ serviceName: 'publisher' });
const metrics = new Metrics({ namespace: 'ContentScheduler', serviceName: 'publisher' });

// Initialize AWS SDK clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const secretsClient = tracer.captureAWSv3Client(new SecretsManagerClient({}));
const s3Client = tracer.captureAWSv3Client(new S3Client({}));

interface PublishEvent {
  scheduleId: string;
}

export const handler = async (event: PublishEvent): Promise<void> => {
  logger.info('Publishing content', { scheduleId: event.scheduleId });

  try {
    // Get schedule details from DynamoDB
    const schedule = await getSchedule(event.scheduleId);
    if (!schedule) {
      throw new Error(`Schedule not found: ${event.scheduleId}`);
    }

    // Get platform credentials
    const credentials = await getPlatformCredentials(schedule.platform);

    // If video content, get signed URL
    let mediaUrl = null;
    if (schedule.contentType === 'video' && schedule.videoUrl) {
      mediaUrl = await getSignedVideoUrl(schedule.videoUrl);
    }

    // Publish to platform
    await publishToPlatform(schedule, credentials, mediaUrl);

    // Update schedule status
    await updateScheduleStatus(event.scheduleId, 'published');

    metrics.addMetric('ContentPublished', MetricUnits.Count, 1);
    metrics.addMetric(`ContentPublished_${schedule.platform}`, MetricUnits.Count, 1);
    
    logger.info('Content published successfully', { 
      scheduleId: event.scheduleId,
      platform: schedule.platform 
    });
  } catch (error) {
    logger.error('Failed to publish content', error as Error);
    metrics.addMetric('PublishingError', MetricUnits.Count, 1);
    
    // Update schedule status to failed
    await updateScheduleStatus(event.scheduleId, 'failed', (error as Error).message);
    
    throw error;
  } finally {
    metrics.publishStoredMetrics();
  }
};

async function getSchedule(scheduleId: string): Promise<any> {
  const result = await docClient.send(new GetCommand({
    TableName: process.env.SCHEDULES_TABLE!,
    Key: {
      pk: `SCHEDULE#${scheduleId}`,
      sk: 'METADATA',
    },
  }));

  return result.Item;
}

async function getPlatformCredentials(platform: string): Promise<any> {
  const result = await secretsClient.send(new GetSecretValueCommand({
    SecretId: process.env.PLATFORM_CREDENTIALS_SECRET!,
  }));

  const credentials = JSON.parse(result.SecretString!);
  return credentials[platform];
}

async function getSignedVideoUrl(videoKey: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.VIDEO_BUCKET!,
    Key: videoKey,
  });

  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

async function publishToPlatform(
  schedule: any,
  credentials: any,
  mediaUrl: string | null
): Promise<void> {
  // Call main application API to publish content
  const response = await fetch(`${process.env.MAIN_APP_API_URL}/api/instagram/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': process.env.INTERNAL_API_SECRET || '',
    },
    body: JSON.stringify({
      brandId: schedule.brandId,
      contentId: schedule.contentId,
      caption: schedule.caption,
      hashtags: schedule.hashtags,
      mediaUrl: mediaUrl || schedule.imageUrl,
      platform: schedule.platform,
      credentials,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Platform API error: ${error}`);
  }
}

async function updateScheduleStatus(
  scheduleId: string,
  status: string,
  errorMessage?: string
): Promise<void> {
  const updateExpression = errorMessage
    ? 'SET #status = :status, #error = :error, #updatedAt = :updatedAt'
    : 'SET #status = :status, #updatedAt = :updatedAt, #publishedAt = :publishedAt';

  const expressionAttributeNames: any = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
  };

  const expressionAttributeValues: any = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  };

  if (errorMessage) {
    expressionAttributeNames['#error'] = 'schedulingError';
    expressionAttributeValues[':error'] = errorMessage;
  } else {
    expressionAttributeNames['#publishedAt'] = 'publishedAt';
    expressionAttributeValues[':publishedAt'] = new Date().toISOString();
  }

  await docClient.send(new UpdateCommand({
    TableName: process.env.SCHEDULES_TABLE!,
    Key: {
      pk: `SCHEDULE#${scheduleId}`,
      sk: 'METADATA',
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}