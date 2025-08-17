/**
 * Dead Letter Queue Processor Lambda
 * Handles failed messages from various queues with intelligent retry logic
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { retryWithBackoff, PLATFORM_RETRY_CONFIGS } from '../../shared/retry-utils';

// Initialize Powertools
const logger = new Logger({ serviceName: 'dlq-processor' });
const tracer = new Tracer({ serviceName: 'dlq-processor' });
const metrics = new Metrics({ namespace: 'ContentScheduler', serviceName: 'dlq-processor' });

// Initialize AWS SDK clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sqsClient = tracer.captureAWSv3Client(new SQSClient({}));
const snsClient = tracer.captureAWSv3Client(new SNSClient({}));

// Configuration
const MAX_RETRY_COUNT = 5;
const PERMANENT_FAILURE_THRESHOLD = 10;

interface DLQMessage {
  messageType: 'SCHEDULE_PUBLISH' | 'VIDEO_PROCESSING' | 'PLATFORM_API' | 'ANALYTICS';
  originalMessage: any;
  error: {
    message: string;
    stack?: string;
    code?: string;
  };
  metadata: {
    scheduleId?: string;
    contentId?: string;
    platform?: string;
    videoId?: string;
    retryCount: number;
    firstFailureTime: string;
    lastFailureTime: string;
  };
}

interface RetryRecord {
  pk: string;
  sk: string;
  messageId: string;
  retryCount: number;
  maxRetries: number;
  firstFailureTime: string;
  lastFailureTime: string;
  status: 'RETRYING' | 'FAILED' | 'RECOVERED';
  originalMessage: any;
  errors: Array<{
    timestamp: string;
    message: string;
    code?: string;
  }>;
}

export const handler = async (event: SQSEvent): Promise<void> => {
  logger.info('Processing DLQ messages', { messageCount: event.Records.length });

  const results = await Promise.allSettled(
    event.Records.map(record => processMessage(record))
  );

  // Log results
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  logger.info('DLQ processing complete', { successful, failed });
  
  metrics.addMetric('DLQMessagesProcessed', MetricUnit.Count, successful);
  metrics.addMetric('DLQMessagesFailed', MetricUnit.Count, failed);
  metrics.publishStoredMetrics();
};

async function processMessage(record: SQSRecord): Promise<void> {
  const startTime = Date.now();
  
  try {
    // Parse the DLQ message
    const dlqMessage = parseDLQMessage(record);
    
    logger.info('Processing DLQ message', {
      messageType: dlqMessage.messageType,
      platform: dlqMessage.metadata.platform,
      retryCount: dlqMessage.metadata.retryCount,
    });

    // Check retry count
    if (dlqMessage.metadata.retryCount >= MAX_RETRY_COUNT) {
      await handlePermanentFailure(dlqMessage, record);
      return;
    }

    // Determine retry strategy based on message type
    const retryStrategy = getRetryStrategy(dlqMessage);
    
    // Attempt to reprocess the message
    const success = await retryMessage(dlqMessage, retryStrategy);
    
    if (success) {
      await handleSuccessfulRetry(dlqMessage, record);
      metrics.addMetric('DLQMessageRecovered', MetricUnit.Count, 1);
    } else {
      await handleRetryFailure(dlqMessage, record);
      metrics.addMetric('DLQRetryFailed', MetricUnit.Count, 1);
    }
    
    // Record processing time
    const processingTime = Date.now() - startTime;
    metrics.addMetric('DLQProcessingTime', MetricUnit.Milliseconds, processingTime);
    
  } catch (error) {
    logger.error('Failed to process DLQ message', error as Error);
    metrics.addMetric('DLQProcessingError', MetricUnit.Count, 1);
    
    // Don't delete the message - let it go back to the DLQ
    throw error;
  }
}

function parseDLQMessage(record: SQSRecord): DLQMessage {
  try {
    const body = JSON.parse(record.body);
    
    // Handle different DLQ message formats
    if (body.Records) {
      // S3 event wrapped message
      return parseS3EventMessage(body);
    } else if (body.Message) {
      // SNS wrapped message
      return parseSNSMessage(body);
    } else {
      // Direct SQS message
      return parseDirectMessage(body);
    }
  } catch (error) {
    logger.error('Failed to parse DLQ message', error as Error);
    throw new Error(`Invalid DLQ message format: ${error}`);
  }
}

function parseDirectMessage(body: any): DLQMessage {
  // Extract metadata from message attributes or body
  const metadata = body.metadata || {};
  
  return {
    messageType: body.messageType || 'PLATFORM_API',
    originalMessage: body.originalMessage || body,
    error: body.error || { message: 'Unknown error' },
    metadata: {
      ...metadata,
      retryCount: metadata.retryCount || 0,
      firstFailureTime: metadata.firstFailureTime || new Date().toISOString(),
      lastFailureTime: new Date().toISOString(),
    },
  };
}

function parseS3EventMessage(body: any): DLQMessage {
  // Handle S3 event messages (e.g., from video processing)
  const record = body.Records[0];
  
  return {
    messageType: 'VIDEO_PROCESSING',
    originalMessage: record,
    error: body.error || { message: 'Video processing failed' },
    metadata: {
      videoId: record.s3?.object?.key?.split('/')[2],
      platform: body.platform,
      retryCount: body.retryCount || 0,
      firstFailureTime: body.firstFailureTime || new Date().toISOString(),
      lastFailureTime: new Date().toISOString(),
    },
  };
}

function parseSNSMessage(body: any): DLQMessage {
  const message = JSON.parse(body.Message);
  
  return {
    messageType: message.messageType || 'PLATFORM_API',
    originalMessage: message,
    error: message.error || { message: 'Unknown error' },
    metadata: {
      ...message.metadata,
      retryCount: (message.metadata?.retryCount || 0) + 1,
      firstFailureTime: message.metadata?.firstFailureTime || new Date().toISOString(),
      lastFailureTime: new Date().toISOString(),
    },
  };
}

interface RetryStrategy {
  queueUrl: string;
  delaySeconds: number;
  transformMessage?: (message: any) => any;
}

function getRetryStrategy(dlqMessage: DLQMessage): RetryStrategy {
  const { messageType, metadata } = dlqMessage;
  
  switch (messageType) {
    case 'SCHEDULE_PUBLISH':
      return {
        queueUrl: process.env.SCHEDULE_QUEUE_URL!,
        delaySeconds: calculateBackoffDelay(metadata.retryCount),
        transformMessage: (msg) => ({
          ...msg,
          retryCount: metadata.retryCount + 1,
          retryReason: 'DLQ_RECOVERY',
        }),
      };
      
    case 'VIDEO_PROCESSING':
      return {
        queueUrl: process.env.VIDEO_PROCESSING_QUEUE_URL!,
        delaySeconds: calculateBackoffDelay(metadata.retryCount, 5000), // Longer delays for video
        transformMessage: (msg) => ({
          ...msg,
          priority: 'HIGH', // Prioritize retried videos
          retryCount: metadata.retryCount + 1,
        }),
      };
      
    case 'PLATFORM_API':
      // Use platform-specific retry configuration
      const platform = metadata.platform || 'default';
      const config = PLATFORM_RETRY_CONFIGS[platform] || {};
      
      return {
        queueUrl: process.env.PLATFORM_QUEUE_URL!,
        delaySeconds: Math.min(
          calculateBackoffDelay(metadata.retryCount, config.baseDelayMs),
          900 // SQS max delay is 900 seconds
        ),
      };
      
    case 'ANALYTICS':
      return {
        queueUrl: process.env.ANALYTICS_QUEUE_URL!,
        delaySeconds: 60, // Analytics can wait
      };
      
    default:
      return {
        queueUrl: process.env.DEFAULT_RETRY_QUEUE_URL!,
        delaySeconds: calculateBackoffDelay(metadata.retryCount),
      };
  }
}

function calculateBackoffDelay(retryCount: number, baseDelayMs = 1000): number {
  // Exponential backoff with jitter
  const exponentialDelay = Math.min(
    baseDelayMs * Math.pow(2, retryCount),
    300000 // Max 5 minutes
  );
  
  // Add jitter (±25%)
  const jitter = exponentialDelay * (0.75 + Math.random() * 0.5);
  
  // Convert to seconds for SQS delay
  return Math.floor(jitter / 1000);
}

async function retryMessage(dlqMessage: DLQMessage, strategy: RetryStrategy): Promise<boolean> {
  try {
    // Transform message if needed
    const messageToSend = strategy.transformMessage
      ? strategy.transformMessage(dlqMessage.originalMessage)
      : dlqMessage.originalMessage;
    
    // Add retry metadata
    const enrichedMessage = {
      ...messageToSend,
      _dlqMetadata: {
        retryCount: dlqMessage.metadata.retryCount + 1,
        firstFailureTime: dlqMessage.metadata.firstFailureTime,
        lastRetryTime: new Date().toISOString(),
        originalError: dlqMessage.error.message,
      },
    };
    
    // Send to appropriate queue with delay
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: strategy.queueUrl,
      MessageBody: JSON.stringify(enrichedMessage),
      DelaySeconds: strategy.delaySeconds,
      MessageAttributes: {
        RetryCount: {
          DataType: 'Number',
          StringValue: String(dlqMessage.metadata.retryCount + 1),
        },
        MessageType: {
          DataType: 'String',
          StringValue: dlqMessage.messageType,
        },
      },
    }));
    
    logger.info('Message sent for retry', {
      messageType: dlqMessage.messageType,
      retryCount: dlqMessage.metadata.retryCount + 1,
      delaySeconds: strategy.delaySeconds,
    });
    
    return true;
  } catch (error) {
    logger.error('Failed to send message for retry', error as Error);
    return false;
  }
}

async function handleSuccessfulRetry(dlqMessage: DLQMessage, record: SQSRecord): Promise<void> {
  // Record successful retry in DynamoDB
  await recordRetryResult(dlqMessage, 'RECOVERED');
  
  // Delete message from DLQ
  await deleteMessageFromDLQ(record);
  
  logger.info('Message successfully retried', {
    messageType: dlqMessage.messageType,
    retryCount: dlqMessage.metadata.retryCount,
  });
}

async function handleRetryFailure(dlqMessage: DLQMessage, record: SQSRecord): Promise<void> {
  // Update retry count in message
  const updatedMessage = {
    ...dlqMessage,
    metadata: {
      ...dlqMessage.metadata,
      retryCount: dlqMessage.metadata.retryCount + 1,
      lastFailureTime: new Date().toISOString(),
    },
  };
  
  // Send back to DLQ with updated retry count
  await sqsClient.send(new SendMessageCommand({
    QueueUrl: process.env.DLQ_URL!,
    MessageBody: JSON.stringify(updatedMessage),
    DelaySeconds: 900, // Max delay before next retry
  }));
  
  // Delete original message
  await deleteMessageFromDLQ(record);
  
  logger.warn('Message retry failed, requeuing to DLQ', {
    messageType: dlqMessage.messageType,
    retryCount: updatedMessage.metadata.retryCount,
  });
}

async function handlePermanentFailure(dlqMessage: DLQMessage, record: SQSRecord): Promise<void> {
  logger.error('Message permanently failed', {
    messageType: dlqMessage.messageType,
    retryCount: dlqMessage.metadata.retryCount,
    error: dlqMessage.error,
  });
  
  // Record permanent failure
  await recordRetryResult(dlqMessage, 'FAILED');
  
  // Send alert for critical failures
  if (shouldAlertOnFailure(dlqMessage)) {
    await sendFailureAlert(dlqMessage);
  }
  
  // Store in permanent failure table for manual review
  await storeFailedMessage(dlqMessage);
  
  // Delete from DLQ
  await deleteMessageFromDLQ(record);
  
  metrics.addMetric('DLQPermanentFailure', MetricUnit.Count, 1);
  metrics.addMetadata('messageType', dlqMessage.messageType);
}

async function recordRetryResult(dlqMessage: DLQMessage, status: 'RECOVERED' | 'FAILED'): Promise<void> {
  const record: RetryRecord = {
    pk: `DLQ#${dlqMessage.messageType}`,
    sk: `RETRY#${Date.now()}#${Math.random().toString(36).substr(2, 9)}`,
    messageId: dlqMessage.metadata.scheduleId || dlqMessage.metadata.videoId || 'unknown',
    retryCount: dlqMessage.metadata.retryCount,
    maxRetries: MAX_RETRY_COUNT,
    firstFailureTime: dlqMessage.metadata.firstFailureTime,
    lastFailureTime: dlqMessage.metadata.lastFailureTime,
    status,
    originalMessage: dlqMessage.originalMessage,
    errors: [{
      timestamp: new Date().toISOString(),
      message: dlqMessage.error.message,
      code: dlqMessage.error.code,
    }],
  };
  
  await docClient.send(new PutCommand({
    TableName: process.env.DLQ_TRACKING_TABLE!,
    Item: record,
  }));
}

async function storeFailedMessage(dlqMessage: DLQMessage): Promise<void> {
  await docClient.send(new PutCommand({
    TableName: process.env.FAILED_MESSAGES_TABLE!,
    Item: {
      pk: `FAILED#${dlqMessage.messageType}`,
      sk: `${Date.now()}#${Math.random().toString(36).substr(2, 9)}`,
      ...dlqMessage,
      storedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days retention
    },
  }));
}

function shouldAlertOnFailure(dlqMessage: DLQMessage): boolean {
  // Alert on critical message types
  const criticalTypes = ['SCHEDULE_PUBLISH', 'VIDEO_PROCESSING'];
  
  // Alert on high-priority platforms
  const criticalPlatforms = ['instagram', 'youtube'];
  
  return criticalTypes.includes(dlqMessage.messageType) ||
         (dlqMessage.metadata.platform && criticalPlatforms.includes(dlqMessage.metadata.platform));
}

async function sendFailureAlert(dlqMessage: DLQMessage): Promise<void> {
  if (!process.env.ALERT_TOPIC_ARN) {
    logger.warn('No alert topic configured');
    return;
  }
  
  const message = {
    Subject: `[CRITICAL] Permanent DLQ Failure: ${dlqMessage.messageType}`,
    Message: JSON.stringify({
      messageType: dlqMessage.messageType,
      platform: dlqMessage.metadata.platform,
      retryCount: dlqMessage.metadata.retryCount,
      error: dlqMessage.error.message,
      firstFailure: dlqMessage.metadata.firstFailureTime,
      metadata: dlqMessage.metadata,
    }, null, 2),
    MessageAttributes: {
      severity: {
        DataType: 'String',
        StringValue: 'CRITICAL',
      },
      messageType: {
        DataType: 'String',
        StringValue: dlqMessage.messageType,
      },
    },
  };
  
  try {
    await snsClient.send(new PublishCommand({
      TopicArn: process.env.ALERT_TOPIC_ARN,
      ...message,
    }));
    
    logger.info('Alert sent for permanent failure');
  } catch (error) {
    logger.error('Failed to send alert', error as Error);
  }
}

async function deleteMessageFromDLQ(record: SQSRecord): Promise<void> {
  try {
    await sqsClient.send(new DeleteMessageCommand({
      QueueUrl: process.env.DLQ_URL!,
      ReceiptHandle: record.receiptHandle,
    }));
  } catch (error) {
    logger.error('Failed to delete message from DLQ', error as Error);
  }
}