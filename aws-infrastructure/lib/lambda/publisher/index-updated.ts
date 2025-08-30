import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { EventBridge } from '@aws-sdk/client-eventbridge';

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
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});
const s3Client = tracer.captureAWSv3Client(new S3Client({}));
const lambdaClient = new LambdaClient({});
const eventBridge = new EventBridge({});

// Event-driven publish event from scheduler
interface PublishEvent {
  scheduleId: string;
  contentId: string;
  brandId: string;
  userId: string;
  platform: 'instagram' | 'facebook' | 'linkedin' | 'tiktok';
  scheduledTime: string;
  content: {
    caption: string;
    hashtags: string[];
    imageUrl: string;
  };
}

interface PlatformAdapter {
  publish(content: any, credentials: any, mediaUrl: string | null): Promise<PublishResult>;
  validateCredentials(credentials: any): boolean;
  formatContent(content: any): any;
}

interface PublishResult {
  success: boolean;
  platformPostId?: string;
  platformUrl?: string;
  error?: string;
}

interface TokenServiceResponse {
  accessToken: string;
  expiresAt?: string;
  accountId?: string;
  pageId?: string;
}

// Get token from Token Service (via Lambda invocation)
async function getTokenFromTokenService(
  brandId: string, 
  userId: string, 
  platform: string
): Promise<TokenServiceResponse> {
  const tokenServiceArn = process.env.TOKEN_SERVICE_ARN;
  
  if (!tokenServiceArn) {
    throw new Error('TOKEN_SERVICE_ARN not configured');
  }

  logger.info('Fetching token from Token Service', { brandId, userId, platform });

  try {
    const response = await lambdaClient.send(new InvokeCommand({
      FunctionName: tokenServiceArn,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({
        httpMethod: 'POST',
        path: '/internal/tokens/get',
        body: JSON.stringify({
          brandId,
          userId,
          platform
        })
      })
    }));

    const result = JSON.parse(new TextDecoder().decode(response.Payload));
    
    if (result.statusCode !== 200) {
      throw new Error(`Token service error: ${result.body}`);
    }

    const tokenData = JSON.parse(result.body);
    logger.info('Successfully retrieved token from Token Service');
    
    return tokenData;
  } catch (error) {
    logger.error('Failed to get token from Token Service', error as Error);
    throw new Error(`Token retrieval failed: ${(error as Error).message}`);
  }
}

// Platform adapter factory
class PlatformAdapterFactory {
  static getAdapter(platform: string): PlatformAdapter {
    switch (platform) {
      case 'instagram':
        return new InstagramAdapter();
      case 'facebook':
        return new FacebookAdapter();
      case 'linkedin':
        return new LinkedInAdapter();
      case 'tiktok':
        return new TikTokAdapter();
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}

// Instagram adapter implementation
class InstagramAdapter implements PlatformAdapter {
  async publish(content: any, credentials: any, mediaUrl: string | null): Promise<PublishResult> {
    try {
      if (!mediaUrl) {
        throw new Error('Media URL is required for Instagram publishing');
      }

      const formattedCaption = this.formatCaption(content.caption, content.hashtags);
      
      // Step 1: Create media container
      const createMediaUrl = `https://graph.facebook.com/v23.0/${credentials.accountId}/media`;
      const createMediaParams = new URLSearchParams({
        image_url: mediaUrl,
        caption: formattedCaption,
        access_token: credentials.accessToken,
      });

      logger.info('Creating Instagram media container', { 
        accountId: credentials.accountId,
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
      const publishUrl = `https://graph.facebook.com/v23.0/${credentials.accountId}/media_publish`;
      const publishParams = new URLSearchParams({
        creation_id: creationId,
        access_token: credentials.accessToken,
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
        access_token: credentials.accessToken,
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
    return !!(credentials?.accessToken && credentials?.accountId);
  }

  formatContent(content: any): any {
    return {
      caption: this.formatCaption(content.caption, content.hashtags),
      mediaType: 'IMAGE',
    };
  }

  private formatCaption(caption: string | undefined | null, hashtags: string[] | undefined): string {
    const safeCaption = caption ?? '';
    const hashtagString = hashtags?.length ? '\n\n' + hashtags.map(tag => `#${tag}`).join(' ') : '';
    return `${safeCaption}${hashtagString}`.slice(0, PLATFORM_LIMITS.INSTAGRAM_CAPTION);
  }
}

// Facebook adapter
class FacebookAdapter implements PlatformAdapter {
  async publish(content: any, credentials: any, mediaUrl: string | null): Promise<PublishResult> {
    // Facebook publishing logic
    return { success: false, error: 'Facebook publishing not yet implemented' };
  }

  validateCredentials(credentials: any): boolean {
    return !!(credentials?.accessToken && credentials?.pageId);
  }

  formatContent(content: any): any {
    return { message: content.caption };
  }
}

// LinkedIn adapter
class LinkedInAdapter implements PlatformAdapter {
  async publish(content: any, credentials: any, mediaUrl: string | null): Promise<PublishResult> {
    // LinkedIn publishing logic
    return { success: false, error: 'LinkedIn publishing not yet implemented' };
  }

  validateCredentials(credentials: any): boolean {
    return !!(credentials?.accessToken);
  }

  formatContent(content: any): any {
    return { text: content.caption };
  }
}

// TikTok adapter
class TikTokAdapter implements PlatformAdapter {
  async publish(content: any, credentials: any, mediaUrl: string | null): Promise<PublishResult> {
    // TikTok publishing logic
    return { success: false, error: 'TikTok publishing not yet implemented' };
  }

  validateCredentials(credentials: any): boolean {
    return !!(credentials?.accessToken);
  }

  formatContent(content: any): any {
    return { caption: content.caption };
  }
}

export const handler = async (event: PublishEvent): Promise<void> => {
  logger.info('Publishing content', { 
    scheduleId: event.scheduleId,
    contentId: event.contentId,
    brandId: event.brandId,
    platform: event.platform 
  });

  try {
    // Validate event data
    if (!event.content || !event.contentId || !event.brandId || !event.userId) {
      throw new Error('Invalid event data: missing required fields');
    }

    // Get token from Token Service
    const tokenData = await getTokenFromTokenService(
      event.brandId,
      event.userId,
      event.platform
    );

    // Prepare credentials based on platform
    const credentials = {
      accessToken: tokenData.accessToken,
      accountId: tokenData.accountId,
      pageId: tokenData.pageId,
      expiresAt: tokenData.expiresAt,
    };

    // Use media URL from event content
    const mediaUrl = event.content.imageUrl;

    // Get platform adapter
    const adapter = PlatformAdapterFactory.getAdapter(event.platform);
    
    // Validate credentials
    if (!adapter.validateCredentials(credentials)) {
      throw new Error(`Invalid credentials for platform: ${event.platform}`);
    }
    
    // Publish to platform using adapter
    const publishResult = await adapter.publish(event.content, credentials, mediaUrl);
    
    if (!publishResult.success) {
      throw new Error(publishResult.error || 'Publishing failed');
    }
    
    // Update schedule status in DynamoDB
    await updateScheduleStatus(
      event.scheduleId, 
      'published',
      undefined,
      publishResult.platformPostId,
      publishResult.platformUrl
    );

    // Emit content published event
    await eventBridge.putEvents({
      Entries: [{
        Source: 'postolio.publisher',
        DetailType: 'content.published',
        Detail: JSON.stringify({
          contentId: event.contentId,
          brandId: event.brandId,
          platform: event.platform,
          platformPostId: publishResult.platformPostId,
          platformUrl: publishResult.platformUrl,
          publishedAt: new Date().toISOString(),
        }),
      }],
    });

    metrics.addMetric('ContentPublished', MetricUnit.Count, 1);
    metrics.addMetric(`ContentPublished_${event.platform}`, MetricUnit.Count, 1);
    
    logger.info('Content published successfully', { 
      scheduleId: event.scheduleId,
      contentId: event.contentId,
      platform: event.platform,
      platformPostId: publishResult.platformPostId,
      platformUrl: publishResult.platformUrl,
    });
  } catch (error) {
    logger.error('Failed to publish content', error as Error);
    metrics.addMetric('PublishingError', MetricUnit.Count, 1);
    metrics.addMetric(`PublishingError_${event.platform}`, MetricUnit.Count, 1);
    
    // Update schedule status to failed
    await updateScheduleStatus(event.scheduleId, 'failed', (error as Error).message);
    
    // Emit publishing failed event
    await eventBridge.putEvents({
      Entries: [{
        Source: 'postolio.publisher',
        DetailType: 'content.publishing.failed',
        Detail: JSON.stringify({
          contentId: event.contentId,
          brandId: event.brandId,
          platform: event.platform,
          error: (error as Error).message,
          timestamp: new Date().toISOString(),
        }),
      }],
    });
    
    throw error;
  } finally {
    metrics.publishStoredMetrics();
  }
};

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