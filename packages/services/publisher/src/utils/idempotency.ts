import { type DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { PublishMarker } from '../types';

export async function getPublishMarker(
  docClient: DynamoDBDocumentClient,
  scheduleId: string
): Promise<PublishMarker | null> {
  const table = process.env.RETRY_QUEUE_TABLE;
  if (!table) {
    return null;
  }
  const res = await docClient.send(
    new GetCommand({
      TableName: table,
      Key: { scheduleId, attemptNumber: 0 },
    })
  );
  return (res.Item as PublishMarker | undefined) || null;
}

export async function writePublishMarker(
  docClient: DynamoDBDocumentClient,
  scheduleId: string,
  platformPostId?: string,
  permalink?: string
): Promise<void> {
  const table = process.env.RETRY_QUEUE_TABLE;
  if (!table) {
    return;
  }
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        scheduleId,
        attemptNumber: 0,
        type: 'published',
        platformPostId,
        permalink,
        timestamp: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
      },
      ConditionExpression:
        'attribute_not_exists(scheduleId) AND attribute_not_exists(attemptNumber)',
    })
  );
}
