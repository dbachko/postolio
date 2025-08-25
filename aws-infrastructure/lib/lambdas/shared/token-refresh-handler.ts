/**
 * Shared Token Refresh Handler
 * Securely handles token refresh and storage across all publisher services
 */

import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { KMSClient, EncryptCommand } from '@aws-sdk/client-kms'
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { Logger } from '@aws-lambda-powertools/logger'

const logger = new Logger({ serviceName: 'token-refresh' })

interface RefreshedToken {
  accessToken: string
  refreshToken?: string
  expiresIn: number
}

interface TokenRefreshOptions {
  docClient: DynamoDBDocumentClient
  kmsClient: KMSClient
  eventBridgeClient: EventBridgeClient
  tokenTableName: string
  kmsKeyId: string
  eventBusName: string
}

export class TokenRefreshHandler {
  constructor(private options: TokenRefreshOptions) {}

  /**
   * Securely store refreshed token in DynamoDB
   * NEVER logs token values
   */
  async storeRefreshedToken(
    userId: string,
    brandId: string,
    platform: string,
    token: RefreshedToken
  ): Promise<void> {
    try {
      // Log the action but NEVER the token values
      logger.info('Storing refreshed token', {
        userId,
        brandId,
        platform,
        // Only log non-sensitive metadata
        expiresIn: token.expiresIn,
        hasRefreshToken: !!token.refreshToken,
      })

      // Encrypt tokens
      const encryptedAccessToken = await this.encryptData(token.accessToken)
      const encryptedRefreshToken = token.refreshToken
        ? await this.encryptData(token.refreshToken)
        : undefined

      // Calculate expiry
      const expiresAt = Date.now() + (token.expiresIn * 1000)

      // Update token in database
      await this.options.docClient.send(new UpdateCommand({
        TableName: this.options.tokenTableName,
        Key: {
          pk: `${userId}#${platform}`,
          sk: brandId,
        },
        UpdateExpression: 'SET encryptedAccessToken = :accessToken, expiresAt = :expiresAt, lastRefreshed = :lastRefreshed'
          + (encryptedRefreshToken ? ', encryptedRefreshToken = :refreshToken' : ''),
        ExpressionAttributeValues: {
          ':accessToken': encryptedAccessToken,
          ':expiresAt': expiresAt,
          ':lastRefreshed': new Date().toISOString(),
          ...(encryptedRefreshToken && { ':refreshToken': encryptedRefreshToken }),
        },
      }))

      // Send success event
      await this.sendEvent('token.refreshed', {
        userId,
        brandId,
        platform,
        expiresAt,
        timestamp: new Date().toISOString(),
      })

      logger.info('Token refreshed successfully', {
        userId,
        brandId,
        platform,
        expiresAt: new Date(expiresAt).toISOString(),
      })
    } catch (error) {
      logger.error('Failed to store refreshed token', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        brandId,
        platform,
      })

      // Send failure event
      await this.sendEvent('token.refresh.failed', {
        userId,
        brandId,
        platform,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      })

      throw error
    }
  }

  private async encryptData(data: string): Promise<string> {
    const result = await this.options.kmsClient.send(new EncryptCommand({
      KeyId: this.options.kmsKeyId,
      Plaintext: Buffer.from(data),
    }))

    return Buffer.from(result.CiphertextBlob!).toString('base64')
  }

  private async sendEvent(detailType: string, detail: any): Promise<void> {
    await this.options.eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'postolio.token-manager',
        DetailType: detailType,
        Detail: JSON.stringify(detail),
        EventBusName: this.options.eventBusName,
      }],
    }))
  }
}