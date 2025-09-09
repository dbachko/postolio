import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { KMSClient, DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import axios from "axios";

/**
 * Configuration options for TokenRefreshHandler
 */
export interface TokenRefreshHandlerOptions {
  /** DynamoDB DocumentClient for token storage operations */
  docClient: DynamoDBDocumentClient;
  /** KMS client for token encryption/decryption */
  kmsClient: KMSClient;
  /** EventBridge client for emitting token events */
  eventBridgeClient: EventBridgeClient;
  /** Name of DynamoDB table storing tokens */
  tokenTableName: string;
  /** KMS key ID for token encryption */
  kmsKeyId: string;
  /** EventBridge event bus name for token events */
  eventBusName: string;
}

/**
 * Represents an OAuth token with metadata
 */
export interface Token {
  /** Access token for API authentication */
  accessToken: string;
  /** Optional refresh token for obtaining new access tokens */
  refreshToken?: string;
  /** Unix timestamp when token expires */
  expiresAt: number;
  /** Whether token needs refresh (within 1 hour of expiry) */
  needsRefresh: boolean;
}

/**
 * Handles secure OAuth token storage, retrieval, and refresh operations
 * with KMS encryption and EventBridge event emission
 *
 * @example
 * ```typescript
 * const handler = new TokenRefreshHandler({
 *   docClient,
 *   kmsClient,
 *   eventBridgeClient,
 *   tokenTableName: 'oauth-tokens',
 *   kmsKeyId: 'alias/token-encryption',
 *   eventBusName: 'postolio-events'
 * });
 *
 * const token = await handler.getToken('user123', 'brand456', 'instagram');
 * ```
 */
export class TokenRefreshHandler {
  constructor(private options: TokenRefreshHandlerOptions) {}

  /**
   * Retrieves and decrypts an OAuth token from DynamoDB
   *
   * @param userId - User ID owning the token
   * @param brandId - Brand ID associated with the token
   * @param platform - Social media platform (instagram, facebook, linkedin, tiktok)
   * @returns Decrypted token with metadata or null if not found
   *
   * @example
   * ```typescript
   * const token = await handler.getToken('user123', 'brand456', 'instagram');
   * if (token?.needsRefresh) {
   *   // Handle token refresh
   * }
   * ```
   */
  async getToken(
    userId: string,
    brandId: string,
    platform: string,
  ): Promise<Token | null> {
    try {
      const result = await this.options.docClient.send(
        new GetCommand({
          TableName: this.options.tokenTableName,
          Key: {
            pk: `${userId}#${platform}`,
            sk: brandId,
          },
        }),
      );

      if (!result.Item) {
        return null;
      }

      // Decrypt tokens
      const accessToken = await this.decryptData(
        result.Item.encryptedAccessToken,
      );
      const refreshToken = result.Item.encryptedRefreshToken
        ? await this.decryptData(result.Item.encryptedRefreshToken)
        : undefined;

      // Check if token needs refresh (within 1 hour of expiry)
      const needsRefresh = result.Item.expiresAt < Date.now() + 3600000;

      return {
        accessToken,
        refreshToken,
        expiresAt: result.Item.expiresAt,
        needsRefresh,
      };
    } catch (error) {
      console.error("Failed to get token", {
        userId,
        brandId,
        platform,
        error,
      });
      return null;
    }
  }

  /**
   * Encrypts and stores an OAuth token in DynamoDB with TTL
   *
   * @param userId - User ID owning the token
   * @param brandId - Brand ID associated with the token
   * @param platform - Social media platform (instagram, facebook, linkedin, tiktok)
   * @param token - Token data to store
   * @param token.accessToken - OAuth access token
   * @param token.refreshToken - Optional OAuth refresh token
   * @param token.expiresIn - Token expiry duration in seconds
   * @returns Promise that resolves when token is stored
   *
   * @example
   * ```typescript
   * await handler.storeToken('user123', 'brand456', 'instagram', {
   *   accessToken: 'IGQVJXeGVuYXl...',
   *   refreshToken: 'IGQVJYcGVuYXl...',
   *   expiresIn: 3600
   * });
   * ```
   */
  async storeToken(
    userId: string,
    brandId: string,
    platform: string,
    token: {
      accessToken: string;
      refreshToken?: string;
      expiresIn: number;
    },
  ): Promise<void> {
    const encryptedAccessToken = await this.encryptData(token.accessToken);
    const encryptedRefreshToken = token.refreshToken
      ? await this.encryptData(token.refreshToken)
      : undefined;

    const expiresAt = Date.now() + token.expiresIn * 1000;
    const ttl = Math.floor(expiresAt / 1000) + 86400; // 1 day after expiry

    await this.options.docClient.send(
      new PutCommand({
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
      }),
    );
  }

  /**
   * Refreshes an OAuth token using a platform-specific refresh function
   *
   * @param userId - User ID owning the token
   * @param brandId - Brand ID associated with the token
   * @param platform - Social media platform (instagram, facebook, linkedin, tiktok)
   * @param refreshFunction - Platform-specific function to refresh the token
   * @returns New token with updated access token and metadata, or null on failure
   *
   * @emits token.refreshed - On successful token refresh
   * @emits token.refresh.failed - On refresh failure
   *
   * @example
   * ```typescript
   * const newToken = await handler.refreshToken(
   *   'user123',
   *   'brand456',
   *   'instagram',
   *   async (refreshToken) => {
   *     const response = await fetch('https://graph.instagram.com/refresh_access_token', {
   *       method: 'GET',
   *       params: { grant_type: 'ig_refresh_token', access_token: refreshToken }
   *     });
   *     return response.data;
   *   }
   * );
   * ```
   */
  async refreshToken(
    userId: string,
    brandId: string,
    platform: string,
    refreshFunction: (refreshToken: string) => Promise<any>,
  ): Promise<Token | null> {
    const token = await this.getToken(userId, brandId, platform);
    if (!token || !token.refreshToken) {
      return null;
    }

    try {
      const newTokenData = await refreshFunction(token.refreshToken);

      await this.storeToken(userId, brandId, platform, {
        accessToken: newTokenData.access_token,
        refreshToken: newTokenData.refresh_token || token.refreshToken,
        expiresIn: newTokenData.expires_in,
      });

      // Emit token refreshed event
      await this.options.eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "postolio.token",
              DetailType: "token.refreshed",
              Detail: JSON.stringify({
                userId,
                brandId,
                platform,
                refreshedAt: new Date().toISOString(),
              }),
              EventBusName: this.options.eventBusName,
            },
          ],
        }),
      );

      return {
        accessToken: newTokenData.access_token,
        refreshToken: newTokenData.refresh_token || token.refreshToken,
        expiresAt: Date.now() + newTokenData.expires_in * 1000,
        needsRefresh: false,
      };
    } catch (error) {
      console.error("Token refresh failed", {
        userId,
        brandId,
        platform,
        error,
      });

      // Emit token refresh failed event
      await this.options.eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "postolio.token",
              DetailType: "token.refresh.failed",
              Detail: JSON.stringify({
                userId,
                brandId,
                platform,
                error: error instanceof Error ? error.message : "Unknown error",
                failedAt: new Date().toISOString(),
              }),
              EventBusName: this.options.eventBusName,
            },
          ],
        }),
      );

      return null;
    }
  }

  /**
   * Encrypts sensitive data using AWS KMS
   *
   * @private
   * @param data - Plain text data to encrypt
   * @returns Base64-encoded encrypted data
   */
  private async encryptData(data: string): Promise<string> {
    const result = await this.options.kmsClient.send(
      new EncryptCommand({
        KeyId: this.options.kmsKeyId,
        Plaintext: Buffer.from(data),
      }),
    );
    return Buffer.from(result.CiphertextBlob!).toString("base64");
  }

  /**
   * Decrypts KMS-encrypted data
   *
   * @private
   * @param encryptedData - Base64-encoded encrypted data
   * @returns Decrypted plain text
   */
  private async decryptData(encryptedData: string): Promise<string> {
    const result = await this.options.kmsClient.send(
      new DecryptCommand({
        CiphertextBlob: Buffer.from(encryptedData, "base64"),
      }),
    );
    return Buffer.from(result.Plaintext!).toString("utf-8");
  }
}
