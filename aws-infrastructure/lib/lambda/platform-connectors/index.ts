/**
 * Platform Publisher Lambda
 * Main entry point for publishing content to social media platforms
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeEvent } from 'aws-lambda';

import { BasePlatformConnector, Content, PublishResult } from './base-connector';
import { InstagramConnector } from './instagram-connector';
import { TikTokConnector } from './tiktok-connector';
import { YouTubeConnector } from './youtube-connector';

// Initialize Powertools
const logger = new Logger({ serviceName: 'platform-publisher' });
const tracer = new Tracer({ serviceName: 'platform-publisher' });
const metrics = new Metrics({ namespace: 'ContentScheduler', serviceName: 'platform-publisher' });

// Initialize AWS SDK clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Platform connector factory
const connectorFactory: Record<string, () => BasePlatformConnector> = {
  instagram: () => new InstagramConnector(),
  tiktok: () => new TikTokConnector(),
  youtube: () => new YouTubeConnector(),
};

export interface ScheduleEventDetail {
  scheduleId: string;
  brandId: string;
  contentId: string;
  platform: string;
  content: Content;
  scheduledAt: string;
  retryCount?: number;
  priority?: number;
}

export interface PublishingStatus {
  scheduleId: string;
  status: 'pending' | 'publishing' | 'published' | 'failed' | 'retrying';
  platformPostId?: string;
  platformUrl?: string;
  publishedAt?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  retryCount: number;
  lastAttemptAt: string;
}

/**
 * Lambda handler for platform publishing
 */
export const handler = async (
  event: EventBridgeEvent<'ScheduledPublish', ScheduleEventDetail>
): Promise<void> => {
  const { scheduleId, brandId, contentId, platform, content } = event.detail;
  
  logger.addPersistentLogAttributes({
    scheduleId,
    brandId,
    contentId,
    platform,
  });
  
  logger.info('Starting content publishing', {
    platform,
    mediaType: content.mediaType,
    scheduledAt: event.detail.scheduledAt,
  });
  
  const startTime = Date.now();
  
  try {
    // Load publishing status
    const status = await loadPublishingStatus(scheduleId);
    
    if (status.status === 'published') {
      logger.warn('Content already published', { 
        platformPostId: status.platformPostId,
        publishedAt: status.publishedAt,
      });
      return;
    }
    
    // Update status to publishing
    await updatePublishingStatus(scheduleId, {
      ...status,
      status: 'publishing',
      lastAttemptAt: new Date().toISOString(),
    });
    
    // Get platform connector
    const connectorFactory = getConnectorFactory(platform);
    if (!connectorFactory) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    
    const connector = connectorFactory();
    
    // Authenticate with platform
    await connector.authenticate();
    
    // Publish content
    const result = await connector.publishContent(content);
    
    if (result.success) {
      // Update status to published
      await updatePublishingStatus(scheduleId, {
        scheduleId,
        status: 'published',
        platformPostId: result.platformPostId,
        platformUrl: result.platformUrl,
        publishedAt: result.publishedAt || new Date().toISOString(),
        retryCount: status.retryCount,
        lastAttemptAt: new Date().toISOString(),
      });
      
      logger.info('Content published successfully', {
        platformPostId: result.platformPostId,
        platformUrl: result.platformUrl,
        duration: Date.now() - startTime,
      });
      
      metrics.addMetric('PublishingSuccess', MetricUnit.Count, 1);
      metrics.addMetric('PublishingDuration', MetricUnit.Milliseconds, Date.now() - startTime);
      metrics.addMetadata('platform', platform);
      
    } else {
      // Handle publishing failure
      await handlePublishingFailure(scheduleId, status, result);
      
      metrics.addMetric('PublishingFailure', MetricUnit.Count, 1);
      metrics.addMetadata('platform', platform);
      metrics.addMetadata('errorCode', result.error?.code || 'UNKNOWN');
    }
    
  } catch (error) {
    logger.error('Unexpected error during publishing', error as Error);
    
    // Update status to failed
    await updatePublishingStatus(scheduleId, {
      scheduleId,
      status: 'failed',
      error: {
        code: 'UNEXPECTED_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        retryable: true,
      },
      retryCount: event.detail.retryCount || 0,
      lastAttemptAt: new Date().toISOString(),
    });
    
    metrics.addMetric('PublishingError', MetricUnit.Count, 1);
    
    // Re-throw to trigger retry via DLQ
    throw error;
    
  } finally {
    metrics.publishStoredMetrics();
  }
};

/**
 * Get connector factory for platform
 */
function getConnectorFactory(platform: string): (() => BasePlatformConnector) | undefined {
  return connectorFactory[platform.toLowerCase()];
}

/**
 * Load publishing status from DynamoDB
 */
async function loadPublishingStatus(scheduleId: string): Promise<PublishingStatus> {
  try {
    const response = await docClient.send(new GetCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      Key: {
        PK: `SCHEDULE#${scheduleId}`,
        SK: 'STATUS',
      },
    }));
    
    if (response.Item) {
      return response.Item as PublishingStatus;
    }
    
    // Return default status if not found
    return {
      scheduleId,
      status: 'pending',
      retryCount: 0,
      lastAttemptAt: new Date().toISOString(),
    };
    
  } catch (error) {
    logger.error('Failed to load publishing status', { scheduleId, error });
    
    // Return default status on error
    return {
      scheduleId,
      status: 'pending',
      retryCount: 0,
      lastAttemptAt: new Date().toISOString(),
    };
  }
}

/**
 * Update publishing status in DynamoDB
 */
async function updatePublishingStatus(
  scheduleId: string,
  status: PublishingStatus
): Promise<void> {
  try {
    await docClient.send(new UpdateCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      Key: {
        PK: `SCHEDULE#${scheduleId}`,
        SK: 'STATUS',
      },
      UpdateExpression: `
        SET #status = :status,
            #platformPostId = :platformPostId,
            #platformUrl = :platformUrl,
            #publishedAt = :publishedAt,
            #error = :error,
            #retryCount = :retryCount,
            #lastAttemptAt = :lastAttemptAt,
            #updatedAt = :updatedAt
      `,
      ExpressionAttributeNames: {
        '#status': 'status',
        '#platformPostId': 'platformPostId',
        '#platformUrl': 'platformUrl',
        '#publishedAt': 'publishedAt',
        '#error': 'error',
        '#retryCount': 'retryCount',
        '#lastAttemptAt': 'lastAttemptAt',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':status': status.status,
        ':platformPostId': status.platformPostId || null,
        ':platformUrl': status.platformUrl || null,
        ':publishedAt': status.publishedAt || null,
        ':error': status.error || null,
        ':retryCount': status.retryCount,
        ':lastAttemptAt': status.lastAttemptAt,
        ':updatedAt': new Date().toISOString(),
      },
    }));
    
    logger.info('Publishing status updated', { scheduleId, status: status.status });
    
  } catch (error) {
    logger.error('Failed to update publishing status', { scheduleId, error });
    throw error;
  }
}

/**
 * Handle publishing failure
 */
async function handlePublishingFailure(
  scheduleId: string,
  currentStatus: PublishingStatus,
  result: PublishResult
): Promise<void> {
  const maxRetries = 3;
  const retryCount = currentStatus.retryCount + 1;
  
  if (result.error?.retryable && retryCount <= maxRetries) {
    // Update status to retrying
    await updatePublishingStatus(scheduleId, {
      scheduleId,
      status: 'retrying',
      error: result.error,
      retryCount,
      lastAttemptAt: new Date().toISOString(),
    });
    
    logger.info('Publishing will be retried', {
      scheduleId,
      retryCount,
      maxRetries,
      errorCode: result.error.code,
    });
    
    // The retry will be handled by the DLQ processor
    throw new Error(`Publishing failed: ${result.error.message}`);
    
  } else {
    // Max retries exceeded or non-retryable error
    await updatePublishingStatus(scheduleId, {
      scheduleId,
      status: 'failed',
      error: result.error,
      retryCount,
      lastAttemptAt: new Date().toISOString(),
    });
    
    logger.error('Publishing permanently failed', {
      scheduleId,
      retryCount,
      errorCode: result.error?.code,
      errorMessage: result.error?.message,
    });
    
    metrics.addMetric('PublishingPermanentFailure', MetricUnit.Count, 1);
  }
}

/**
 * Export connectors for testing
 */
export {
  InstagramConnector,
  TikTokConnector,
  YouTubeConnector,
  BasePlatformConnector,
};