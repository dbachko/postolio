import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { BRAND_LEARNING_SIGNALS_TABLE, learningPk, learningSk } from './tables';

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } });

export interface LearningSignalItem {
  brandId: string;
  id: string;
  createdAt: string; // ISO
  insights?: Array<{
    pattern: string;
    confidence: number;
    category: string;
    recommendation?: string;
  }>; // small array
  profileUpdates?: Array<{
    field: string;
    newValue: unknown;
    confidence?: number;
    reasoning?: string;
  }>;
  appliedToFuturePosts?: number;
  editAnalysis?: unknown; // optional; can be large; keep minimal
  triggeredBy?: { userId?: string; contentId?: string };
}

export class LearningRepository {
  async putSignal(
    brandId: string,
    payload: Omit<LearningSignalItem, 'brandId' | 'id' | 'createdAt'>
  ) {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const item = {
      PK: learningPk(brandId),
      SK: learningSk(createdAt, id),
      brandId,
      id,
      createdAt,
      insights: payload.insights?.slice(0, 20),
      profileUpdates: payload.profileUpdates?.slice(0, 50),
      appliedToFuturePosts: payload.appliedToFuturePosts,
      // Avoid storing huge editAnalysis payloads: keep only top-level keys if object
      editAnalysis:
        payload.editAnalysis && typeof payload.editAnalysis === 'object'
          ? { ...(payload.editAnalysis as Record<string, unknown>) }
          : undefined,
      triggeredBy: payload.triggeredBy,
    };
    await doc.send(
      new PutCommand({
        TableName: BRAND_LEARNING_SIGNALS_TABLE,
        Item: item,
      })
    );
    return { id, createdAt };
  }

  async listRecentSignals(
    brandId: string,
    limit: number = 20
  ): Promise<Array<Pick<LearningSignalItem, 'insights' | 'profileUpdates' | 'createdAt'>>> {
    // In unit tests or local scripts without AWS region/creds, skip querying and return empty
    if (!process.env.AWS_REGION) {
      return [];
    }

    let res: { Items?: Array<Record<string, unknown>> } = {};
    try {
      res = (await doc.send(
        new QueryCommand({
          TableName: BRAND_LEARNING_SIGNALS_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': learningPk(brandId) },
          ScanIndexForward: false,
          Limit: limit,
        })
      )) as { Items?: Array<Record<string, unknown>> };
    } catch {
      // Fail-closed: if Dynamo is unavailable (e.g., in tests), treat as no signals
      return [];
    }
    type LearningSignalRow = {
      createdAt?: string;
      insights?: LearningSignalItem['insights'];
      profileUpdates?: LearningSignalItem['profileUpdates'];
    };
    return (res.Items || []).map((it) => {
      const row = it as unknown as LearningSignalRow;
      const createdAt =
        typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString();
      const insights = Array.isArray(row.insights) ? row.insights : [];
      const profileUpdates = Array.isArray(row.profileUpdates) ? row.profileUpdates : [];
      return { insights, profileUpdates, createdAt };
    });
  }
}
