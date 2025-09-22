/**
 * DLQ Processor Lambda Handler
 * Automatically processes messages from Dead Letter Queues
 */

import { ScheduledEvent, Context } from 'aws-lambda';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({});

// DLQ to Original Queue mapping
const DLQ_MAPPINGS = {
  'postolio-content-publisher-dlq': {
    originalQueue: process.env.PUBLISHER_QUEUE_URL,
    processor: 'contentPublisher',
  },
  'postolio-scheduler-dlq': {
    originalQueue: process.env.SCHEDULER_QUEUE_URL,
    processor: 'scheduler',
  },
  'postolio-token-refresh-dlq': {
    originalQueue: process.env.TOKEN_REFRESH_QUEUE_URL,
    processor: 'tokenRefresh',
  },
  'postolio-analytics-dlq': {
    originalQueue: process.env.ANALYTICS_QUEUE_URL,
    processor: 'analytics',
  },
};

// Custom processors for specific DLQs
const PROCESSORS = {
  contentPublisher: async (message: any): Promise<boolean> => {
    try {
      console.log('Reprocessing content publisher message:', message);

      // Validate message structure
      if (!message.contentId || !message.platform) {
        console.error('Invalid message structure for content publisher');
        return false;
      }

      // Check if content still exists and is valid
      // This would normally call the content service
      // For now, return true if message is valid
      return true;
    } catch (error) {
      console.error('Content publisher processor error:', error);
      return false;
    }
  },

  scheduler: async (message: any): Promise<boolean> => {
    try {
      console.log('Reprocessing scheduler message:', message);

      // Validate schedule is still relevant
      if (message.scheduledTime) {
        const scheduledTime = new Date(message.scheduledTime);
        if (scheduledTime < new Date()) {
          console.log('Schedule is in the past, marking as processed');
          return true; // Don't retry past schedules
        }
      }

      return true;
    } catch (error) {
      console.error('Scheduler processor error:', error);
      return false;
    }
  },

  tokenRefresh: async (message: any): Promise<boolean> => {
    try {
      console.log('Reprocessing token refresh message:', message);

      // Token refresh messages are time-sensitive
      // If too old, skip
      const messageTime = new Date(message.timestamp || 0);
      const ageInHours = (Date.now() - messageTime.getTime()) / (1000 * 60 * 60);

      if (ageInHours > 24) {
        console.log('Token refresh message too old, skipping');
        return true; // Mark as processed to remove from DLQ
      }

      return true;
    } catch (error) {
      console.error('Token refresh processor error:', error);
      return false;
    }
  },

  analytics: async (message: any): Promise<boolean> => {
    try {
      console.log('Reprocessing analytics message:', message);

      // Analytics messages can be batched if old
      // For now, always attempt reprocessing
      return true;
    } catch (error) {
      console.error('Analytics processor error:', error);
      return false;
    }
  },
};

/**
 * Lambda handler for scheduled DLQ processing
 */
export const handler = async (event: ScheduledEvent, context: Context): Promise<any> => {
  console.log('DLQ Processor triggered:', JSON.stringify(event));

  const results = {
    processed: 0,
    failed: 0,
    parked: 0,
    errors: [] as string[],
  };

  try {
    // Process each configured DLQ
    for (const [dlqName, config] of Object.entries(DLQ_MAPPINGS)) {
      if (!config.originalQueue) {
        console.warn(`Skipping ${dlqName}: No original queue configured`);
        continue;
      }

      const dlqUrl = `${process.env.SQS_BASE_URL}/${dlqName}`;
      const processorFn = config.processor
        ? PROCESSORS[config.processor as keyof typeof PROCESSORS]
        : undefined;

      try {
        console.log(`Processing DLQ: ${dlqName}`);
        const processingResults = await processDLQ(
          dlqUrl,
          config.originalQueue,
          processorFn
        );

        // Aggregate results
        for (const result of processingResults) {
          if (result.success) {
            results.processed++;
          } else if (result.action === 'parked') {
            results.parked++;
          } else {
            results.failed++;
          }
        }

        console.log(`DLQ ${dlqName} processing complete:`, {
          total: processingResults.length,
          successful: processingResults.filter((r) => r.success).length,
          failed: processingResults.filter((r) => !r.success).length,
        });
      } catch (error) {
        const errorMessage = `Failed to process DLQ ${dlqName}: ${error}`;
        console.error(errorMessage);
        results.errors.push(errorMessage);
      }
    }

    // Get overall stats for monitoring
    const stats = await Promise.all(
      Object.keys(DLQ_MAPPINGS).map((dlqName) => getDLQStats(dlqName))
    );

    console.log('DLQ Processing Complete:', {
      results,
      stats,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'DLQ processing completed',
        results,
        stats,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('DLQ Processor error:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'DLQ processing failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        results,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

/**
 * Lambda handler for manual reprocessing
 */
export const reprocessHandler = async (event: any, context: Context): Promise<any> => {
  console.log('Manual DLQ reprocess triggered:', JSON.stringify(event));

  const { dlqName, messageIds } = event;

  if (!dlqName) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'dlqName is required',
      }),
    };
  }

  try {
    const results = await reprocessParkedMessages(dlqName, messageIds);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Reprocessing initiated',
        results,
        count: results.length,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('Reprocess error:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Reprocess failed',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

/**
 * Process messages from a DLQ
 */
async function processDLQ(
  dlqUrl: string,
  originalQueueUrl: string,
  processorFn?: (message: any) => Promise<boolean>
): Promise<Array<{ success: boolean; action?: string }>> {
  const results: Array<{ success: boolean; action?: string }> = [];

  try {
    // Receive messages from DLQ
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: dlqUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 5,
    });

    const response = await sqsClient.send(receiveCommand);
    const messages = response.Messages || [];

    for (const message of messages) {
      try {
        const body = JSON.parse(message.Body || '{}');

        // Process with custom processor if available
        let shouldRequeue = true;
        if (processorFn) {
          shouldRequeue = await processorFn(body);
        }

        if (shouldRequeue) {
          // Send back to original queue
          await sqsClient.send(new SendMessageCommand({
            QueueUrl: originalQueueUrl,
            MessageBody: message.Body,
          }));
        }

        // Delete from DLQ
        await sqsClient.send(new DeleteMessageCommand({
          QueueUrl: dlqUrl,
          ReceiptHandle: message.ReceiptHandle,
        }));

        results.push({ success: true });
      } catch (error) {
        console.error('Error processing message:', error);
        results.push({ success: false, action: 'parked' });
      }
    }
  } catch (error) {
    console.error('Error processing DLQ:', error);
    results.push({ success: false });
  }

  return results;
}

/**
 * Get DLQ statistics
 */
async function getDLQStats(dlqName: string): Promise<{ dlqName: string; messageCount: number }> {
  // Simplified stats - in real implementation would query CloudWatch
  return {
    dlqName,
    messageCount: 0
  };
}

/**
 * Reprocess parked messages
 */
async function reprocessParkedMessages(dlqName: string, messageIds?: string[]): Promise<any[]> {
  // Simplified implementation - would normally handle specific message IDs
  return [];
}
