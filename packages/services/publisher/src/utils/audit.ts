import { Logger } from '@aws-lambda-powertools/logger';
import {
  type DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ScheduleRecord } from '../types';

const logger = new Logger({ serviceName: 'publisher' });

export async function logAudit(
  docClient: DynamoDBDocumentClient,
  scheduleId: string,
  action: string,
  result: 'success' | 'failure',
  details?: Record<string, unknown>
): Promise<void> {
  const tableName = process.env.AUDIT_LOG_TABLE;
  if (!tableName) {
    logger.debug('Audit log table not configured; skipping audit', { action, scheduleId });
    return;
  }

  try {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: `AUDIT#${scheduleId}`,
          sk: `${Date.now()}#${action}`,
          scheduleId,
          action,
          result,
          details,
          timestamp: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
        },
      })
    );
  } catch (auditError) {
    logger.warn('Failed to write to audit log (ignored)', {
      scheduleId,
      action,
      error: (auditError as Error).message,
    });
  }
}

export async function getSchedule(
  docClient: DynamoDBDocumentClient,
  scheduleId: string
): Promise<ScheduleRecord | undefined> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      IndexName: process.env.SCHEDULES_TABLE_SCHEDULE_INDEX || 'ScheduleIdIndex',
      KeyConditionExpression: 'scheduleId = :sid',
      ExpressionAttributeValues: {
        ':sid': scheduleId,
      },
      Limit: 1,
    })
  );

  const item = result.Items?.[0] as Record<string, unknown> | undefined;
  if (!item) {
    return undefined;
  }
  if (typeof item.platform !== 'string') {
    logger.warn('Schedule item missing platform field', { scheduleId });
    return undefined;
  }

  return item as ScheduleRecord;
}

interface UpdateExpressionParts {
  setParts: string[];
  removeParts: string[];
  expressionAttributeNames: Record<string, string>;
  expressionAttributeValues: Record<string, string>;
}

interface UpdateScheduleStatusMetadata {
  errorMessage?: string;
  platformPostId?: string;
  platformUrl?: string;
}

function ensureExpressionName(
  expressionAttributeNames: Record<string, string>,
  token: string,
  targetField: string
): void {
  if (!expressionAttributeNames[token]) {
    expressionAttributeNames[token] = targetField;
  }
}

function buildExpressionAttributeNames(
  setParts: string[],
  removeParts: string[]
): Record<string, string> {
  const expressionAttributeNames: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
  };

  if (setParts.some((part) => part.includes('#error')) || removeParts.includes('#error')) {
    ensureExpressionName(expressionAttributeNames, '#error', 'schedulingError');
  }

  if (setParts.some((part) => part.includes('#errorType')) || removeParts.includes('#errorType')) {
    ensureExpressionName(expressionAttributeNames, '#errorType', 'errorType');
  }

  if (setParts.some((part) => part.includes('#publishedAt'))) {
    ensureExpressionName(expressionAttributeNames, '#publishedAt', 'publishedAt');
  }

  if (setParts.some((part) => part.includes('#platformPostId'))) {
    ensureExpressionName(expressionAttributeNames, '#platformPostId', 'platformPostId');
  }

  if (setParts.some((part) => part.includes('#platformUrl'))) {
    ensureExpressionName(expressionAttributeNames, '#platformUrl', 'platformUrl');
  }

  return expressionAttributeNames;
}

function buildExpressionAttributeValues(
  status: string,
  metadata: UpdateScheduleStatusMetadata
): Record<string, string> {
  const expressionAttributeValues: Record<string, string> = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  };

  if (metadata.errorMessage) {
    expressionAttributeValues[':error'] = metadata.errorMessage;
    return expressionAttributeValues;
  }

  if (status === 'published') {
    expressionAttributeValues[':publishedAt'] = new Date().toISOString();
    if (metadata.platformPostId) {
      expressionAttributeValues[':platformPostId'] = metadata.platformPostId;
    }
    if (metadata.platformUrl) {
      expressionAttributeValues[':platformUrl'] = metadata.platformUrl;
    }
  }

  return expressionAttributeValues;
}

function buildUpdateExpressionParts(
  status: string,
  metadata: UpdateScheduleStatusMetadata
): UpdateExpressionParts {
  const setParts: string[] = ['#status = :status', '#updatedAt = :updatedAt'];
  const removeParts: string[] = [];

  if (metadata.errorMessage) {
    setParts.push('#error = :error');
  } else {
    removeParts.push('#error', '#errorType');

    if (status === 'published') {
      setParts.push('#publishedAt = :publishedAt');
      if (metadata.platformPostId) {
        setParts.push('#platformPostId = :platformPostId');
      }
      if (metadata.platformUrl) {
        setParts.push('#platformUrl = :platformUrl');
      }
    }
  }

  const expressionAttributeNames = buildExpressionAttributeNames(setParts, removeParts);
  const expressionAttributeValues = buildExpressionAttributeValues(status, metadata);

  return {
    setParts,
    removeParts,
    expressionAttributeNames,
    expressionAttributeValues,
  };
}

function buildUpdateExpression(setParts: string[], removeParts: string[]): string {
  if (!removeParts.length) {
    return `SET ${setParts.join(', ')}`;
  }

  return `SET ${setParts.join(', ')} REMOVE ${removeParts.join(', ')}`;
}

export async function updateScheduleStatus(
  docClient: DynamoDBDocumentClient,
  scheduleId: string,
  status: string,
  metadata: UpdateScheduleStatusMetadata = {}
): Promise<void> {
  try {
    const schedule = await getSchedule(docClient, scheduleId);
    if (!schedule || !('pk' in schedule) || !('sk' in schedule)) {
      logger.warn('Cannot update schedule status; schedule not found or missing keys', {
        scheduleId,
        status,
      });
      return;
    }

    const expression = buildUpdateExpressionParts(status, metadata);

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: {
          pk: schedule.pk,
          sk: schedule.sk,
        },
        UpdateExpression: buildUpdateExpression(expression.setParts, expression.removeParts),
        ExpressionAttributeNames: expression.expressionAttributeNames,
        ExpressionAttributeValues: expression.expressionAttributeValues,
      })
    );

    await logAudit(docClient, scheduleId, `status_update_${status}`, 'success', metadata);
  } catch (error) {
    logger.warn('Failed to update schedule status (ignored)', {
      scheduleId,
      status,
      error: (error as Error).message,
    });
  }
}

export async function updateFirstCommentStatus(
  docClient: DynamoDBDocumentClient,
  scheduleId: string,
  status: string,
  commentId?: string,
  error?: string
): Promise<void> {
  try {
    const schedule = await getSchedule(docClient, scheduleId);
    if (!schedule || !('pk' in schedule) || !('sk' in schedule)) {
      logger.warn('Cannot update first comment status; schedule not found', {
        scheduleId,
        status,
      });
      return;
    }

    const setParts: string[] = ['#firstCommentStatus = :status'];
    const values: Record<string, string> = { ':status': status };

    if (status === 'posted' && commentId) {
      setParts.push('#firstCommentPostedAt = :postedAt');
      values[':postedAt'] = new Date().toISOString();
    }
    if (error) {
      setParts.push('#firstCommentError = :error');
      values[':error'] = error;
    }

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: { pk: schedule.pk, sk: schedule.sk },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: {
          '#firstCommentStatus': 'firstCommentStatus',
          '#firstCommentPostedAt': 'firstCommentPostedAt',
          '#firstCommentError': 'firstCommentError',
        },
        ExpressionAttributeValues: values,
      })
    );

    logger.info('Updated first comment status', { scheduleId, status });
  } catch (e) {
    logger.warn('Failed to update first comment status', {
      scheduleId,
      status,
      error: (e as Error).message,
    });
  }
}
