import { Logger } from '@aws-lambda-powertools/logger';
import {
  DynamoDBDocumentClient,
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

  const item = (result.Items && result.Items[0]) as Record<string, unknown> | undefined;
  if (!item) return undefined;
  if (typeof item.platform !== 'string') {
    logger.warn('Schedule item missing platform field', { scheduleId });
    return undefined;
  }
  return item as ScheduleRecord;
}

export async function updateScheduleStatus(
  docClient: DynamoDBDocumentClient,
  scheduleId: string,
  status: string,
  errorMessage?: string,
  platformPostId?: string,
  platformUrl?: string
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
    const setParts: string[] = ['#status = :status', '#updatedAt = :updatedAt'];
    const removeParts: string[] = [];

    if (errorMessage) {
      setParts.push('#error = :error');
    } else {
      removeParts.push('#error', '#errorType');

      if (status === 'published') {
        setParts.push('#publishedAt = :publishedAt');
        if (platformPostId) setParts.push('#platformPostId = :platformPostId');
        if (platformUrl) setParts.push('#platformUrl = :platformUrl');
      }
    }

    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
    };

    if (
      setParts.some((p) => p.includes('#error')) ||
      removeParts.some((p) => p.includes('#error'))
    ) {
      expressionAttributeNames['#error'] = 'schedulingError';
    }
    if (
      setParts.some((p) => p.includes('#errorType')) ||
      removeParts.some((p) => p.includes('#errorType'))
    ) {
      expressionAttributeNames['#errorType'] = 'errorType';
    }
    if (
      setParts.some((p) => p.includes('#publishedAt')) ||
      removeParts.some((p) => p.includes('#publishedAt'))
    ) {
      expressionAttributeNames['#publishedAt'] = 'publishedAt';
    }
    if (
      setParts.some((p) => p.includes('#platformPostId')) ||
      removeParts.some((p) => p.includes('#platformPostId'))
    ) {
      expressionAttributeNames['#platformPostId'] = 'platformPostId';
    }
    if (
      setParts.some((p) => p.includes('#platformUrl')) ||
      removeParts.some((p) => p.includes('#platformUrl'))
    ) {
      expressionAttributeNames['#platformUrl'] = 'platformUrl';
    }

    const expressionAttributeValues: Record<string, string> = {
      ':status': status,
      ':updatedAt': new Date().toISOString(),
    };

    if (errorMessage) {
      expressionAttributeValues[':error'] = errorMessage;
    } else if (status === 'published') {
      expressionAttributeValues[':publishedAt'] = new Date().toISOString();
      if (platformPostId) expressionAttributeValues[':platformPostId'] = platformPostId;
      if (platformUrl) expressionAttributeValues[':platformUrl'] = platformUrl;
    }

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: {
          pk: schedule.pk,
          sk: schedule.sk,
        },
        UpdateExpression: `SET ${setParts.join(', ')}${
          removeParts.length ? ' REMOVE ' + removeParts.join(', ') : ''
        }`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );

    await logAudit(docClient, scheduleId, `status_update_${status}`, 'success', {
      errorMessage,
      platformPostId,
      platformUrl,
    });
  } catch (e) {
    logger.warn('Failed to update schedule status (ignored)', {
      scheduleId,
      status,
      error: (e as Error).message,
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
