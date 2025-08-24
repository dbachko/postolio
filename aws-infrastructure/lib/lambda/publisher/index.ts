import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Platform-specific character limits
const PLATFORM_LIMITS = {
  INSTAGRAM_CAPTION: 2200,
  FACEBOOK_POST: 63206,
  TWITTER_TWEET: 280,
  LINKEDIN_POST: 3000,
  YOUTUBE_TITLE: 100,
  YOUTUBE_DESCRIPTION: 5000,
} as const;

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
      if (!mediaUrl) {
        throw new Error('Media URL is required for Instagram publishing');
      }

      const formattedCaption = this.formatCaption(schedule.caption, schedule.hashtags);
      
      // Step 1: Create media container
      const createMediaUrl = `https://graph.facebook.com/v23.0/${credentials.instagramAccountId}/media`;
      const createMediaParams = new URLSearchParams({
        image_url: mediaUrl,
        caption: formattedCaption,
        access_token: credentials.instagramAccessToken,
      });

      logger.info('Creating Instagram media container', { 
        accountId: credentials.instagramAccountId,
        hasMediaUrl: !!mediaUrl 
      });

      const createResponse = await fetch(`${createMediaUrl}?${createMediaParams}`, {
        method: 'POST',
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        logger.error('Failed to create Instagram media container', { 
          status: createResponse.status, 
          error: errorText 
        });
        return { success: false, error: `Failed to create media: ${errorText}` };
      }

      const createResult = await createResponse.json();
      const creationId = createResult.id;

      if (!creationId) {
        return { success: false, error: 'No creation ID returned from Instagram' };
      }

      // Step 2: Publish the media
      const publishUrl = `https://graph.facebook.com/v23.0/${credentials.instagramAccountId}/media_publish`;
      const publishParams = new URLSearchParams({
        creation_id: creationId,
        access_token: credentials.instagramAccessToken,
      });

      logger.info('Publishing Instagram media', { creationId });

      const publishResponse = await fetch(`${publishUrl}?${publishParams}`, {
        method: 'POST',
      });

      if (!publishResponse.ok) {
        const errorText = await publishResponse.text();
        logger.error('Failed to publish Instagram media', { 
          status: publishResponse.status, 
          error: errorText 
        });
        return { success: false, error: `Failed to publish: ${errorText}` };
      }

      const publishResult = await publishResponse.json();
      const postId = publishResult.id;

      // Step 3: Get the permalink
      const permalinkUrl = `https://graph.facebook.com/v23.0/${postId}`;
      const permalinkParams = new URLSearchParams({
        fields: 'permalink',
        access_token: credentials.instagramAccessToken,
      });

      const permalinkResponse = await fetch(`${permalinkUrl}?${permalinkParams}`);
      let permalink = '';
      
      if (permalinkResponse.ok) {
        const permalinkResult = await permalinkResponse.json();
        permalink = permalinkResult.permalink || '';
      }

      logger.info('Instagram content published successfully', { postId, permalink });

      return {
        success: true,
        platformPostId: postId,
        platformUrl: permalink,
      };
    } catch (error) {
      logger.error('Instagram publishing failed', error as Error);
      return { success: false, error: (error as Error).message };
    }
  }

  validateCredentials(credentials: any): boolean {
    return !!(credentials?.instagramAccessToken && credentials?.instagramAccountId);
  }

  formatContent(schedule: any): any {
    return {
      caption: this.formatCaption(schedule.caption, schedule.hashtags),
      mediaType: schedule.contentType === 'video' ? 'VIDEO' : 'IMAGE',
    };
  }

  private formatCaption(caption: string | undefined | null, hashtags: string[] | undefined): string {
    const safeCaption = caption ?? '';
    const hashtagString = hashtags?.length ? '\n\n' + hashtags.map(tag => `#${tag}`).join(' ') : '';
    return `${safeCaption}${hashtagString}`.slice(0, PLATFORM_LIMITS.INSTAGRAM_CAPTION);
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
    return { text: schedule.caption?.slice(0, PLATFORM_LIMITS.TWITTER_TWEET) };
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
      title: schedule.caption?.split('\n')[0]?.slice(0, PLATFORM_LIMITS.YOUTUBE_TITLE),
      description: schedule.caption?.slice(0, PLATFORM_LIMITS.YOUTUBE_DESCRIPTION),
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

    // Get fresh content details from main app
    const freshContent = await getContentDetails(schedule.contentId);
    logger.info('Fetched fresh content', { contentId: schedule.contentId, brandId: schedule.brandId });

    // Merge fresh content with schedule data
    const mergedSchedule = {
      ...schedule,
      caption: freshContent.caption,
      hashtags: freshContent.hashtags,
      imageUrl: freshContent.cdnImageUrl || freshContent.mediaUrls?.[0],
    };

    // Get platform credentials from main app
    const credentials = await getPlatformCredentials(schedule.brandId);
    logger.info('Fetched credentials', { brandId: schedule.brandId, hasToken: !!credentials.instagramAccessToken });

    // If video content, get signed URL
    let mediaUrl = null;
    if (schedule.contentType === 'video' && schedule.videoUrl) {
      mediaUrl = await getSignedVideoUrl(schedule.videoUrl);
    } else if (mergedSchedule.imageUrl) {
      mediaUrl = mergedSchedule.imageUrl;
    }

    // Get platform adapter
    const adapter = PlatformAdapterFactory.getAdapter(schedule.platform);
    
    // Validate credentials
    if (!adapter.validateCredentials(credentials)) {
      throw new Error(`Invalid credentials for platform: ${schedule.platform}`);
    }
    
    // Publish to platform using adapter
    const publishResult = await adapter.publish(mergedSchedule, credentials, mediaUrl);
    
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

    metrics.addMetric('ContentPublished', MetricUnit.Count, 1);
    metrics.addMetric(`ContentPublished_${schedule.platform}`, MetricUnit.Count, 1);
    
    logger.info('Content published successfully', { 
      scheduleId: event.scheduleId,
      platform: schedule.platform 
    });
  } catch (error) {
    logger.error('Failed to publish content', error as Error);
    metrics.addMetric('PublishingError', MetricUnit.Count, 1);
    
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

async function getPlatformCredentials(brandId: string): Promise<any> {
  try {
    const response = await fetch(`${process.env.MAIN_APP_API_URL}/api/publisher/credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.PUBLISHER_API_KEY || '',
      },
      body: JSON.stringify({ brandId }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Failed to fetch credentials from main app', { brandId, status: response.status, error });
      throw new Error(`Failed to fetch credentials: ${error}`);
    }

    const data = await response.json();
    if (!data.success || !data.credentials) {
      throw new Error('Invalid credentials response from main app');
    }

    return data.credentials;
  } catch (error) {
    logger.error('Error fetching platform credentials', error as Error);
    throw error;
  }
}

async function getContentDetails(contentId: string): Promise<any> {
  try {
    const response = await fetch(`${process.env.MAIN_APP_API_URL}/api/publisher/content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.PUBLISHER_API_KEY || '',
      },
      body: JSON.stringify({ contentId }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Failed to fetch content from main app', { contentId, status: response.status, error });
      throw new Error(`Failed to fetch content: ${error}`);
    }

    const data = await response.json();
    if (!data.success || !data.content) {
      throw new Error('Invalid content response from main app');
    }

    return data.content;
  } catch (error) {
    logger.error('Error fetching content details', error as Error);
    throw error;
  }
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
  await docClient.send(new PutCommand({
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