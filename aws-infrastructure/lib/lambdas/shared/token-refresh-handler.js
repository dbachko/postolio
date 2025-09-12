"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenRefreshHandler = void 0;
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_kms_1 = require("@aws-sdk/client-kms");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
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
class TokenRefreshHandler {
    options;
    constructor(options) {
        this.options = options;
    }
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
    async getToken(userId, brandId, platform) {
        try {
            const result = await this.options.docClient.send(new lib_dynamodb_1.GetCommand({
                TableName: this.options.tokenTableName,
                Key: {
                    pk: `${userId}#${platform}`,
                    sk: brandId,
                },
            }));
            if (!result.Item) {
                return null;
            }
            // Decrypt tokens
            const accessToken = await this.decryptData(result.Item.encryptedAccessToken);
            const refreshToken = result.Item.encryptedRefreshToken
                ? await this.decryptData(result.Item.encryptedRefreshToken)
                : undefined;
            // Check if token needs refresh (within 1 hour of expiry)
            const needsRefresh = result.Item.expiresAt < (Date.now() + 3600000);
            return {
                accessToken,
                refreshToken,
                expiresAt: result.Item.expiresAt,
                needsRefresh,
            };
        }
        catch (error) {
            console.error('Failed to get token', { userId, brandId, platform, error });
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
    async storeToken(userId, brandId, platform, token) {
        const encryptedAccessToken = await this.encryptData(token.accessToken);
        const encryptedRefreshToken = token.refreshToken
            ? await this.encryptData(token.refreshToken)
            : undefined;
        const expiresAt = Date.now() + (token.expiresIn * 1000);
        const ttl = Math.floor(expiresAt / 1000) + 86400; // 1 day after expiry
        await this.options.docClient.send(new lib_dynamodb_1.PutCommand({
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
        }));
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
    async refreshToken(userId, brandId, platform, refreshFunction) {
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
            await this.options.eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
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
            }));
            return {
                accessToken: newTokenData.access_token,
                refreshToken: newTokenData.refresh_token || token.refreshToken,
                expiresAt: Date.now() + (newTokenData.expires_in * 1000),
                needsRefresh: false,
            };
        }
        catch (error) {
            console.error('Token refresh failed', { userId, brandId, platform, error });
            // Emit token refresh failed event
            await this.options.eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
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
            }));
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
    async encryptData(data) {
        const result = await this.options.kmsClient.send(new client_kms_1.EncryptCommand({
            KeyId: this.options.kmsKeyId,
            Plaintext: Buffer.from(data),
        }));
        return Buffer.from(result.CiphertextBlob).toString('base64');
    }
    /**
     * Decrypts KMS-encrypted data
     *
     * @private
     * @param encryptedData - Base64-encoded encrypted data
     * @returns Decrypted plain text
     */
    async decryptData(encryptedData) {
        const result = await this.options.kmsClient.send(new client_kms_1.DecryptCommand({
            CiphertextBlob: Buffer.from(encryptedData, 'base64'),
        }));
        return Buffer.from(result.Plaintext).toString('utf-8');
    }
}
exports.TokenRefreshHandler = TokenRefreshHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG9rZW4tcmVmcmVzaC1oYW5kbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsidG9rZW4tcmVmcmVzaC1oYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHdEQUFzRjtBQUN0RixvREFBK0U7QUFDL0Usb0VBQWlGO0FBbUNqRjs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FpQkc7QUFDSCxNQUFhLG1CQUFtQjtJQUNWO0lBQXBCLFlBQW9CLE9BQW1DO1FBQW5DLFlBQU8sR0FBUCxPQUFPLENBQTRCO0lBQUcsQ0FBQztJQUUzRDs7Ozs7Ozs7Ozs7Ozs7O09BZUc7SUFDSCxLQUFLLENBQUMsUUFBUSxDQUFDLE1BQWMsRUFBRSxPQUFlLEVBQUUsUUFBZ0I7UUFDOUQsSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSx5QkFBVSxDQUFDO2dCQUM5RCxTQUFTLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxjQUFjO2dCQUN0QyxHQUFHLEVBQUU7b0JBQ0gsRUFBRSxFQUFFLEdBQUcsTUFBTSxJQUFJLFFBQVEsRUFBRTtvQkFDM0IsRUFBRSxFQUFFLE9BQU87aUJBQ1o7YUFDRixDQUFDLENBQUMsQ0FBQTtZQUVILElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLENBQUM7Z0JBQ2pCLE9BQU8sSUFBSSxDQUFBO1lBQ2IsQ0FBQztZQUVELGlCQUFpQjtZQUNqQixNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO1lBQzVFLE1BQU0sWUFBWSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMscUJBQXFCO2dCQUNwRCxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUM7Z0JBQzNELENBQUMsQ0FBQyxT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Qy9ELFFBQVEsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTt5QkFDbkMsQ0FBQzt3QkFDRixZQUFZLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxZQUFZO3FCQUN4QyxDQUFDO2FBQ0gsQ0FBQyxDQUFDLENBQUE7WUFFSCxPQUFPLElBQUksQ0FBQTtRQUNiLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0ssS0FBSyxDQUFDLFdBQVcsQ0FBQyxJQUFZO1FBQ3BDLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksMkJBQWMsQ0FBQztZQUNsRSxLQUFLLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRO1lBQzVCLFNBQVMsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztTQUM3QixDQUFDLENBQUMsQ0FBQTtRQUNILE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsY0FBZSxDQUFDLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQy9ELENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSyxLQUFLLENBQUMsV0FBVyxDQUFDLGFBQXFCO1FBQzdDLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksMkJBQWMsQ0FBQztZQUNsRSxjQUFjLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsUUFBUSxDQUFDO1NBQ3JELENBQUMsQ0FBQyxDQUFBO1FBQ0gsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFVLENBQUMsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDekQsQ0FBQztDQUNGO0FBcE9ELGtEQW9PQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIEdldENvbW1hbmQsIFB1dENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInXG5pbXBvcnQgeyBLTVNDbGllbnQsIERlY3J5cHRDb21tYW5kLCBFbmNyeXB0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1rbXMnXG5pbXBvcnQgeyBFdmVudEJyaWRnZUNsaWVudCwgUHV0RXZlbnRzQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1ldmVudGJyaWRnZSdcbmltcG9ydCBheGlvcyBmcm9tICdheGlvcydcblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIFRva2VuUmVmcmVzaEhhbmRsZXJcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb2tlblJlZnJlc2hIYW5kbGVyT3B0aW9ucyB7XG4gIC8qKiBEeW5hbW9EQiBEb2N1bWVudENsaWVudCBmb3IgdG9rZW4gc3RvcmFnZSBvcGVyYXRpb25zICovXG4gIGRvY0NsaWVudDogRHluYW1vREJEb2N1bWVudENsaWVudFxuICAvKiogS01TIGNsaWVudCBmb3IgdG9rZW4gZW5jcnlwdGlvbi9kZWNyeXB0aW9uICovXG4gIGttc0NsaWVudDogS01TQ2xpZW50XG4gIC8qKiBFdmVudEJyaWRnZSBjbGllbnQgZm9yIGVtaXR0aW5nIHRva2VuIGV2ZW50cyAqL1xuICBldmVudEJyaWRnZUNsaWVudDogRXZlbnRCcmlkZ2VDbGllbnRcbiAgLyoqIE5hbWUgb2YgRHluYW1vREIgdGFibGUgc3RvcmluZyB0b2tlbnMgKi9cbiAgdG9rZW5UYWJsZU5hbWU6IHN0cmluZ1xuICAvKiogS01TIGtleSBJRCBmb3IgdG9rZW4gZW5jcnlwdGlvbiAqL1xuICBrbXNLZXlJZDogc3RyaW5nXG4gIC8qKiBFdmVudEJyaWRnZSBldmVudCBidXMgbmFtZSBmb3IgdG9rZW4gZXZlbnRzICovXG4gIGV2ZW50QnVzTmFtZTogc3RyaW5nXG59XG5cbi8qKlxuICogUmVwcmVzZW50cyBhbiBPQXV0aCB0b2tlbiB3aXRoIG1ldGFkYXRhXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG9rZW4ge1xuICAvKiogQWNjZXNzIHRva2VuIGZvciBBUEkgYXV0aGVudGljYXRpb24gKi9cbiAgYWNjZXNzVG9rZW46IHN0cmluZ1xuICAvKiogT3B0aW9uYWwgcmVmcmVzaCB0b2tlbiBmb3Igb2J0YWluaW5nIG5ldyBhY2Nlc3MgdG9rZW5zICovXG4gIHJlZnJlc2hUb2tlbj86IHN0cmluZ1xuICAvKiogVW5peCB0aW1lc3RhbXAgd2hlbiB0b2tlbiBleHBpcmVzICovXG4gIGV4cGlyZXNBdDogbnVtYmVyXG4gIC8qKiBXaGV0aGVyIHRva2VuIG5lZWRzIHJlZnJlc2ggKHdpdGhpbiAxIGhvdXIgb2YgZXhwaXJ5KSAqL1xuICBuZWVkc1JlZnJlc2g6IGJvb2xlYW5cbn1cblxuLyoqXG4gKiBIYW5kbGVzIHNlY3VyZSBPQXV0aCB0b2tlbiBzdG9yYWdlLCByZXRyaWV2YWwsIGFuZCByZWZyZXNoIG9wZXJhdGlvbnNcbiAqIHdpdGggS01TIGVuY3J5cHRpb24gYW5kIEV2ZW50QnJpZGdlIGV2ZW50IGVtaXNzaW9uXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBoYW5kbGVyID0gbmV3IFRva2VuUmVmcmVzaEhhbmRsZXIoe1xuICogICBkb2NDbGllbnQsXG4gKiAgIGttc0NsaWVudCxcbiAqICAgZXZlbnRCcmlkZ2VDbGllbnQsXG4gKiAgIHRva2VuVGFibGVOYW1lOiAnb2F1dGgtdG9rZW5zJyxcbiAqICAga21zS2V5SWQ6ICdhbGlhcy90b2tlbi1lbmNyeXB0aW9uJyxcbiAqICAgZXZlbnRCdXNOYW1lOiAncG9zdG9saW8tZXZlbnRzJ1xuICogfSk7XG4gKiBcbiAqIGNvbnN0IHRva2VuID0gYXdhaXQgaGFuZGxlci5nZXRUb2tlbigndXNlcjEyMycsICdicmFuZDQ1NicsICdpbnN0YWdyYW0nKTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgVG9rZW5SZWZyZXNoSGFuZGxlciB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgb3B0aW9uczogVG9rZW5SZWZyZXNoSGFuZGxlck9wdGlvbnMpIHt9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyBhbmQgZGVjcnlwdHMgYW4gT0F1dGggdG9rZW4gZnJvbSBEeW5hbW9EQlxuICAgKiBcbiAgICogQHBhcmFtIHVzZXJJZCAtIFVzZXIgSUQgb3duaW5nIHRoZSB0b2tlblxuICAgKiBAcGFyYW0gYnJhbmRJZCAtIEJyYW5kIElEIGFzc29jaWF0ZWQgd2l0aCB0aGUgdG9rZW5cbiAgICogQHBhcmFtIHBsYXRmb3JtIC0gU29jaWFsIG1lZGlhIHBsYXRmb3JtIChpbnN0YWdyYW0sIGZhY2Vib29rLCBsaW5rZWRpbiwgdGlrdG9rKVxuICAgKiBAcmV0dXJucyBEZWNyeXB0ZWQgdG9rZW4gd2l0aCBtZXRhZGF0YSBvciBudWxsIGlmIG5vdCBmb3VuZFxuICAgKiBcbiAgICogQGV4YW1wbGVcbiAgICogYGBgdHlwZXNjcmlwdFxuICAgKiBjb25zdCB0b2tlbiA9IGF3YWl0IGhhbmRsZXIuZ2V0VG9rZW4oJ3VzZXIxMjMnLCAnYnJhbmQ0NTYnLCAnaW5zdGFncmFtJyk7XG4gICAqIGlmICh0b2tlbj8ubmVlZHNSZWZyZXNoKSB7XG4gICAqICAgLy8gSGFuZGxlIHRva2VuIHJlZnJlc2hcbiAgICogfVxuICAgKiBgYGBcbiAgICovXG4gIGFzeW5jIGdldFRva2VuKHVzZXJJZDogc3RyaW5nLCBicmFuZElkOiBzdHJpbmcsIHBsYXRmb3JtOiBzdHJpbmcpOiBQcm9taXNlPFRva2VuIHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLm9wdGlvbnMuZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xuICAgICAgICBUYWJsZU5hbWU6IHRoaXMub3B0aW9ucy50b2tlblRhYmxlTmFtZSxcbiAgICAgICAgS2V5OiB7XG4gICAgICAgICAgcGs6IGAke3VzZXJJZH0jJHtwbGF0Zm9ybX1gLFxuICAgICAgICAgIHNrOiBicmFuZElkLFxuICAgICAgICB9LFxuICAgICAgfSkpXG5cbiAgICAgIGlmICghcmVzdWx0Lkl0ZW0pIHtcbiAgICAgICAgcmV0dXJuIG51bGxcbiAgICAgIH1cblxuICAgICAgLy8gRGVjcnlwdCB0b2tlbnNcbiAgICAgIGNvbnN0IGFjY2Vzc1Rva2VuID0gYXdhaXQgdGhpcy5kZWNyeXB0RGF0YShyZXN1bHQuSXRlbS5lbmNyeXB0ZWRBY2Nlc3NUb2tlbilcbiAgICAgIGNvbnN0IHJlZnJlc2hUb2tlbiA9IHJlc3VsdC5JdGVtLmVuY3J5cHRlZFJlZnJlc2hUb2tlbiBcbiAgICAgICAgPyBhd2FpdCB0aGlzLmRlY3J5cHREYXRhKHJlc3VsdC5JdGVtLmVuY3J5cHRlZFJlZnJlc2hUb2tlbilcbiAgICAgICAgOiB1bmRlZmluZWRcblxuICAgICAgLy8gQ2hlY2sgaWYgdG9rZW4gbmVlZHMgcmVmcmVzaCAod2l0aGluIDEgaG91ciBvZiBleHBpcnkpXG4gICAgICBjb25zdCBuZWVkc1JlZnJlc2ggPSByZXN1bHQuSXRlbS5leHBpcmVzQXQgPCAoRGF0ZS5ub3coKSArIDM2MDAwMDApXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFjY2Vzc1Rva2VuLFxuICAgICAgICByZWZyZXNoVG9rZW4sXG4gICAgICAgIGV4cGlyZXNBdDogcmVzdWx0Lkl0ZW0uZXhwaXJlc0F0LFxuICAgICAgICBuZWVkc1JlZnJlc2gsXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBnZXQgdG9rZW4nLCB7IHVzZXJJZCwgYnJhbmRJZCwgcGxhdGZvcm0sIGVycm9yIH0pXG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbmNyeXB0cyBhbmQgc3RvcmVzIGFuIE9BdXRoIHRva2VuIGluIER5bmFtb0RCIHdpdGggVFRMXG4gICAqIFxuICAgKiBAcGFyYW0gdXNlcklkIC0gVXNlciBJRCBvd25pbmcgdGhlIHRva2VuXG4gICAqIEBwYXJhbSBicmFuZElkIC0gQnJhbmQgSUQgYXNzb2NpYXRlZCB3aXRoIHRoZSB0b2tlblxuICAgKiBAcGFyYW0gcGxhdGZvcm0gLSBTb2NpYWwgbWVkaWEgcGxhdGZvcm0gKGluc3RhZ3JhbSwgZmFjZWJvb2ssIGxpbmtlZGluLCB0aWt0b2spXG4gICAqIEBwYXJhbSB0b2tlbiAtIFRva2VuIGRhdGEgdG8gc3RvcmVcbiAgICogQHBhcmFtIHRva2VuLmFjY2Vzc1Rva2VuIC0gT0F1dGggYWNjZXNzIHRva2VuXG4gICAqIEBwYXJhbSB0b2tlbi5yZWZyZXNoVG9rZW4gLSBPcHRpb25hbCBPQXV0aCByZWZyZXNoIHRva2VuXG4gICAqIEBwYXJhbSB0b2tlbi5leHBpcmVzSW4gLSBUb2tlbiBleHBpcnkgZHVyYXRpb24gaW4gc2Vjb25kc1xuICAgKiBAcmV0dXJucyBQcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0b2tlbiBpcyBzdG9yZWRcbiAgICogXG4gICAqIEBleGFtcGxlXG4gICAqIGBgYHR5cGVzY3JpcHRcbiAgICogYXdhaXQgaGFuZGxlci5zdG9yZVRva2VuKCd1c2VyMTIzJywgJ2JyYW5kNDU2JywgJ2luc3RhZ3JhbScsIHtcbiAgICogICBhY2Nlc3NUb2tlbjogJ0lHUVZKWGVHVnVZWGwuLi4nLFxuICAgKiAgIHJlZnJlc2hUb2tlbjogJ0lHUVZKWWNHVnVZWGwuLi4nLFxuICAgKiAgIGV4cGlyZXNJbjogMzYwMFxuICAgKiB9KTtcbiAgICogYGBgXG4gICAqL1xuICBhc3luYyBzdG9yZVRva2VuKFxuICAgIHVzZXJJZDogc3RyaW5nLFxuICAgIGJyYW5kSWQ6IHN0cmluZyxcbiAgICBwbGF0Zm9ybTogc3RyaW5nLFxuICAgIHRva2VuOiB7XG4gICAgICBhY2Nlc3NUb2tlbjogc3RyaW5nXG4gICAgICByZWZyZXNoVG9rZW4/OiBzdHJpbmdcbiAgICAgIGV4cGlyZXNJbjogbnVtYmVyXG4gICAgfVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBlbmNyeXB0ZWRBY2Nlc3NUb2tlbiA9IGF3YWl0IHRoaXMuZW5jcnlwdERhdGEodG9rZW4uYWNjZXNzVG9rZW4pXG4gICAgY29uc3QgZW5jcnlwdGVkUmVmcmVzaFRva2VuID0gdG9rZW4ucmVmcmVzaFRva2VuIFxuICAgICAgPyBhd2FpdCB0aGlzLmVuY3J5cHREYXRhKHRva2VuLnJlZnJlc2hUb2tlbilcbiAgICAgIDogdW5kZWZpbmVkXG4gICAgXG4gICAgY29uc3QgZXhwaXJlc0F0ID0gRGF0ZS5ub3coKSArICh0b2tlbi5leHBpcmVzSW4gKiAxMDAwKVxuICAgIGNvbnN0IHR0bCA9IE1hdGguZmxvb3IoZXhwaXJlc0F0IC8gMTAwMCkgKyA4NjQwMCAvLyAxIGRheSBhZnRlciBleHBpcnlcblxuICAgIGF3YWl0IHRoaXMub3B0aW9ucy5kb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IHRoaXMub3B0aW9ucy50b2tlblRhYmxlTmFtZSxcbiAgICAgIEl0ZW06IHtcbiAgICAgICAgcGs6IGAke3VzZXJJZH0jJHtwbGF0Zm9ybX1gLFxuICAgICAgICBzazogYnJhbmRJZCxcbiAgICAgICAgcGxhdGZvcm0sXG4gICAgICAgIGVuY3J5cHRlZEFjY2Vzc1Rva2VuLFxuICAgICAgICBlbmNyeXB0ZWRSZWZyZXNoVG9rZW4sXG4gICAgICAgIGV4cGlyZXNBdCxcbiAgICAgICAgbGFzdFJlZnJlc2hlZDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICB0dGwsXG4gICAgICB9LFxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZnJlc2hlcyBhbiBPQXV0aCB0b2tlbiB1c2luZyBhIHBsYXRmb3JtLXNwZWNpZmljIHJlZnJlc2ggZnVuY3Rpb25cbiAgICogXG4gICAqIEBwYXJhbSB1c2VySWQgLSBVc2VyIElEIG93bmluZyB0aGUgdG9rZW5cbiAgICogQHBhcmFtIGJyYW5kSWQgLSBCcmFuZCBJRCBhc3NvY2lhdGVkIHdpdGggdGhlIHRva2VuXG4gICAqIEBwYXJhbSBwbGF0Zm9ybSAtIFNvY2lhbCBtZWRpYSBwbGF0Zm9ybSAoaW5zdGFncmFtLCBmYWNlYm9vaywgbGlua2VkaW4sIHRpa3RvaylcbiAgICogQHBhcmFtIHJlZnJlc2hGdW5jdGlvbiAtIFBsYXRmb3JtLXNwZWNpZmljIGZ1bmN0aW9uIHRvIHJlZnJlc2ggdGhlIHRva2VuXG4gICAqIEByZXR1cm5zIE5ldyB0b2tlbiB3aXRoIHVwZGF0ZWQgYWNjZXNzIHRva2VuIGFuZCBtZXRhZGF0YSwgb3IgbnVsbCBvbiBmYWlsdXJlXG4gICAqIFxuICAgKiBAZW1pdHMgdG9rZW4ucmVmcmVzaGVkIC0gT24gc3VjY2Vzc2Z1bCB0b2tlbiByZWZyZXNoXG4gICAqIEBlbWl0cyB0b2tlbi5yZWZyZXNoLmZhaWxlZCAtIE9uIHJlZnJlc2ggZmFpbHVyZVxuICAgKiBcbiAgICogQGV4YW1wbGVcbiAgICogYGBgdHlwZXNjcmlwdFxuICAgKiBjb25zdCBuZXdUb2tlbiA9IGF3YWl0IGhhbmRsZXIucmVmcmVzaFRva2VuKFxuICAgKiAgICd1c2VyMTIzJywgXG4gICAqICAgJ2JyYW5kNDU2JywgXG4gICAqICAgJ2luc3RhZ3JhbScsXG4gICAqICAgYXN5bmMgKHJlZnJlc2hUb2tlbikgPT4ge1xuICAgKiAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCgnaHR0cHM6Ly9ncmFwaC5pbnN0YWdyYW0uY29tL3JlZnJlc2hfYWNjZXNzX3Rva2VuJywge1xuICAgKiAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgKiAgICAgICBwYXJhbXM6IHsgZ3JhbnRfdHlwZTogJ2lnX3JlZnJlc2hfdG9rZW4nLCBhY2Nlc3NfdG9rZW46IHJlZnJlc2hUb2tlbiB9XG4gICAqICAgICB9KTtcbiAgICogICAgIHJldHVybiByZXNwb25zZS5kYXRhO1xuICAgKiAgIH1cbiAgICogKTtcbiAgICogYGBgXG4gICAqL1xuICBhc3luYyByZWZyZXNoVG9rZW4oXG4gICAgdXNlcklkOiBzdHJpbmcsXG4gICAgYnJhbmRJZDogc3RyaW5nLFxuICAgIHBsYXRmb3JtOiBzdHJpbmcsXG4gICAgcmVmcmVzaEZ1bmN0aW9uOiAocmVmcmVzaFRva2VuOiBzdHJpbmcpID0+IFByb21pc2U8YW55PlxuICApOiBQcm9taXNlPFRva2VuIHwgbnVsbD4ge1xuICAgIGNvbnN0IHRva2VuID0gYXdhaXQgdGhpcy5nZXRUb2tlbih1c2VySWQsIGJyYW5kSWQsIHBsYXRmb3JtKVxuICAgIGlmICghdG9rZW4gfHwgIXRva2VuLnJlZnJlc2hUb2tlbikge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgbmV3VG9rZW5EYXRhID0gYXdhaXQgcmVmcmVzaEZ1bmN0aW9uKHRva2VuLnJlZnJlc2hUb2tlbilcbiAgICAgIFxuICAgICAgYXdhaXQgdGhpcy5zdG9yZVRva2VuKHVzZXJJZCwgYnJhbmRJZCwgcGxhdGZvcm0sIHtcbiAgICAgICAgYWNjZXNzVG9rZW46IG5ld1Rva2VuRGF0YS5hY2Nlc3NfdG9rZW4sXG4gICAgICAgIHJlZnJlc2hUb2tlbjogbmV3VG9rZW5EYXRhLnJlZnJlc2hfdG9rZW4gfHwgdG9rZW4ucmVmcmVzaFRva2VuLFxuICAgICAgICBleHBpcmVzSW46IG5ld1Rva2VuRGF0YS5leHBpcmVzX2luLFxuICAgICAgfSlcblxuICAgICAgLy8gRW1pdCB0b2tlbiByZWZyZXNoZWQgZXZlbnRcbiAgICAgIGF3YWl0IHRoaXMub3B0aW9ucy5ldmVudEJyaWRnZUNsaWVudC5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcbiAgICAgICAgRW50cmllczogW3tcbiAgICAgICAgICBTb3VyY2U6ICdwb3N0b2xpby50b2tlbicsXG4gICAgICAgICAgRGV0YWlsVHlwZTogJ3Rva2VuLnJlZnJlc2hlZCcsXG4gICAgICAgICAgRGV0YWlsOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICB1c2VySWQsXG4gICAgICAgICAgICBicmFuZElkLFxuICAgICAgICAgICAgcGxhdGZvcm0sXG4gICAgICAgICAgICByZWZyZXNoZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIEV2ZW50QnVzTmFtZTogdGhpcy5vcHRpb25zLmV2ZW50QnVzTmFtZSxcbiAgICAgICAgfV0sXG4gICAgICB9KSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYWNjZXNzVG9rZW46IG5ld1Rva2VuRGF0YS5hY2Nlc3NfdG9rZW4sXG4gICAgICAgIHJlZnJlc2hUb2tlbjogbmV3VG9rZW5EYXRhLnJlZnJlc2hfdG9rZW4gfHwgdG9rZW4ucmVmcmVzaFRva2VuLFxuICAgICAgICBleHBpcmVzQXQ6IERhdGUubm93KCkgKyAobmV3VG9rZW5EYXRhLmV4cGlyZXNfaW4gKiAxMDAwKSxcbiAgICAgICAgbmVlZHNSZWZyZXNoOiBmYWxzZSxcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignVG9rZW4gcmVmcmVzaCBmYWlsZWQnLCB7IHVzZXJJZCwgYnJhbmRJZCwgcGxhdGZvcm0sIGVycm9yIH0pXG4gICAgICBcbiAgICAgIC8vIEVtaXQgdG9rZW4gcmVmcmVzaCBmYWlsZWQgZXZlbnRcbiAgICAgIGF3YWl0IHRoaXMub3B0aW9ucy5ldmVudEJyaWRnZUNsaWVudC5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcbiAgICAgICAgRW50cmllczogW3tcbiAgICAgICAgICBTb3VyY2U6ICdwb3N0b2xpby50b2tlbicsXG4gICAgICAgICAgRGV0YWlsVHlwZTogJ3Rva2VuLnJlZnJlc2guZmFpbGVkJyxcbiAgICAgICAgICBEZXRhaWw6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIHVzZXJJZCxcbiAgICAgICAgICAgIGJyYW5kSWQsXG4gICAgICAgICAgICBwbGF0Zm9ybSxcbiAgICAgICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcbiAgICAgICAgICAgIGZhaWxlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgfSksXG4gICAgICAgICAgRXZlbnRCdXNOYW1lOiB0aGlzLm9wdGlvbnMuZXZlbnRCdXNOYW1lLFxuICAgICAgICB9XSxcbiAgICAgIH0pKVxuXG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbmNyeXB0cyBzZW5zaXRpdmUgZGF0YSB1c2luZyBBV1MgS01TXG4gICAqIFxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gZGF0YSAtIFBsYWluIHRleHQgZGF0YSB0byBlbmNyeXB0XG4gICAqIEByZXR1cm5zIEJhc2U2NC1lbmNvZGVkIGVuY3J5cHRlZCBkYXRhXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGVuY3J5cHREYXRhKGRhdGE6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5vcHRpb25zLmttc0NsaWVudC5zZW5kKG5ldyBFbmNyeXB0Q29tbWFuZCh7XG4gICAgICBLZXlJZDogdGhpcy5vcHRpb25zLmttc0tleUlkLFxuICAgICAgUGxhaW50ZXh0OiBCdWZmZXIuZnJvbShkYXRhKSxcbiAgICB9KSlcbiAgICByZXR1cm4gQnVmZmVyLmZyb20ocmVzdWx0LkNpcGhlcnRleHRCbG9iISkudG9TdHJpbmcoJ2Jhc2U2NCcpXG4gIH1cblxuICAvKipcbiAgICogRGVjcnlwdHMgS01TLWVuY3J5cHRlZCBkYXRhXG4gICAqIFxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gZW5jcnlwdGVkRGF0YSAtIEJhc2U2NC1lbmNvZGVkIGVuY3J5cHRlZCBkYXRhXG4gICAqIEByZXR1cm5zIERlY3J5cHRlZCBwbGFpbiB0ZXh0XG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGRlY3J5cHREYXRhKGVuY3J5cHRlZERhdGE6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5vcHRpb25zLmttc0NsaWVudC5zZW5kKG5ldyBEZWNyeXB0Q29tbWFuZCh7XG4gICAgICBDaXBoZXJ0ZXh0QmxvYjogQnVmZmVyLmZyb20oZW5jcnlwdGVkRGF0YSwgJ2Jhc2U2NCcpLFxuICAgIH0pKVxuICAgIHJldHVybiBCdWZmZXIuZnJvbShyZXN1bHQuUGxhaW50ZXh0ISkudG9TdHJpbmcoJ3V0Zi04JylcbiAgfVxufVxuIl19