import type { Logger } from '@aws-lambda-powertools/logger';
import { MetricUnit, type Metrics } from '@aws-lambda-powertools/metrics';
import { PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const MAX_RETRY_ATTEMPTS = 5;

export function resolveUserFacingReason(reason: string, originalError?: Error | unknown): string {
  const rawOriginalMessage =
    originalError instanceof Error ? originalError.message : String(originalError || '');

  if (reason !== 'Non-retryable error type' || !rawOriginalMessage) {
    return reason;
  }

  const lower = rawOriginalMessage.toLowerCase();
  if (lower.includes('token not found')) {
    return 'Account token not found. Please reconnect your account in Settings.';
  }

  if (lower.includes('media could not be fetched') || lower.includes('failed to create media')) {
    return 'Image URL not accessible by Instagram. Try again or regenerate the image.';
  }

  return rawOriginalMessage;
}

export async function writeFailureAuditLog(
  docClient: DynamoDBDocumentClient,
  logger: Logger,
  metrics: Metrics,
  scheduleId: string,
  reason: string
): Promise<void> {
  try {
    await docClient.send(
      new PutCommand({
        TableName: process.env.AUDIT_LOG_TABLE!,
        Item: {
          pk: `SCHEDULE#${scheduleId}`,
          timestamp: new Date().toISOString(),
          action: 'FAILED_AFTER_RETRIES',
          reason,
          metadata: {
            maxAttempts: MAX_RETRY_ATTEMPTS,
          },
        },
      })
    );
  } catch (auditError) {
    logger.warn('Failed to write to audit log but schedule marked as failed', {
      scheduleId,
      auditError: (auditError as Error).message,
    });
    metrics.addMetric('AuditLogWriteFailed', MetricUnit.Count, 1);
  }
}
