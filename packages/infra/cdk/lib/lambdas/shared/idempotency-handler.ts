import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

export class IdempotencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyError";
  }
}

export interface IdempotencyOptions {
  tableName: string;
  keyField?: string;
  ttlSeconds?: number;
}

export class IdempotencyHandler {
  private keyField: string;
  private ttlSeconds: number;

  constructor(
    private docClient: DynamoDBDocumentClient,
    private options: IdempotencyOptions,
  ) {
    this.keyField = options.keyField || "idempotencyKey";
    this.ttlSeconds = options.ttlSeconds || 86400; // 24 hours default
  }

  async checkAndRecord(key: string, data: any): Promise<boolean> {
    try {
      // Check if key exists
      const getResult = await this.docClient.send(
        new GetCommand({
          TableName: this.options.tableName,
          Key: { [this.keyField]: key },
        }),
      );

      if (getResult.Item) {
        // Key exists, check if it's the same request
        if (JSON.stringify(getResult.Item.data) === JSON.stringify(data)) {
          // Same request, return success
          return false; // Don't process again
        } else {
          // Different request with same key
          throw new IdempotencyError(
            `Different request with same idempotency key: ${key}`,
          );
        }
      }

      // Record new request
      const ttl = Math.floor(Date.now() / 1000) + this.ttlSeconds;
      await this.docClient.send(
        new PutCommand({
          TableName: this.options.tableName,
          Item: {
            [this.keyField]: key,
            data,
            createdAt: new Date().toISOString(),
            ttl,
          },
          ConditionExpression: `attribute_not_exists(${this.keyField})`,
        }),
      );

      return true; // Process this request
    } catch (error: any) {
      if (error.name === "ConditionalCheckFailedException") {
        // Race condition - another process recorded the key
        return false; // Don't process again
      }
      throw error;
    }
  }

  async markComplete(key: string, result: any): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    await this.docClient.send(
      new PutCommand({
        TableName: this.options.tableName,
        Item: {
          [this.keyField]: key,
          result,
          completedAt: new Date().toISOString(),
          ttl,
        },
      }),
    );
  }
}
