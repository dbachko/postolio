import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { KMSClient } from '@aws-sdk/client-kms';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
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
export declare class TokenRefreshHandler {
    private options;
    constructor(options: TokenRefreshHandlerOptions);
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
    getToken(userId: string, brandId: string, platform: string): Promise<Token | null>;
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
    storeToken(userId: string, brandId: string, platform: string, token: {
        accessToken: string;
        refreshToken?: string;
        expiresIn: number;
    }): Promise<void>;
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
    refreshToken(userId: string, brandId: string, platform: string, refreshFunction: (refreshToken: string) => Promise<any>): Promise<Token | null>;
    /**
     * Encrypts sensitive data using AWS KMS
     *
     * @private
     * @param data - Plain text data to encrypt
     * @returns Base64-encoded encrypted data
     */
    private encryptData;
    /**
     * Decrypts KMS-encrypted data
     *
     * @private
     * @param encryptedData - Base64-encoded encrypted data
     * @returns Decrypted plain text
     */
    private decryptData;
}
