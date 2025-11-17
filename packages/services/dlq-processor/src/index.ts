/**
 * Dead Letter Queue Processor Service
 * Handles failed messages by forwarding them back to the original queue
 */

import { SQSClient, SendMessageCommand, MessageAttributeValue } from '@aws-sdk/client-sqs';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { SQSEvent } from 'aws-lambda';

const sqsClient = new SQSClient({});
const ssmClient = new SSMClient({});

/**
 * Lambda handler for processing messages delivered from an SQS DLQ event source.
 * For each DLQ record, attempts to forward the original message body to the corresponding
 * non-DLQ queue (by replacing the '-dlq' suffix) within the same account/region.
 * If forwarding succeeds for all messages, Lambda completes and SQS removes the DLQ messages.
 */
export const handler = async (
  event: SQSEvent
): Promise<{ processed: number; forwarded: number } | void> => {
  let processed = 0;
  let forwarded = 0;

  for (const record of event.Records) {
    processed += 1;

    try {
      const arn = record.eventSourceARN || '';
      // arn:aws:sqs:region:account:queueName
      const [, , , region, accountId, queueName] = arn.split(':');
      if (!region || !accountId || !queueName) {
        console.warn('DLQ record missing ARN components; skipping', { arn });
        continue;
      }

      // Prefer explicit mapping via environment or SSM Parameter Store
      let configuredTarget = process.env.RETRY_QUEUE_URL || process.env.PUBLISHING_QUEUE_URL;
      if (!configuredTarget) {
        try {
          const env = process.env.ENVIRONMENT || 'dev';
          const retryParam = await ssmClient.send(
            new GetParameterCommand({
              Name: `/postolio/${env}/publishing/retry-queue-url`,
            })
          );
          configuredTarget = retryParam.Parameter?.Value || undefined;
        } catch {
          // ignore and try publishing queue
        }
      }
      if (!configuredTarget) {
        try {
          const env = process.env.ENVIRONMENT || 'dev';
          const pubParam = await ssmClient.send(
            new GetParameterCommand({
              Name: `/postolio/${env}/publishing/queue-url`,
            })
          );
          configuredTarget = pubParam.Parameter?.Value || undefined;
        } catch {
          // ignore and fall back to heuristic
        }
      }
      const originalQueueName = configuredTarget
        ? configuredTarget.split('/').pop() || ''
        : queueName.replace(/-dlq$/i, '');
      const queueUrl =
        configuredTarget || `https://sqs.${region}.amazonaws.com/${accountId}/${originalQueueName}`;

      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: record.body,
          // Forward message attributes if present
          MessageAttributes: record.messageAttributes as
            | Record<string, MessageAttributeValue>
            | undefined,
        })
      );

      forwarded += 1;
      console.log('Forwarded DLQ message to original queue', {
        messageId: record.messageId,
        originalQueueName,
        targetQueueUrl: queueUrl,
      });
    } catch (error) {
      console.error('Failed to forward DLQ message', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
        configuredRetryQueue: process.env.RETRY_QUEUE_URL,
        configuredPublishingQueue: process.env.PUBLISHING_QUEUE_URL,
      });
      // Throwing will cause Lambda to report a failure and DLQ message to remain for retry/visibility timeout
      throw error;
    }
  }

  return { processed, forwarded };
};
