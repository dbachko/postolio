import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
export declare class IdempotencyError extends Error {
    constructor(message: string);
}
export interface IdempotencyOptions {
    tableName: string;
    keyField?: string;
    ttlSeconds?: number;
}
export declare class IdempotencyHandler {
    private docClient;
    private options;
    private keyField;
    private ttlSeconds;
    constructor(docClient: DynamoDBDocumentClient, options: IdempotencyOptions);
    checkAndRecord(key: string, data: any): Promise<boolean>;
    markComplete(key: string, result: any): Promise<void>;
}
