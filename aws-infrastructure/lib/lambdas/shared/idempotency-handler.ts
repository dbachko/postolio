/**
 * Idempotency Handler
 * Prevents duplicate processing of messages and duplicate posts to social platforms
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { Logger } from '@aws-lambda-powertools/logger'
import { createHash } from 'crypto'

const logger = new Logger({ serviceName: 'idempotency' })

export enum IdempotencyStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

export interface IdempotencyRecord {
  idempotencyKey: string
  status: IdempotencyStatus
  result?: any
  error?: string
  startedAt: string
  completedAt?: string
  ttl: number
  retryCount: number
  messageId?: string
  contentId?: string
  platform?: string
}

export interface IdempotencyConfig {
  tableName: string
  ttlSeconds?: number        // How long to keep idempotency records
  inProgressTtlSeconds?: number  // How long to wait for in-progress operations
  maxRetries?: number        // Maximum retry attempts
}

export class IdempotencyHandler {
  private readonly ttlSeconds: number
  private readonly inProgressTtlSeconds: number
  private readonly maxRetries: number

  constructor(
    private docClient: DynamoDBDocumentClient,
    private config: IdempotencyConfig
  ) {
    this.ttlSeconds = config.ttlSeconds || 86400 // 24 hours default
    this.inProgressTtlSeconds = config.inProgressTtlSeconds || 300 // 5 minutes default
    this.maxRetries = config.maxRetries || 3
  }

  /**
   * Generate idempotency key from request data
   */
  generateKey(data: {
    contentId: string
    platform: string
    brandId: string
    scheduledAt?: string
  }): string {
    const keyData = `${data.contentId}-${data.platform}-${data.brandId}-${data.scheduledAt || 'immediate'}`
    return createHash('sha256').update(keyData).digest('hex')
  }

  /**
   * Process request with idempotency guarantee
   */
  async processWithIdempotency<T>(
    idempotencyKey: string,
    messageId: string,
    handler: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    // Check for existing record
    const existingRecord = await this.getRecord(idempotencyKey)

    if (existingRecord) {
      return this.handleExistingRecord<T>(existingRecord, idempotencyKey)
    }

    // Create new in-progress record
    await this.createInProgressRecord(idempotencyKey, messageId, metadata)

    try {
      // Execute the handler
      const result = await handler()

      // Mark as completed
      await this.markCompleted(idempotencyKey, result)

      logger.info('Successfully processed with idempotency', {
        idempotencyKey,
        messageId,
      })

      return result
    } catch (error) {
      // Mark as failed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await this.markFailed(idempotencyKey, errorMessage)

      logger.error('Failed to process with idempotency', {
        idempotencyKey,
        messageId,
        error: errorMessage,
      })

      throw error
    }
  }

  /**
   * Handle existing idempotency record
   */
  private async handleExistingRecord<T>(
    record: IdempotencyRecord,
    idempotencyKey: string
  ): Promise<T> {
    switch (record.status) {
      case IdempotencyStatus.COMPLETED:
        logger.info('Idempotent request already completed', {
          idempotencyKey,
          completedAt: record.completedAt,
        })
        return record.result as T

      case IdempotencyStatus.IN_PROGRESS:
        // Check if in-progress operation has expired
        const startTime = new Date(record.startedAt).getTime()
        const now = Date.now()
        const elapsed = (now - startTime) / 1000

        if (elapsed > this.inProgressTtlSeconds) {
          logger.warn('In-progress operation expired, retrying', {
            idempotencyKey,
            elapsed,
            ttl: this.inProgressTtlSeconds,
          })
          
          // Mark as expired and allow retry
          await this.markExpired(idempotencyKey)
          throw new IdempotencyError(
            'Previous operation expired, please retry',
            'OPERATION_EXPIRED'
          )
        }

        // Still in progress, reject duplicate
        throw new IdempotencyError(
          'Operation already in progress',
          'DUPLICATE_IN_PROGRESS'
        )

      case IdempotencyStatus.FAILED:
        // Check retry count
        if (record.retryCount >= this.maxRetries) {
          throw new IdempotencyError(
            `Operation failed after ${record.retryCount} attempts: ${record.error}`,
            'MAX_RETRIES_EXCEEDED'
          )
        }

        // Allow retry
        logger.info('Retrying failed operation', {
          idempotencyKey,
          retryCount: record.retryCount,
          previousError: record.error,
        })
        
        throw new IdempotencyError(
          'Previous operation failed, please retry',
          'RETRY_ALLOWED'
        )

      case IdempotencyStatus.EXPIRED:
        throw new IdempotencyError(
          'Operation expired, please retry',
          'OPERATION_EXPIRED'
        )

      default:
        throw new IdempotencyError(
          `Unknown idempotency status: ${record.status}`,
          'UNKNOWN_STATUS'
        )
    }
  }

  /**
   * Get idempotency record from DynamoDB
   */
  private async getRecord(idempotencyKey: string): Promise<IdempotencyRecord | null> {
    try {
      const result = await this.docClient.send(new GetCommand({
        TableName: this.config.tableName,
        Key: { idempotencyKey },
      }))

      return result.Item as IdempotencyRecord | null
    } catch (error) {
      logger.error('Failed to get idempotency record', {
        idempotencyKey,
        error,
      })
      return null
    }
  }

  /**
   * Create in-progress idempotency record
   */
  private async createInProgressRecord(
    idempotencyKey: string,
    messageId: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const now = new Date().toISOString()
    const ttl = Math.floor(Date.now() / 1000) + this.ttlSeconds

    try {
      await this.docClient.send(new PutCommand({
        TableName: this.config.tableName,
        Item: {
          idempotencyKey,
          status: IdempotencyStatus.IN_PROGRESS,
          startedAt: now,
          ttl,
          retryCount: 0,
          messageId,
          ...metadata,
        },
        ConditionExpression: 'attribute_not_exists(idempotencyKey)',
      }))
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Record already exists, fetch and handle it
        const existingRecord = await this.getRecord(idempotencyKey)
        if (existingRecord) {
          await this.handleExistingRecord(existingRecord, idempotencyKey)
        }
      }
      throw error
    }
  }

  /**
   * Mark operation as completed
   */
  private async markCompleted(idempotencyKey: string, result: any): Promise<void> {
    const now = new Date().toISOString()

    await this.docClient.send(new UpdateCommand({
      TableName: this.config.tableName,
      Key: { idempotencyKey },
      UpdateExpression: 'SET #status = :status, completedAt = :completedAt, #result = :result',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#result': 'result',
      },
      ExpressionAttributeValues: {
        ':status': IdempotencyStatus.COMPLETED,
        ':completedAt': now,
        ':result': result,
      },
    }))
  }

  /**
   * Mark operation as failed
   */
  private async markFailed(idempotencyKey: string, error: string): Promise<void> {
    const now = new Date().toISOString()

    await this.docClient.send(new UpdateCommand({
      TableName: this.config.tableName,
      Key: { idempotencyKey },
      UpdateExpression: 'SET #status = :status, completedAt = :completedAt, #error = :error, retryCount = retryCount + :inc',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#error': 'error',
      },
      ExpressionAttributeValues: {
        ':status': IdempotencyStatus.FAILED,
        ':completedAt': now,
        ':error': error,
        ':inc': 1,
      },
    }))
  }

  /**
   * Mark operation as expired
   */
  private async markExpired(idempotencyKey: string): Promise<void> {
    await this.docClient.send(new UpdateCommand({
      TableName: this.config.tableName,
      Key: { idempotencyKey },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': IdempotencyStatus.EXPIRED,
      },
    }))
  }

  /**
   * Clean up old records (for maintenance)
   */
  async cleanupExpiredRecords(): Promise<number> {
    // This would be better implemented as a DynamoDB TTL
    // but provided here for manual cleanup if needed
    logger.info('Cleanup of expired records should be handled by DynamoDB TTL')
    return 0
  }
}

export class IdempotencyError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'IdempotencyError'
  }
}

/**
 * Helper function to create idempotency handler with standard config
 */
export function createIdempotencyHandler(
  docClient: DynamoDBDocumentClient,
  tableName: string
): IdempotencyHandler {
  return new IdempotencyHandler(docClient, {
    tableName,
    ttlSeconds: 86400,        // 24 hours
    inProgressTtlSeconds: 300, // 5 minutes
    maxRetries: 3,
  })
}