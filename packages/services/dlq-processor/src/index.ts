/**
 * Dead Letter Queue Processor Service
 * Handles failed messages with automated retry and alerting
 */

import {
  SQSClient,
  SendMessageCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  Message,
  MessageAttributeValue,
} from '@aws-sdk/client-sqs';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand, MetricDatum } from '@aws-sdk/client-cloudwatch';
import { TracingService } from '@postolio/aws';
import { EventBusService } from '@postolio/aws';

const sqsClient = new SQSClient({});
const snsClient = new SNSClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cloudWatchClient = new CloudWatchClient({});
const tracingService = new TracingService();
const eventBus = EventBusService.getInstance();

const DLQ_STATE_TABLE = process.env.DLQ_STATE_TABLE_NAME || 'dlq-processing-state';
const ALERT_TOPIC_ARN = process.env.DLQ_ALERT_TOPIC_ARN;
const MAX_RETRY_COUNT = parseInt(process.env.DLQ_MAX_RETRIES || '5');
const RETRY_DELAY_BASE = parseInt(process.env.DLQ_RETRY_DELAY_BASE || '60000'); // 1 minute base

export interface DLQMessage {
  messageId: string;
  body: string;
  attributes: Record<string, string>;
  messageAttributes?: Record<string, MessageAttributeValue>;
  receiptHandle: string;
  dlqName: string;
  originalQueue?: string;
  retryCount: number;
  firstFailureTime?: string;
  lastFailureTime?: string;
  errorMessage?: string;
}

interface MessageState {
  retryCount?: number;
  firstFailureTime?: string;
  lastFailureTime?: string;
  errorMessage?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ProcessingResult {
  success: boolean;
  messageId: string;
  action: 'reprocessed' | 'deleted' | 'parked' | 'alerted';
  error?: string;
}

export interface DLQStats {
  queueName: string;
  totalMessages: number;
  processedMessages: number;
  failedMessages: number;
  parkedMessages: number;
  oldestMessageAge?: number;
  processingRate: number;
}

export class DLQProcessor {
  private static instance: DLQProcessor;
  private processingQueues: Map<string, boolean> = new Map();

  static getInstance(): DLQProcessor {
    if (!DLQProcessor.instance) {
      DLQProcessor.instance = new DLQProcessor();
    }
    return DLQProcessor.instance;
  }

  /**
   * Process messages from a specific DLQ
   */
  async processDLQ(
    dlqUrl: string,
    originalQueueUrl: string,
    processorFn?: (message: unknown) => Promise<boolean>
  ): Promise<ProcessingResult[]> {
    const dlqName = this.extractQueueName(dlqUrl);
    const results: ProcessingResult[] = [];

    return await tracingService.traceOperation(
      'DLQ.process',
      async () => {
        // Check if already processing this queue
        if (this.processingQueues.get(dlqName)) {
          console.log(`Already processing DLQ: ${dlqName}`);
          return [];
        }

        this.processingQueues.set(dlqName, true);

        try {
          // Receive messages from DLQ
          const messages = await this.receiveMessages(dlqUrl);

          // Batch load all message states for performance
          const messageIds = messages.map((msg) => msg.MessageId || '');
          const messageStates = await this.batchLoadMessageStates(messageIds.filter((id) => id));

          for (const message of messages) {
            const result = await this.processMessage(
              message,
              dlqName,
              originalQueueUrl,
              processorFn,
              messageStates
            );
            results.push(result);

            // Update metrics
            await this.updateMetrics(dlqName, result);
          }

          // Check for critical thresholds
          await this.checkThresholds(dlqName);

          return results;
        } finally {
          this.processingQueues.delete(dlqName);
        }
      },
      { dlqName, messageCount: results.length }
    );
  }

  /**
   * Process a single message
   */
  private async processMessage(
    sqsMessage: Message,
    dlqName: string,
    originalQueueUrl: string,
    processorFn?: (message: unknown) => Promise<boolean>,
    messageStates?: Map<string, MessageState>
  ): Promise<ProcessingResult> {
    const message = this.parseSQSMessage(sqsMessage, dlqName);

    try {
      // Use batch-loaded state if available, otherwise load individually
      const state =
        messageStates?.get(message.messageId) || (await this.loadMessageState(message.messageId));
      message.retryCount = state?.retryCount || 0;
      message.firstFailureTime = state?.firstFailureTime || new Date().toISOString();

      // Check if max retries exceeded
      if (message.retryCount >= MAX_RETRY_COUNT) {
        return await this.parkMessage(message);
      }

      // Check message age
      const messageAge =
        Date.now() - new Date(message.firstFailureTime || new Date().toISOString()).getTime();
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

      if (messageAge > maxAge) {
        return await this.parkMessage(message, 'Message too old');
      }

      // Attempt to reprocess
      const success = processorFn
        ? await processorFn(JSON.parse(message.body))
        : await this.defaultProcessor(message, originalQueueUrl);

      if (success) {
        // Delete from DLQ
        await this.deleteMessage(dlqName, sqsMessage.ReceiptHandle!);
        await this.clearMessageState(message.messageId);

        return {
          success: true,
          messageId: message.messageId,
          action: 'reprocessed',
        };
      } else {
        // Update retry count
        await this.updateMessageState(message);

        // Calculate backoff delay
        const delay = this.calculateBackoff(message.retryCount);

        // Re-send to DLQ with delay
        await this.requeueMessage(message, dlqName, delay);

        return {
          success: false,
          messageId: message.messageId,
          action: 'reprocessed',
          error: 'Processing failed, message requeued',
        };
      }
    } catch (error) {
      console.error(`Error processing DLQ message: ${message.messageId}`, error);

      // Update error state
      message.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateMessageState(message);

      // Alert if critical
      if (message.retryCount >= MAX_RETRY_COUNT - 1) {
        await this.sendAlert(message, error as Error);
      }

      return {
        success: false,
        messageId: message.messageId,
        action: 'alerted',
        error: message.errorMessage,
      };
    }
  }

  /**
   * Default processor - attempts to resend to original queue
   */
  private async defaultProcessor(message: DLQMessage, originalQueueUrl: string): Promise<boolean> {
    try {
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: originalQueueUrl,
          MessageBody: message.body,
          MessageAttributes: message.messageAttributes,
        })
      );

      console.log(`Successfully reprocessed message ${message.messageId} to original queue`);
      return true;
    } catch (error) {
      console.error(`Failed to reprocess message ${message.messageId}`, error);
      return false;
    }
  }

  /**
   * Park message for manual inspection
   */
  private async parkMessage(message: DLQMessage, reason?: string): Promise<ProcessingResult> {
    console.log(`Parking message ${message.messageId}: ${reason || 'Max retries exceeded'}`);

    // Store in DynamoDB for inspection
    await docClient.send(
      new PutCommand({
        TableName: DLQ_STATE_TABLE,
        Item: {
          messageId: message.messageId,
          status: 'parked',
          dlqName: message.dlqName,
          body: message.body,
          attributes: message.attributes,
          retryCount: message.retryCount,
          firstFailureTime: message.firstFailureTime,
          lastFailureTime: new Date().toISOString(),
          parkReason: reason || 'Max retries exceeded',
          ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days TTL
        },
      })
    );

    // Send alert
    await this.sendAlert(message, new Error(reason || 'Message parked after max retries'));

    // Delete from DLQ
    if (message.receiptHandle) {
      await this.deleteMessage(message.dlqName, message.receiptHandle);
    }

    // Publish event
    await eventBus.publish(
      'dlq.message.parked',
      {
        messageId: message.messageId,
        dlqName: message.dlqName,
        reason: reason || 'Max retries exceeded',
        retryCount: message.retryCount,
      },
      {
        correlationId: message.messageId,
        userId: 'system',
        brandId: 'system',
      }
    );

    return {
      success: false,
      messageId: message.messageId,
      action: 'parked',
    };
  }

  /**
   * Send alert for critical failures
   */
  private async sendAlert(message: DLQMessage, error: Error): Promise<void> {
    if (!ALERT_TOPIC_ARN) return;

    const alertMessage = {
      type: 'DLQ_PROCESSING_FAILURE',
      severity: message.retryCount >= MAX_RETRY_COUNT ? 'CRITICAL' : 'WARNING',
      dlqName: message.dlqName,
      messageId: message.messageId,
      retryCount: message.retryCount,
      firstFailureTime: message.firstFailureTime,
      errorMessage: error.message,
      messageBody: message.body.substring(0, 500), // Truncate for SNS limit
      timestamp: new Date().toISOString(),
    };

    try {
      await snsClient.send(
        new PublishCommand({
          TopicArn: ALERT_TOPIC_ARN,
          Subject: `[${alertMessage.severity}] DLQ Processing Failure - ${message.dlqName}`,
          Message: JSON.stringify(alertMessage, null, 2),
        })
      );
    } catch (alertError) {
      console.error('Failed to send DLQ alert', alertError);
    }
  }

  /**
   * Receive messages from DLQ
   */
  private async receiveMessages(dlqUrl: string): Promise<Message[]> {
    const result = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 300, // 5 minutes
        WaitTimeSeconds: 5,
        MessageAttributeNames: ['All'],
        AttributeNames: ['All'],
      })
    );

    return result.Messages || [];
  }

  /**
   * Delete message from DLQ
   */
  private async deleteMessage(dlqUrl: string, receiptHandle: string): Promise<void> {
    await sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: dlqUrl,
        ReceiptHandle: receiptHandle,
      })
    );
  }

  /**
   * Requeue message with delay
   */
  private async requeueMessage(
    message: DLQMessage,
    dlqUrl: string,
    delaySeconds: number
  ): Promise<void> {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: dlqUrl,
        MessageBody: message.body,
        DelaySeconds: Math.min(delaySeconds, 900), // Max 15 minutes
        MessageAttributes: {
          ...message.messageAttributes,
          RetryCount: {
            DataType: 'Number',
            StringValue: String(message.retryCount + 1),
          },
          LastFailureTime: {
            DataType: 'String',
            StringValue: new Date().toISOString(),
          },
        },
      })
    );

    // Delete original message
    if (message.receiptHandle) {
      await this.deleteMessage(dlqUrl, message.receiptHandle);
    }
  }

  /**
   * Load message processing state
   */
  private async loadMessageState(messageId: string): Promise<MessageState | null> {
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: DLQ_STATE_TABLE,
          Key: { messageId },
        })
      );
      return (result.Item as MessageState) || null;
    } catch {
      return null;
    }
  }

  /**
   * Batch load message states for performance optimization
   */
  private async batchLoadMessageStates(messageIds: string[]): Promise<Map<string, MessageState>> {
    const stateMap = new Map<string, MessageState>();

    if (messageIds.length === 0) {
      return stateMap;
    }

    // DynamoDB BatchGet has a limit of 100 items
    const batchSize = 100;
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      const keys = batch.map((id) => ({ messageId: id }));

      try {
        const result = await docClient.send(
          new BatchGetCommand({
            RequestItems: {
              [DLQ_STATE_TABLE]: {
                Keys: keys,
              },
            },
          })
        );

        // Process responses
        const responses = result.Responses?.[DLQ_STATE_TABLE] || [];
        for (const item of responses) {
          if (item.messageId) {
            stateMap.set(item.messageId, item);
          }
        }
      } catch (error) {
        console.error('Error batch loading message states:', error);
        // Fallback to individual loads for this batch if batch fails
        for (const messageId of batch) {
          const state = await this.loadMessageState(messageId);
          if (state) {
            stateMap.set(messageId, state);
          }
        }
      }
    }

    return stateMap;
  }

  /**
   * Update message processing state
   */
  private async updateMessageState(message: DLQMessage): Promise<void> {
    await docClient.send(
      new UpdateCommand({
        TableName: DLQ_STATE_TABLE,
        Key: { messageId: message.messageId },
        UpdateExpression:
          'SET retryCount = :retryCount, lastFailureTime = :lastFailure, errorMessage = :error, #status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':retryCount': message.retryCount + 1,
          ':lastFailure': new Date().toISOString(),
          ':error': message.errorMessage || 'Unknown error',
          ':status': 'retrying',
        },
      })
    );
  }

  /**
   * Clear message state after successful processing
   */
  private async clearMessageState(messageId: string): Promise<void> {
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: DLQ_STATE_TABLE,
          Key: { messageId },
          UpdateExpression: 'SET #status = :status, completedAt = :completedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'completed',
            ':completedAt': new Date().toISOString(),
          },
        })
      );
    } catch {
      // Ignore if doesn't exist
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoff(retryCount: number): number {
    const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount);
    const jitter = Math.random() * 0.3 * delay;
    return Math.floor(Math.min(delay + jitter, 900)); // Max 15 minutes
  }

  /**
   * Update CloudWatch metrics
   */
  private async updateMetrics(dlqName: string, result: ProcessingResult): Promise<void> {
    const metrics: Partial<MetricDatum>[] = [];

    if (result.success) {
      metrics.push({
        MetricName: 'MessagesReprocessed',
        Value: 1,
        Unit: 'Count',
      });
    } else if (result.action === 'parked') {
      metrics.push({
        MetricName: 'MessagesParked',
        Value: 1,
        Unit: 'Count',
      });
    } else if (result.action === 'alerted') {
      metrics.push({
        MetricName: 'AlertsSent',
        Value: 1,
        Unit: 'Count',
      });
    }

    if (metrics.length > 0) {
      await cloudWatchClient.send(
        new PutMetricDataCommand({
          Namespace: 'Postolio/DLQ',
          MetricData: metrics.map(
            (m) =>
              ({
                MetricName: m.MetricName!,
                Value: m.Value,
                Unit: m.Unit,
                Dimensions: [
                  { Name: 'QueueName', Value: dlqName },
                  {
                    Name: 'Environment',
                    Value: process.env.ENVIRONMENT || 'dev',
                  },
                ],
                Timestamp: new Date(),
              }) as MetricDatum
          ),
        })
      );
    }
  }

  /**
   * Check for critical thresholds
   */
  private async checkThresholds(dlqName: string): Promise<void> {
    const stats = await this.getDLQStats(dlqName);

    // Alert if too many messages in DLQ
    if (stats.totalMessages > 100) {
      await snsClient.send(
        new PublishCommand({
          TopicArn: ALERT_TOPIC_ARN,
          Subject: `[WARNING] High DLQ message count - ${dlqName}`,
          Message: JSON.stringify({
            type: 'HIGH_DLQ_COUNT',
            dlqName,
            totalMessages: stats.totalMessages,
            threshold: 100,
            timestamp: new Date().toISOString(),
          }),
        })
      );
    }

    // Alert if messages too old
    if (stats.oldestMessageAge && stats.oldestMessageAge > 24 * 60 * 60 * 1000) {
      await snsClient.send(
        new PublishCommand({
          TopicArn: ALERT_TOPIC_ARN,
          Subject: `[WARNING] Old messages in DLQ - ${dlqName}`,
          Message: JSON.stringify({
            type: 'OLD_DLQ_MESSAGES',
            dlqName,
            oldestMessageAge: stats.oldestMessageAge,
            threshold: '24 hours',
            timestamp: new Date().toISOString(),
          }),
        })
      );
    }
  }

  /**
   * Get DLQ statistics
   */
  async getDLQStats(dlqName: string): Promise<DLQStats> {
    const result = await docClient.send(
      new QueryCommand({
        TableName: DLQ_STATE_TABLE,
        IndexName: 'by-dlq-status',
        KeyConditionExpression: 'dlqName = :dlqName',
        ExpressionAttributeValues: {
          ':dlqName': dlqName,
        },
      })
    );

    const messages = result.Items || [];
    const now = Date.now();

    return {
      queueName: dlqName,
      totalMessages: messages.length,
      processedMessages: messages.filter((m) => m.status === 'completed').length,
      failedMessages: messages.filter((m) => m.status === 'failed').length,
      parkedMessages: messages.filter((m) => m.status === 'parked').length,
      oldestMessageAge:
        messages.length > 0
          ? Math.max(
              ...messages.map((m) => now - new Date(m.firstFailureTime || m.createdAt).getTime())
            )
          : undefined,
      processingRate: this.calculateProcessingRate(messages),
    };
  }

  /**
   * Calculate message processing rate
   */
  private calculateProcessingRate(
    messages: Array<{ status?: string; completedAt?: string }>
  ): number {
    const lastHour = Date.now() - 60 * 60 * 1000;
    const processedLastHour = messages.filter(
      (m) =>
        m.status === 'completed' &&
        m.completedAt !== undefined &&
        new Date(m.completedAt).getTime() > lastHour
    ).length;
    return processedLastHour;
  }

  /**
   * Parse SQS message into DLQMessage
   */
  private parseSQSMessage(sqsMessage: Message, dlqName: string): DLQMessage {
    return {
      messageId: sqsMessage.MessageId!,
      body: sqsMessage.Body!,
      attributes: sqsMessage.Attributes || {},
      messageAttributes: sqsMessage.MessageAttributes,
      receiptHandle: sqsMessage.ReceiptHandle!,
      dlqName,
      retryCount: parseInt(sqsMessage.MessageAttributes?.RetryCount?.StringValue || '0'),
      lastFailureTime: sqsMessage.MessageAttributes?.LastFailureTime?.StringValue,
    };
  }

  /**
   * Extract queue name from URL
   */
  private extractQueueName(queueUrl: string): string {
    return queueUrl.split('/').pop() || 'unknown';
  }

  /**
   * Manual reprocess parked messages
   */
  async reprocessParkedMessages(
    dlqName: string,
    messageIds?: string[]
  ): Promise<ProcessingResult[]> {
    // Filter by provided messageIds later (we query all parked for dlqName then subset if list provided)

    const result = await docClient.send(
      new QueryCommand({
        TableName: DLQ_STATE_TABLE,
        IndexName: 'by-dlq-status',
        KeyConditionExpression: 'dlqName = :dlqName AND #status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':dlqName': dlqName,
          ':status': 'parked',
        },
      })
    );

    const results: ProcessingResult[] = [];

    // Optionally narrow items by provided messageIds
    if (messageIds && messageIds.length > 0) {
      result.Items = (result.Items || []).filter((i) => messageIds.includes(i.messageId));
    }

    for (const item of result.Items || []) {
      // Reset retry count and reprocess
      const message: DLQMessage = {
        messageId: item.messageId,
        body: item.body,
        attributes: item.attributes || {},
        messageAttributes: item.messageAttributes,
        receiptHandle: '',
        dlqName: item.dlqName,
        retryCount: 0,
        firstFailureTime: item.firstFailureTime,
      };

      // Send back to original DLQ for reprocessing
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: `${process.env.SQS_BASE_URL}/${dlqName}`,
          MessageBody: message.body,
          MessageAttributes: {
            ...message.messageAttributes,
            RetryCount: {
              DataType: 'Number',
              StringValue: '0',
            },
            ReprocessedAt: {
              DataType: 'String',
              StringValue: new Date().toISOString(),
            },
          },
        })
      );

      // Update state
      await docClient.send(
        new UpdateCommand({
          TableName: DLQ_STATE_TABLE,
          Key: { messageId: item.messageId },
          UpdateExpression: 'SET #status = :status, reprocessedAt = :reprocessedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'reprocessing',
            ':reprocessedAt': new Date().toISOString(),
          },
        })
      );

      results.push({
        success: true,
        messageId: item.messageId,
        action: 'reprocessed',
      });
    }

    return results;
  }
}

// Export singleton instance
export const dlqProcessor = DLQProcessor.getInstance();
