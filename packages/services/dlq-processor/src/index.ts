/**
 * Dead Letter Queue Processor Service
 * Handles failed messages by forwarding them back to the original queue
 */

import { SQSClient, SendMessageCommand, type MessageAttributeValue } from '@aws-sdk/client-sqs';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { SQSEvent } from 'aws-lambda';
import { initSentry, captureException } from '@postolio/observability';

const sqsClient = new SQSClient({});
const ssmClient = new SSMClient({});

initSentry({
  serviceName: 'dlq-processor',
});

type DlqRecord = SQSEvent['Records'][number];
type QueueContext = {
  region: string;
  accountId: string;
  queueName: string;
};

function parseQueueContext(record: DlqRecord): QueueContext | null {
  const arn = record.eventSourceARN || '';
  // arn:aws:sqs:region:account:queueName
  const [, , , region, accountId, queueName] = arn.split(':');
  if (!region || !accountId || !queueName) {
    console.warn('DLQ record missing ARN components; skipping', { arn });
    return null;
  }
  return { region, accountId, queueName };
}

async function readSsmParameter(name: string): Promise<string | undefined> {
  try {
    const result = await ssmClient.send(new GetParameterCommand({ Name: name }));
    return result.Parameter?.Value || undefined;
  } catch {
    return undefined;
  }
}

async function resolveConfiguredTargetQueueUrl(): Promise<string | undefined> {
  if (process.env.RETRY_QUEUE_URL) {
    return process.env.RETRY_QUEUE_URL;
  }
  if (process.env.PUBLISHING_QUEUE_URL) {
    return process.env.PUBLISHING_QUEUE_URL;
  }

  const env = process.env.ENVIRONMENT || 'dev';
  const retryUrl = await readSsmParameter(`/postolio/${env}/publishing/retry-queue-url`);
  if (retryUrl) {
    return retryUrl;
  }
  return readSsmParameter(`/postolio/${env}/publishing/queue-url`);
}

function resolveTargetQueue(context: QueueContext, configuredTarget: string | undefined) {
  const originalQueueName = configuredTarget
    ? configuredTarget.split('/').pop() || ''
    : context.queueName.replace(/-dlq$/i, '');
  const queueUrl =
    configuredTarget ||
    `https://sqs.${context.region}.amazonaws.com/${context.accountId}/${originalQueueName}`;
  return { originalQueueName, queueUrl };
}

async function forwardDlqRecord(record: DlqRecord): Promise<boolean> {
  const context = parseQueueContext(record);
  if (!context) {
    return false;
  }

  const configuredTarget = await resolveConfiguredTargetQueueUrl();
  const { originalQueueName, queueUrl } = resolveTargetQueue(context, configuredTarget);

  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: record.body,
      MessageAttributes: record.messageAttributes as
        | Record<string, MessageAttributeValue>
        | undefined,
    })
  );

  console.warn('Forwarded DLQ message to original queue', {
    messageId: record.messageId,
    originalQueueName,
    targetQueueUrl: queueUrl,
  });
  return true;
}

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
      const didForward = await forwardDlqRecord(record);
      if (didForward) {
        forwarded += 1;
      }
    } catch (error) {
      console.error('Failed to forward DLQ message', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
        configuredRetryQueue: process.env.RETRY_QUEUE_URL,
        configuredPublishingQueue: process.env.PUBLISHING_QUEUE_URL,
      });
      captureException(error, {
        function: 'dlq-processor',
        messageId: record.messageId,
      });
      // Throwing will cause Lambda to report a failure and DLQ message to remain for retry/visibility timeout
      throw error;
    }
  }

  return { processed, forwarded };
};
