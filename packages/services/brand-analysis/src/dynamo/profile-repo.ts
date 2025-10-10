import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { BRAND_STYLE_PROFILES_TABLE, profilePk, profileSk } from './tables';

export interface BrandStyleProfile {
  brandId: string;
  profileId: string; // `${brandId}#${version}`
  version: number;
  createdAt: string;
  promptSetVersion: string;
  dataQuality?: 'SUFFICIENT' | 'LIMITED' | 'INSUFFICIENT';
  profile: Record<string, unknown>;
  driftFindings?: unknown[];
}

export class ProfileRepository {
  private doc: DynamoDBDocumentClient;

  constructor(client?: DynamoDBDocumentClient) {
    const dynamo = client || DynamoDBDocumentClient.from(new DynamoDBClient({}));
    this.doc = dynamo;
  }

  async putProfile(item: BrandStyleProfile): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: BRAND_STYLE_PROFILES_TABLE,
        Item: {
          PK: profilePk(item.brandId),
          SK: profileSk(item.version),
          ...item,
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      })
    );
  }

  async getLatest(brandId: string): Promise<BrandStyleProfile | null> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: BRAND_STYLE_PROFILES_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': profilePk(brandId) },
        ScanIndexForward: false,
        Limit: 1,
      })
    );
    const raw = res.Items?.[0];
    if (!raw) return null;
    const rest = { ...(raw as Record<string, unknown>) } as Record<string, unknown>;
    delete (rest as Record<string, unknown>)['PK'];
    delete (rest as Record<string, unknown>)['SK'];
    return rest as unknown as BrandStyleProfile;
  }

  async list(brandId: string, limit = 20, cursor?: string) {
    const params: QueryCommandInput = {
      TableName: BRAND_STYLE_PROFILES_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': profilePk(brandId) },
      ScanIndexForward: false,
      Limit: limit,
    };
    if (cursor)
      (params as Record<string, unknown>).ExclusiveStartKey = JSON.parse(
        Buffer.from(cursor, 'base64').toString('utf8')
      );
    const res = await this.doc.send(new QueryCommand(params));
    return {
      items: (res.Items || []).map((it) => {
        const o = { ...(it as Record<string, unknown>) };
        delete o['PK'];
        delete o['SK'];
        return o as unknown as BrandStyleProfile;
      }),
      nextCursor: res.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64')
        : undefined,
    };
  }
}
