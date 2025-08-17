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

interface PlatformAdapter {
  publish(schedule: any, credentials: any, mediaUrl: string | null): Promise<PublishResult>;
  validateCredentials(credentials: any): boolean;
  formatContent(schedule: any): any;
}

interface PublishResult {
  success: boolean;
  platformPostId?: string;
  platformUrl?: string;
  error?: string;
}

// Platform adapter factory
class PlatformAdapterFactory {
  static getAdapter(platform: string): PlatformAdapter {
    switch (platform) {
      case 'instagram':
        return new InstagramAdapter();
      case 'facebook':
        return new FacebookAdapter();
      case 'twitter':
        return new TwitterAdapter();
      case 'linkedin':
        return new LinkedInAdapter();
      case 'youtube':
        return new YouTubeAdapter();
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}

// Instagram adapter implementation
class InstagramAdapter implements PlatformAdapter {
  async publish(schedule: any, credentials: any, mediaUrl: string | null): Promise<PublishResult> {
    try {
      // Instagram-specific publishing logic
      const response = await fetch(`${process.env.MAIN_APP_API_URL}/api/instagram/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': process.env.INTERNAL_API_SECRET || '',
        },
        body: JSON.stringify({
          brandId: schedule.brandId,
          contentId: schedule.contentId,
          caption: this.formatCaption(schedule.caption, schedule.hashtags),
          mediaUrl: mediaUrl || schedule.imageUrl,
          accessToken: credentials.accessToken,
          pageId: credentials.pageId,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Instagram API error: ${error}` };
      }

      const result = await response.json();
      return {
        success: true,
        platformPostId: result.id,
        platformUrl: result.permalink,
      };
    } catch (error) {
      logger.error('Instagram publishing failed', error as Error);
      return { success: false, error: (error as Error).message };
    }
  }

  validateCredentials(credentials: any): boolean {
    return !!(credentials?.accessToken && credentials?.pageId);
  }

  formatContent(schedule: any): any {
    return {
      caption: this.formatCaption(schedule.caption, schedule.hashtags),
      mediaType: schedule.contentType === 'video' ? 'VIDEO' : 'IMAGE',
    };
  }

  private formatCaption(caption: string, hashtags: string[]): string {
    const hashtagString = hashtags?.length ? '\n\n' + hashtags.map(tag => `#${tag}`).join(' ') : '';
    return `${caption}${hashtagString}`.slice(0, 2200); // Instagram caption limit
  }
}

// Facebook adapter (placeholder)
class FacebookAdapter implements PlatformAdapter {
  async publish(schedule: any, credentials: any, mediaUrl: string | null): Promise<PublishResult> {
    // Facebook publishing logic would go here
    return { success: false, error: 'Facebook publishing not yet implemented' };
  }

  validateCredentials(credentials: any): boolean {
    return !!(credentials?.accessToken && credentials?.pageId);
  }

  formatContent(schedule: any): any {
    return { message: schedule.caption };
  }
}

// Twitter adapter (placeholder)
class TwitterAdapter implements PlatformAdapter {
  async publish(schedule: any, credentials: any, mediaUrl: string | null): Promise<PublishResult> {
    // Twitter publishing logic would go here
    return { success: false, error: 'Twitter publishing not yet implemented' };
  }

  validateCredentials(credentials: any): boolean {
    return !!(credentials?.apiKey && credentials?.apiSecret);
  }

  formatContent(schedule: any): any {
    return { text: schedule.caption?.slice(0, 280) }; // Twitter character limit
  }
}

// LinkedIn adapter (placeholder)
class LinkedInAdapter implements PlatformAdapter {
  async publish(schedule: any, credentials: any, mediaUrl: string | null): Promise<PublishResult> {
    // LinkedIn publishing logic would go here
    return { success: false, error: 'LinkedIn publishing not yet implemented' };
  }

  validateCredentials(credentials: any): boolean {
    return !!(credentials?.accessToken);
  }

  formatContent(schedule: any): any {
    return { text: schedule.caption };
  }
}

// YouTube adapter (placeholder)
class YouTubeAdapter implements PlatformAdapter {
  async publish(schedule: any, credentials: any, mediaUrl: string | null): Promise<PublishResult> {
    // YouTube publishing logic would go here
    return { success: false, error: 'YouTube publishing not yet implemented' };
  }

  validateCredentials(credentials: any): boolean {
    return !!(credentials?.apiKey && credentials?.channelId);
  }

  formatContent(schedule: any): any {
    return {
      title: schedule.caption?.split('\n')[0]?.slice(0, 100),
      description: schedule.caption,
    };
  }
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

    // Get platform adapter
    const adapter = PlatformAdapterFactory.getAdapter(schedule.platform);
    
    // Validate credentials
    if (!adapter.validateCredentials(credentials)) {
      throw new Error(`Invalid credentials for platform: ${schedule.platform}`);
    }
    
    // Publish to platform using adapter
    const publishResult = await adapter.publish(schedule, credentials, mediaUrl);
    
    if (!publishResult.success) {
      throw new Error(publishResult.error || 'Publishing failed');
    }
    
    // Update schedule status with platform info
    await updateScheduleStatus(
      event.scheduleId, 
      'published',
      undefined,
      publishResult.platformPostId,
      publishResult.platformUrl
    );

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

// Audit log helper
async function logAudit(
  scheduleId: string,
  action: string,
  result: 'success' | 'failure',
  details?: any
): Promise<void> {
  const { PutCommand: AuditPutCommand } = await import('@aws-sdk/lib-dynamodb');
  
  await docClient.send(new AuditPutCommand({
    TableName: process.env.AUDIT_LOG_TABLE!,
    Item: {
      pk: `AUDIT#${scheduleId}`,
      sk: `${Date.now()}#${action}`,
      scheduleId,
      action,
      result,
      details,
      timestamp: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days
    },
  }));
}

async function updateScheduleStatus(
  scheduleId: string,
  status: string,
  errorMessage?: string,
  platformPostId?: string,
  platformUrl?: string
): Promise<void> {
  let updateExpression = 'SET #status = :status, #updatedAt = :updatedAt';
  
  if (errorMessage) {
    updateExpression += ', #error = :error';
  } else if (status === 'published') {
    updateExpression += ', #publishedAt = :publishedAt';
    if (platformPostId) updateExpression += ', #platformPostId = :platformPostId';
    if (platformUrl) updateExpression += ', #platformUrl = :platformUrl';
  }

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
  } else if (status === 'published') {
    expressionAttributeNames['#publishedAt'] = 'publishedAt';
    expressionAttributeValues[':publishedAt'] = new Date().toISOString();
    
    if (platformPostId) {
      expressionAttributeNames['#platformPostId'] = 'platformPostId';
      expressionAttributeValues[':platformPostId'] = platformPostId;
    }
    
    if (platformUrl) {
      expressionAttributeNames['#platformUrl'] = 'platformUrl';
      expressionAttributeValues[':platformUrl'] = platformUrl;
    }
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
  
  // Log audit
  await logAudit(scheduleId, `status_update_${status}`, 'success', { errorMessage, platformPostId, platformUrl });
}