import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { KMSClient, DecryptCommand, EncryptCommand } from '@aws-sdk/client-kms'
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import axios from 'axios'

export interface TokenRefreshHandlerOptions {
  docClient: DynamoDBDocumentClient
  kmsClient: KMSClient
  eventBridgeClient: EventBridgeClient
  tokenTableName: string
  kmsKeyId: string
  eventBusName: string
}

export interface Token {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  needsRefresh: boolean
}

export class TokenRefreshHandler {
  constructor(private options: TokenRefreshHandlerOptions) {}

  async getToken(userId: string, brandId: string, platform: string): Promise<Token | null> {
    try {
      const result = await this.options.docClient.send(new GetCommand({
        TableName: this.options.tokenTableName,
        Key: {
          pk: `${userId}#${platform}`,
          sk: brandId,
        },
      }))

      if (!result.Item) {
        return null
      }

      // Decrypt tokens
      const accessToken = await this.decryptData(result.Item.encryptedAccessToken)
      const refreshToken = result.Item.encryptedRefreshToken 
        ? await this.decryptData(result.Item.encryptedRefreshToken)
        : undefined

      // Check if token needs refresh (within 1 hour of expiry)
      const needsRefresh = result.Item.expiresAt < (Date.now() + 3600000)

      return {
        accessToken,
        refreshToken,
        expiresAt: result.Item.expiresAt,
        needsRefresh,
      }
    } catch (error) {
      console.error('Failed to get token', { userId, brandId, platform, error })
      return null
    }
  }

  async storeToken(
    userId: string,
    brandId: string,
    platform: string,
    token: {
      accessToken: string
      refreshToken?: string
      expiresIn: number
    }
  ): Promise<void> {
    const encryptedAccessToken = await this.encryptData(token.accessToken)
    const encryptedRefreshToken = token.refreshToken 
      ? await this.encryptData(token.refreshToken)
      : undefined
    
    const expiresAt = Date.now() + (token.expiresIn * 1000)
    const ttl = Math.floor(expiresAt / 1000) + 86400 // 1 day after expiry

    await this.options.docClient.send(new PutCommand({
      TableName: this.options.tokenTableName,
      Item: {
        pk: `${userId}#${platform}`,
        sk: brandId,
        platform,
        encryptedAccessToken,
        encryptedRefreshToken,
        expiresAt,
        lastRefreshed: new Date().toISOString(),
        ttl,
      },
    }))
  }

  async refreshToken(
    userId: string,
    brandId: string,
    platform: string,
    refreshFunction: (refreshToken: string) => Promise<any>
  ): Promise<Token | null> {
    const token = await this.getToken(userId, brandId, platform)
    if (!token || !token.refreshToken) {
      return null
    }

    try {
      const newTokenData = await refreshFunction(token.refreshToken)
      
      await this.storeToken(userId, brandId, platform, {
        accessToken: newTokenData.access_token,
        refreshToken: newTokenData.refresh_token || token.refreshToken,
        expiresIn: newTokenData.expires_in,
      })

      // Emit token refreshed event
      await this.options.eventBridgeClient.send(new PutEventsCommand({
        Entries: [{
          Source: 'postolio.token',
          DetailType: 'token.refreshed',
          Detail: JSON.stringify({
            userId,
            brandId,
            platform,
            refreshedAt: new Date().toISOString(),
          }),
          EventBusName: this.options.eventBusName,
        }],
      }))

      return {
        accessToken: newTokenData.access_token,
        refreshToken: newTokenData.refresh_token || token.refreshToken,
        expiresAt: Date.now() + (newTokenData.expires_in * 1000),
        needsRefresh: false,
      }
    } catch (error) {
      console.error('Token refresh failed', { userId, brandId, platform, error })
      
      // Emit token refresh failed event
      await this.options.eventBridgeClient.send(new PutEventsCommand({
        Entries: [{
          Source: 'postolio.token',
          DetailType: 'token.refresh.failed',
          Detail: JSON.stringify({
            userId,
            brandId,
            platform,
            error: error instanceof Error ? error.message : 'Unknown error',
            failedAt: new Date().toISOString(),
          }),
          EventBusName: this.options.eventBusName,
        }],
      }))

      return null
    }
  }

  private async encryptData(data: string): Promise<string> {
    const result = await this.options.kmsClient.send(new EncryptCommand({
      KeyId: this.options.kmsKeyId,
      Plaintext: Buffer.from(data),
    }))
    return Buffer.from(result.CiphertextBlob!).toString('base64')
  }

  private async decryptData(encryptedData: string): Promise<string> {
    const result = await this.options.kmsClient.send(new DecryptCommand({
      CiphertextBlob: Buffer.from(encryptedData, 'base64'),
    }))
    return Buffer.from(result.Plaintext!).toString('utf-8')
  }
}
