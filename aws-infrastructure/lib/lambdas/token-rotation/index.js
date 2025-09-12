"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_kms_1 = require("@aws-sdk/client-kms");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const axios_1 = __importDefault(require("axios"));
const secrets_manager_1 = require("../shared/secrets-manager");
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const kmsClient = new client_kms_1.KMSClient({});
const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({});
const TOKEN_TABLE_NAME = process.env.TOKEN_TABLE_NAME;
const KMS_KEY_ID = process.env.KMS_KEY_ID;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT;
const handler = async (event, context) => {
    console.log('Token Rotation Lambda invoked', {
        time: event.time,
        requestId: context.awsRequestId,
    });
    try {
        // Get all tokens that expire within the next 7 days
        const expiringTokens = await getExpiringTokens();
        console.log(`Found ${expiringTokens.length} tokens expiring soon`);
        const results = {
            success: 0,
            failed: 0,
            skipped: 0,
        };
        // Process each token
        for (const token of expiringTokens) {
            try {
                const refreshed = await refreshToken(token);
                if (refreshed) {
                    results.success++;
                }
                else {
                    results.skipped++;
                }
            }
            catch (error) {
                console.error('Failed to refresh token:', {
                    pk: token.pk,
                    sk: token.sk,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
                results.failed++;
                // Send failure event
                await sendEvent('postolio.token-rotation', 'token.refresh.failed', {
                    userId: token.pk.split('#')[0],
                    platform: token.platform,
                    brandId: token.sk,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    timestamp: new Date().toISOString(),
                });
            }
        }
        console.log('Token rotation completed:', results);
        // Send summary event
        await sendEvent('postolio.token-rotation', 'rotation.completed', {
            ...results,
            totalProcessed: expiringTokens.length,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        console.error('Token rotation error:', error);
        // Send error event
        await sendEvent('postolio.token-rotation', 'rotation.error', {
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString(),
        });
        throw error;
    }
};
exports.handler = handler;
async function getExpiringTokens() {
    const expiringTokens = [];
    const sevenDaysFromNow = Date.now() + (7 * 24 * 60 * 60 * 1000);
    let lastEvaluatedKey = undefined;
    // Scan the table for expiring tokens
    // In production, this should use a GSI on expiresAt for better performance
    do {
        const result = await docClient.send(new lib_dynamodb_1.ScanCommand({
            TableName: TOKEN_TABLE_NAME,
            FilterExpression: 'expiresAt < :threshold AND expiresAt > :now',
            ExpressionAttributeValues: {
                ':threshold': sevenDaysFromNow,
                ':now': Date.now(),
            },
            ExclusiveStartKey: lastEvaluatedKey,
        }));
        if (result.Items) {
            expiringTokens.push(...result.Items);
        }
        lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    return expiringTokens;
}
async function refreshToken(token) {
    // Skip if no refresh token
    if (!token.encryptedRefreshToken) {
        console.log('No refresh token available, skipping:', {
            pk: token.pk,
            platform: token.platform,
        });
        return false;
    }
    // Decrypt tokens
    const refreshToken = await decryptData(token.encryptedRefreshToken);
    // Get platform-specific metadata
    const metadata = token.metadata || {};
    // Refresh based on platform
    let refreshResult = null;
    switch (token.platform) {
        case 'instagram':
            refreshResult = await refreshInstagramToken(refreshToken);
            break;
        case 'facebook':
            refreshResult = await refreshFacebookToken(refreshToken, metadata);
            break;
        case 'linkedin':
            refreshResult = await refreshLinkedInToken(refreshToken, metadata);
            break;
        case 'tiktok':
            refreshResult = await refreshTikTokToken(refreshToken, metadata);
            break;
        default:
            console.warn('Unknown platform for token refresh:', token.platform);
            return false;
    }
    if (!refreshResult) {
        return false;
    }
    // Encrypt new tokens
    const encryptedAccessToken = await encryptData(refreshResult.accessToken);
    const encryptedRefreshToken = refreshResult.refreshToken
        ? await encryptData(refreshResult.refreshToken)
        : token.encryptedRefreshToken; // Keep old refresh token if not returned
    // Calculate new expiry
    const newExpiresAt = Date.now() + (refreshResult.expiresIn * 1000);
    // Update token in database
    await docClient.send(new lib_dynamodb_1.UpdateCommand({
        TableName: TOKEN_TABLE_NAME,
        Key: {
            pk: token.pk,
            sk: token.sk,
        },
        UpdateExpression: 'SET encryptedAccessToken = :accessToken, encryptedRefreshToken = :refreshToken, expiresAt = :expiresAt, lastRefreshed = :lastRefreshed',
        ExpressionAttributeValues: {
            ':accessToken': encryptedAccessToken,
            ':refreshToken': encryptedRefreshToken,
            ':expiresAt': newExpiresAt,
            ':lastRefreshed': new Date().toISOString(),
        },
    }));
    // Send success event
    await sendEvent('postolio.token-rotation', 'token.refreshed', {
        userId: token.pk.split('#')[0],
        platform: token.platform,
        brandId: token.sk,
        newExpiresAt,
        timestamp: new Date().toISOString(),
    });
    return true;
}
async function refreshInstagramToken(accessToken) {
    // Instagram uses long-lived tokens that need to be refreshed every 60 days
    try {
        const response = await axios_1.default.get('https://graph.instagram.com/refresh_access_token', {
            params: {
                grant_type: 'ig_refresh_token',
                access_token: accessToken,
            },
        });
        return {
            accessToken: response.data.access_token,
            expiresIn: response.data.expires_in || 5184000, // 60 days default
        };
    }
    catch (error) {
        console.error('Instagram token refresh failed:', error);
        throw new Error('Failed to refresh Instagram token');
    }
}
async function refreshFacebookToken(currentToken, metadata) {
    try {
        // Get app ID from environment variable and secret from Secrets Manager
        const appId = process.env.FACEBOOK_APP_ID;
        const secretManager = (0, secrets_manager_1.getSecretManager)();
        const secrets = await secretManager.getPlatformSecrets();
        const appSecret = secrets.FACEBOOK_APP_SECRET;
        if (!appId || !appSecret) {
            throw new Error('Facebook app credentials not available');
        }
        // Exchange for long-lived token
        const response = await axios_1.default.get('https://graph.facebook.com/v18.0/oauth/access_token', {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: appId,
                client_secret: appSecret,
                fb_exchange_token: currentToken,
            },
        });
        return {
            accessToken: response.data.access_token,
            expiresIn: response.data.expires_in || 5184000, // 60 days default
        };
    }
    catch (error) {
        console.error('Facebook token refresh failed:', error);
        throw new Error('Failed to refresh Facebook token');
    }
}
async function refreshLinkedInToken(refreshToken, metadata) {
    try {
        // Get client ID from environment variable and secret from Secrets Manager
        const clientId = process.env.LINKEDIN_CLIENT_ID;
        const secretManager = (0, secrets_manager_1.getSecretManager)();
        const secrets = await secretManager.getPlatformSecrets();
        const clientSecret = secrets.LINKEDIN_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            throw new Error('LinkedIn client credentials not available');
        }
        const response = await axios_1.default.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
            params: {
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret,
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        return {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token || refreshToken,
            expiresIn: response.data.expires_in || 5184000, // 60 days default
        };
    }
    catch (error) {
        console.error('LinkedIn token refresh failed:', error);
        throw new Error('Failed to refresh LinkedIn token');
    }
}
async function refreshTikTokToken(refreshToken, metadata) {
    try {
        // Get client key from environment variable and secret from Secrets Manager
        const clientKey = process.env.TIKTOK_CLIENT_KEY;
        const secretManager = (0, secrets_manager_1.getSecretManager)();
        const secrets = await secretManager.getPlatformSecrets();
        const clientSecret = secrets.TIKTOK_CLIENT_SECRET;
        if (!clientKey || !clientSecret) {
            throw new Error('TikTok client credentials not available');
        }
        const response = await axios_1.default.post('https://open.tiktokapis.com/v2/oauth/token/', {
            client_key: clientKey,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
            },
        });
        return {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresIn: response.data.expires_in || 86400, // 1 day default for TikTok
        };
    }
    catch (error) {
        console.error('TikTok token refresh failed:', error);
        throw new Error('Failed to refresh TikTok token');
    }
}
async function encryptData(data) {
    const result = await kmsClient.send(new client_kms_1.EncryptCommand({
        KeyId: KMS_KEY_ID,
        Plaintext: Buffer.from(data),
    }));
    return Buffer.from(result.CiphertextBlob).toString('base64');
}
async function decryptData(encryptedData) {
    const result = await kmsClient.send(new client_kms_1.DecryptCommand({
        CiphertextBlob: Buffer.from(encryptedData, 'base64'),
    }));
    return Buffer.from(result.Plaintext).toString();
}
async function sendEvent(source, detailType, detail) {
    await eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
        Entries: [{
                Source: source,
                DetailType: detailType,
                Detail: JSON.stringify(detail),
                EventBusName: EVENT_BUS_NAME,
            }],
    }));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSw4REFBeUQ7QUFDekQsd0RBQTBGO0FBQzFGLG9EQUErRTtBQUMvRSxvRUFBaUY7QUFDakYsa0RBQXlCO0FBQ3pCLCtEQUE0RDtBQUU1RCxNQUFNLFlBQVksR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxDQUFDLENBQUE7QUFDM0MsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFBO0FBQzNELE1BQU0sU0FBUyxHQUFHLElBQUksc0JBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtBQUNuQyxNQUFNLGlCQUFpQixHQUFHLElBQUksc0NBQWlCLENBQUMsRUFBRSxDQUFDLENBQUE7QUFFbkQsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFpQixDQUFBO0FBQ3RELE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVyxDQUFBO0FBQzFDLE1BQU0sY0FBYyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBZSxDQUFBO0FBQ2xELE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBWSxDQUFBO0FBbUJyQyxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQUUsS0FBcUIsRUFBRSxPQUFnQixFQUFpQixFQUFFO0lBQ3RGLE9BQU8sQ0FBQyxHQUFHLENBQUMsK0JBQStCLEVBQUU7UUFDM0MsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO1FBQ2hCLFNBQVMsRUFBRSxPQUFPLENBQUMsWUFBWTtLQUNoQyxDQUFDLENBQUE7SUFFRixJQUFJLENBQUM7UUFDSCxvREFBb0Q7UUFDcEQsTUFBTSxjQUFjLEdBQUcsTUFBTSxpQkFBaUIsRUFBRSxDQUFBO1FBQ2hELE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxjQUFjLENBQUMsTUFBTSx1QkFBdUIs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IENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJ1xuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBTY2FuQ29tbWFuZCwgVXBkYXRlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYidcbmltcG9ydCB7IEtNU0NsaWVudCwgRW5jcnlwdENvbW1hbmQsIERlY3J5cHRDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWttcydcbmltcG9ydCB7IEV2ZW50QnJpZGdlQ2xpZW50LCBQdXRFdmVudHNDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWV2ZW50YnJpZGdlJ1xuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJ1xuaW1wb3J0IHsgZ2V0U2VjcmV0TWFuYWdlciB9IGZyb20gJy4uL3NoYXJlZC9zZWNyZXRzLW1hbmFnZXInXG5cbmNvbnN0IGR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7fSlcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkeW5hbW9DbGllbnQpXG5jb25zdCBrbXNDbGllbnQgPSBuZXcgS01TQ2xpZW50KHt9KVxuY29uc3QgZXZlbnRCcmlkZ2VDbGllbnQgPSBuZXcgRXZlbnRCcmlkZ2VDbGllbnQoe30pXG5cbmNvbnN0IFRPS0VOX1RBQkxFX05BTUUgPSBwcm9jZXNzLmVudi5UT0tFTl9UQUJMRV9OQU1FIVxuY29uc3QgS01TX0tFWV9JRCA9IHByb2Nlc3MuZW52LktNU19LRVlfSUQhXG5jb25zdCBFVkVOVF9CVVNfTkFNRSA9IHByb2Nlc3MuZW52LkVWRU5UX0JVU19OQU1FIVxuY29uc3QgRU5WSVJPTk1FTlQgPSBwcm9jZXNzLmVudi5FTlZJUk9OTUVOVCFcblxuaW50ZXJmYWNlIFRva2VuUmVjb3JkIHtcbiAgcGs6IHN0cmluZyAvLyB1c2VySWQjcGxhdGZvcm1cbiAgc2s6IHN0cmluZyAvLyBicmFuZElkXG4gIHBsYXRmb3JtOiBzdHJpbmdcbiAgZW5jcnlwdGVkQWNjZXNzVG9rZW46IHN0cmluZ1xuICBlbmNyeXB0ZWRSZWZyZXNoVG9rZW4/OiBzdHJpbmdcbiAgZXhwaXJlc0F0OiBudW1iZXJcbiAgbGFzdFJlZnJlc2hlZDogc3RyaW5nXG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgYW55PlxufVxuXG5pbnRlcmZhY2UgUmVmcmVzaFJlc3VsdCB7XG4gIGFjY2Vzc1Rva2VuOiBzdHJpbmdcbiAgcmVmcmVzaFRva2VuPzogc3RyaW5nXG4gIGV4cGlyZXNJbjogbnVtYmVyXG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGV2ZW50OiBTY2hlZHVsZWRFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4gPT4ge1xuICBjb25zb2xlLmxvZygnVG9rZW4gUm90YXRpb24gTGFtYmRhIGludm9rZWQnLCB7XG4gICAgdGltZTogZXZlbnQudGltZSxcbiAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxuICB9KVxuXG4gIHRyeSB7XG4gICAgLy8gR2V0IGFsbCB0b2tlbnMgdGhhdCBleHBpcmUgd2l0aGluIHRoZSBuZXh0IDcgZGF5c1xuICAgIGNvbnN0IGV4cGlyaW5nVG9rZW5zID0gYXdhaXQgZ2V0RXhwaXJpbmdUb2tlbnMoKVxuICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke2V4cGlyaW5nVG9rZW5zLmxlbmd0aH0gdG9rZW5zIGV4cGlyaW5nIHNvb25gKVxuXG4gICAgY29uc3QgcmVzdWx0cyA9IHtcbiAgICAgIHN1Y2Nlc3M6IDAsXG4gICAgICBmYWlsZWQ6IDAsXG4gICAgICBza2lwcGVkOiAwLFxuICAgIH1cblxuICAgIC8vIFByb2Nlc3MgZWFjaCB0b2tlblxuICAgIGZvciAoY29uc3QgdG9rZW4gb2YgZXhwaXJpbmdUb2tlbnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlZnJlc2hlZCA9IGF3YWl0IHJlZnJlc2hUb2tlbih0b2tlbilcbiAgICAgICAgaWYgKHJlZnJlc2hlZCkge1xuICAgICAgICAgIHJlc3VsdHMuc3VjY2VzcysrXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzdWx0cy5za2lwcGVkKytcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHJlZnJlc2ggdG9rZW46Jywge1xuICAgICAgICAgIHBrOiB0b2tlbi5wayxcbiAgICAgICAgICBzazogdG9rZW4uc2ssXG4gICAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxuICAgICAgICB9KVxuICAgICAgICByZXN1bHRzLmZhaWxlZCsrXG5cbiAgICAgICAgLy8gU2VuZCBmYWlsdXJlIGV2ZW50XG4gICAgICAgIGF3YWl0IHNlbmRFdmVudCgncG9zdG9saW8udG9rZW4tcm90YXRpb24nLCAndG9rZW4ucmVmcmVzaC5mYWlsZWQnLCB7XG4gICAgICAgICAgdXNlcklkOiB0b2tlbi5way5zcGxpdCgnIycpWzBdLFxuICAgICAgICAgIHBsYXRmb3JtOiB0b2tlbi5wbGF0Zm9ybSxcbiAgICAgICAgICBicmFuZElkOiB0b2tlbi5zayxcbiAgICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coJ1Rva2VuIHJvdGF0aW9uIGNvbXBsZXRlZDonLCByZXN1bHRzKVxuXG4gICAgLy8gU2VuZCBzdW1tYXJ5IGV2ZW50XG4gICAgYXdhaXQgc2VuZEV2ZW50KCdwb3N0b2xpby50b2tlbi1yb3RhdGlvbicsICdyb3RhdGlvbi5jb21wbGV0ZWQnLCB7XG4gICAgICAuLi5yZXN1bHRzLFxuICAgICAgdG90YWxQcm9jZXNzZWQ6IGV4cGlyaW5nVG9rZW5zLmxlbmd0aCxcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIH0pXG5cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdUb2tlbiByb3RhdGlvbiBlcnJvcjonLCBlcnJvcilcbiAgICBcbiAgICAvLyBTZW5kIGVycm9yIGV2ZW50XG4gICAgYXdhaXQgc2VuZEV2ZW50KCdwb3N0b2xpby50b2tlbi1yb3RhdGlvbicsICdyb3RhdGlvbi5lcnJvcicsIHtcbiAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIH0pXG4gICAgXG4gICAgdGhyb3cgZXJyb3JcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRFeHBpcmluZ1Rva2VucygpOiBQcm9taXNlPFRva2VuUmVjb3JkW10+IHtcbiAgY29uc3QgZXhwaXJpbmdUb2tlbnM6IFRva2VuUmVjb3JkW10gPSBbXVxuICBjb25zdCBzZXZlbkRheXNGcm9tTm93ID0gRGF0ZS5ub3coKSArICg3ICogMjQgKiA2MCAqIDYwICogMTAwMClcbiAgXG4gIGxldCBsYXN0RXZhbHVhdGVkS2V5OiBhbnkgPSB1bmRlZmluZWRcblxuICAvLyBTY2FuIHRoZSB0YWJsZSBmb3IgZXhwaXJpbmcgdG9rZW5zXG4gIC8vIEluIHByb2R1Y3Rpb24sIHRoaXMgc2hvdWxkIHVzZSBhIEdTSSBvbiBleHBpcmVzQXQgZm9yIGJldHRlciBwZXJmb3JtYW5jZVxuICBkbyB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFNjYW5Db21tYW5kKHtcbiAgICAgIFRhYmxlTmFtZTogVE9LRU5fVEFCTEVfTkFNRSxcbiAgICAgIEZpbHRlckV4cHJlc3Npb246ICdleHBpcmVzQXQgPCA6dGhyZXNob2xkIEFORCBleHBpcmVzQXQgPiA6bm93JyxcbiAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcbiAgICAgICAgJzp0aHJlc2hvbGQnOiBzZXZlbkRheXNGcm9tTm93LFxuICAgICAgICAnOm5vdyc6IERhdGUubm93KCksXG4gICAgICB9LFxuICAgICAgRXhjbHVzaXZlU3RhcnRLZXk6IGxhc3RFdmFsdWF0ZWRLZXksXG4gICAgfSkpXG5cbiAgICBpZiAocmVzdWx0Lkl0ZW1zKSB7XG4gICAgICBleHBpcmluZ1Rva2Vucy5wdXNoKC4uLnJlc3VsdC5JdGVtcyBhcyBUb2tlblJlY29yZFtdKVxuICAgIH1cblxuICAgIGxhc3RFdmFsdWF0ZWRLZXkgPSByZXN1bHQuTGFzdEV2YWx1YXRlZEtleVxuICB9IHdoaWxlIChsYXN0RXZhbHVhdGVkS2V5KVxuXG4gIHJldHVybiBleHBpcmluZ1Rva2Vuc1xufVxuXG5hc3luYyBmdW5jdGlvbiByZWZyZXNoVG9rZW4odG9rZW46IFRva2VuUmVjb3JkKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIC8vIFNraXAgaWYgbm8gcmVmcmVzaCB0b2tlblxuICBpZiAoIXRva2VuLmVuY3J5cHRlZFJlZnJlc2hUb2tlbikge1xuICAgIGNvbnNvbGUubG9nKCdObyByZWZyZXNoIHRva2VuIGF2YWlsYWJsZSwgc2tpcHBpbmc6Jywge1xuICAgICAgcGs6IHRva2VuLnBrLFxuICAgICAgcGxhdGZvcm06IHRva2VuLnBsYXRmb3JtLFxuICAgIH0pXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvLyBEZWNyeXB0IHRva2Vuc1xuICBjb25zdCByZWZyZXNoVG9rZW4gPSBhd2FpdCBkZWNyeXB0RGF0YSh0b2tlbi5lbmNyeXB0ZWRSZWZyZXNoVG9rZW4pXG4gIFxuICAvLyBHZXQgcGxhdGZvcm0tc3BlY2lmaWMgbWV0YWRhdGFcbiAgY29uc3QgbWV0YWRhdGEgPSB0b2tlbi5tZXRhZGF0YSB8fCB7fVxuICBcbiAgLy8gUmVmcmVzaCBiYXNlZCBvbiBwbGF0Zm9ybVxuICBsZXQgcmVmcmVzaFJlc3VsdDogUmVmcmVzaFJlc3VsdCB8IG51bGwgPSBudWxsXG4gIFxuICBzd2l0Y2ggKHRva2VuLnBsYXRmb3JtKSB7XG4gICAgY2FzZSAnaW5zdGFncmFtJzpcbiAgICAgIHJlZnJlc2hSZXN1bHQgPSBhd2FpdCByZWZyZXNoSW5zdGFncmFtVG9rZW4ocmVmcmVzaFRva2VuKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdmYWNlYm9vayc6XG4gICAgICByZWZyZXNoUmVzdWx0ID0gYXdhaXQgcmVmcmVzaEZhY2Vib29rVG9rZW4ocmVmcmVzaFRva2VuLCBtZXRhZGF0YSlcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnbGlua2VkaW4nOlxuICAgICAgcmVmcmVzaFJlc3VsdCA9IGF3YWl0IHJlZnJlc2hMaW5rZWRJblRva2VuKHJlZnJlc2hUb2tlbiwgbWV0YWRhdGEpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3Rpa3Rvayc6XG4gICAgICByZWZyZXNoUmVzdWx0ID0gYXdhaXQgcmVmcmVzaFRpa1Rva1Rva2VuKHJlZnJlc2hUb2tlbiwgbWV0YWRhdGEpXG4gICAgICBicmVha1xuICAgIGRlZmF1bHQ6XG4gICAgICBjb25zb2xlLndhcm4oJ1Vua25vd24gcGxhdGZvcm0gZm9yIHRva2VuIHJlZnJlc2g6JywgdG9rZW4ucGxhdGZvcm0pXG4gICAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIGlmICghcmVmcmVzaFJlc3VsdCkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gRW5jcnlwdCBuZXcgdG9rZW5zXG4gIGNvbnN0IGVuY3J5cHRlZEFjY2Vzc1Rva2VuID0gYXdhaXQgZW5jcnlwdERhdGEocmVmcmVzaFJlc3VsdC5hY2Nlc3NUb2tlbilcbiAgY29uc3QgZW5jcnlwdGVkUmVmcmVzaFRva2VuID0gcmVmcmVzaFJlc3VsdC5yZWZyZXNoVG9rZW5cbiAgICA/IGF3YWl0IGVuY3J5cHREYXRhKHJlZnJlc2hSZXN1bHQucmVmcmVzaFRva2VuKVxuICAgIDogdG9rZW4uZW5jcnlwdGVkUmVmcmVzaFRva2VuIC8vIEtlZXAgb2xkIHJlZnJlc2ggdG9rZW4gaWYgbm90IHJldHVybmVkXG5cbiAgLy8gQ2FsY3VsYXRlIG5ldyBleHBpcnlcbiAgY29uc3QgbmV3RXhwaXJlc0F0ID0gRGF0ZS5ub3coKSArIChyZWZyZXNoUmVzdWx0LmV4cGlyZXNJbiAqIDEwMDApXG5cbiAgLy8gVXBkYXRlIHRva2VuIGluIGRhdGFiYXNlXG4gIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBVcGRhdGVDb21tYW5kKHtcbiAgICBUYWJsZU5hbWU6IFRPS0VOX1RBQkxFX05BTUUsXG4gICAgS2V5OiB7XG4gICAgICBwazogdG9rZW4ucGssXG4gICAgICBzazogdG9rZW4uc2ssXG4gICAgfSxcbiAgICBVcGRhdGVFeHByZXNzaW9uOiAnU0VUIGVuY3J5cHRlZEFjY2Vzc1Rva2VuID0gOmFjY2Vzc1Rva2VuLCBlbmNyeXB0ZWRSZWZyZXNoVG9rZW4gPSA6cmVmcmVzaFRva2VuLCBleHBpcmVzQXQgPSA6ZXhwaXJlc0F0LCBsYXN0UmVmcmVzaGVkID0gOmxhc3RSZWZyZXNoZWQnLFxuICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcbiAgICAgICc6YWNjZXNzVG9rZW4nOiBlbmNyeXB0ZWRBY2Nlc3NUb2tlbixcbiAgICAgICc6cmVmcmVzaFRva2VuJzogZW5jcnlwdGVkUmVmcmVzaFRva2VuLFxuICAgICAgJzpleHBpcmVzQXQnOiBuZXdFeHBpcmVzQXQsXG4gICAgICAnOmxhc3RSZWZyZXNoZWQnOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgfSxcbiAgfSkpXG5cbiAgLy8gU2VuZCBzdWNjZXNzIGV2ZW50XG4gIGF3YWl0IHNlbmRFdmVudCgncG9zdG9saW8udG9rZW4tcm90YXRpb24nLCAndG9rZW4ucmVmcmVzaGVkJywge1xuICAgIHVzZXJJZDogdG9rZW4ucGsuc3BsaXQoJyMnKVswXSxcbiAgICBwbGF0Zm9ybTogdG9rZW4ucGxhdGZvcm0sXG4gICAgYnJhbmRJZDogdG9rZW4uc2ssXG4gICAgbmV3RXhwaXJlc0F0LFxuICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICB9KVxuXG4gIHJldHVybiB0cnVlXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hJbnN0YWdyYW1Ub2tlbihhY2Nlc3NUb2tlbjogc3RyaW5nKTogUHJvbWlzZTxSZWZyZXNoUmVzdWx0PiB7XG4gIC8vIEluc3RhZ3JhbSB1c2VzIGxvbmctbGl2ZWQgdG9rZW5zIHRoYXQgbmVlZCB0byBiZSByZWZyZXNoZWQgZXZlcnkgNjAgZGF5c1xuICB0cnkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0KCdodHRwczovL2dyYXBoLmluc3RhZ3JhbS5jb20vcmVmcmVzaF9hY2Nlc3NfdG9rZW4nLCB7XG4gICAgICBwYXJhbXM6IHtcbiAgICAgICAgZ3JhbnRfdHlwZTogJ2lnX3JlZnJlc2hfdG9rZW4nLFxuICAgICAgICBhY2Nlc3NfdG9rZW46IGFjY2Vzc1Rva2VuLFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjY2Vzc1Rva2VuOiByZXNwb25zZS5kYXRhLmFjY2Vzc190b2tlbixcbiAgICAgIGV4cGlyZXNJbjogcmVzcG9uc2UuZGF0YS5leHBpcmVzX2luIHx8IDUxODQwMDAsIC8vIDYwIGRheXMgZGVmYXVsdFxuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdJbnN0YWdyYW0gdG9rZW4gcmVmcmVzaCBmYWlsZWQ6JywgZXJyb3IpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gcmVmcmVzaCBJbnN0YWdyYW0gdG9rZW4nKVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hGYWNlYm9va1Rva2VuKGN1cnJlbnRUb2tlbjogc3RyaW5nLCBtZXRhZGF0YTogUmVjb3JkPHN0cmluZywgYW55Pik6IFByb21pc2U8UmVmcmVzaFJlc3VsdD4ge1xuICB0cnkge1xuICAgIC8vIEdldCBhcHAgSUQgZnJvbSBlbnZpcm9ubWVudCB2YXJpYWJsZSBhbmQgc2VjcmV0IGZyb20gU2VjcmV0cyBNYW5hZ2VyXG4gICAgY29uc3QgYXBwSWQgPSBwcm9jZXNzLmVudi5GQUNFQk9PS19BUFBfSURcbiAgICBjb25zdCBzZWNyZXRNYW5hZ2VyID0gZ2V0U2VjcmV0TWFuYWdlcigpXG4gICAgY29uc3Qgc2VjcmV0cyA9IGF3YWl0IHNlY3JldE1hbmFnZXIuZ2V0UGxhdGZvcm1TZWNyZXRzKClcbiAgICBjb25zdCBhcHBTZWNyZXQgPSBzZWNyZXRzLkZBQ0VCT09LX0FQUF9TRUNSRVRcbiAgICBcbiAgICBpZiAoIWFwcElkIHx8ICFhcHBTZWNyZXQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignRmFjZWJvb2sgYXBwIGNyZWRlbnRpYWxzIG5vdCBhdmFpbGFibGUnKVxuICAgIH1cblxuICAgIC8vIEV4Y2hhbmdlIGZvciBsb25nLWxpdmVkIHRva2VuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQoJ2h0dHBzOi8vZ3JhcGguZmFjZWJvb2suY29tL3YxOC4wL29hdXRoL2FjY2Vzc190b2tlbicsIHtcbiAgICAgIHBhcmFtczoge1xuICAgICAgICBncmFudF90eXBlOiAnZmJfZXhjaGFuZ2VfdG9rZW4nLFxuICAgICAgICBjbGllbnRfaWQ6IGFwcElkLFxuICAgICAgICBjbGllbnRfc2VjcmV0OiBhcHBTZWNyZXQsXG4gICAgICAgIGZiX2V4Y2hhbmdlX3Rva2VuOiBjdXJyZW50VG9rZW4sXG4gICAgICB9LFxuICAgIH0pXG5cbiAgICByZXR1cm4ge1xuICAgICAgYWNjZXNzVG9rZW46IHJlc3BvbnNlLmRhdGEuYWNjZXNzX3Rva2VuLFxuICAgICAgZXhwaXJlc0luOiByZXNwb25zZS5kYXRhLmV4cGlyZXNfaW4gfHwgNTE4NDAwMCwgLy8gNjAgZGF5cyBkZWZhdWx0XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoJ0ZhY2Vib29rIHRva2VuIHJlZnJlc2ggZmFpbGVkOicsIGVycm9yKVxuICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIHJlZnJlc2ggRmFjZWJvb2sgdG9rZW4nKVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hMaW5rZWRJblRva2VuKHJlZnJlc2hUb2tlbjogc3RyaW5nLCBtZXRhZGF0YTogUmVjb3JkPHN0cmluZywgYW55Pik6IFByb21pc2U8UmVmcmVzaFJlc3VsdD4ge1xuICB0cnkge1xuICAgIC8vIEdldCBjbGllbnQgSUQgZnJvbSBlbnZpcm9ubWVudCB2YXJpYWJsZSBhbmQgc2VjcmV0IGZyb20gU2VjcmV0cyBNYW5hZ2VyXG4gICAgY29uc3QgY2xpZW50SWQgPSBwcm9jZXNzLmVudi5MSU5LRURJTl9DTElFTlRfSURcbiAgICBjb25zdCBzZWNyZXRNYW5hZ2VyID0gZ2V0U2VjcmV0TWFuYWdlcigpXG4gICAgY29uc3Qgc2VjcmV0cyA9IGF3YWl0IHNlY3JldE1hbmFnZXIuZ2V0UGxhdGZvcm1TZWNyZXRzKClcbiAgICBjb25zdCBjbGllbnRTZWNyZXQgPSBzZWNyZXRzLkxJTktFRElOX0NMSUVOVF9TRUNSRVRcbiAgICBcbiAgICBpZiAoIWNsaWVudElkIHx8ICFjbGllbnRTZWNyZXQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTGlua2VkSW4gY2xpZW50IGNyZWRlbnRpYWxzIG5vdCBhdmFpbGFibGUnKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MucG9zdCgnaHR0cHM6Ly93d3cubGlua2VkaW4uY29tL29hdXRoL3YyL2FjY2Vzc1Rva2VuJywgbnVsbCwge1xuICAgICAgcGFyYW1zOiB7XG4gICAgICAgIGdyYW50X3R5cGU6ICdyZWZyZXNoX3Rva2VuJyxcbiAgICAgICAgcmVmcmVzaF90b2tlbjogcmVmcmVzaFRva2VuLFxuICAgICAgICBjbGllbnRfaWQ6IGNsaWVudElkLFxuICAgICAgICBjbGllbnRfc2VjcmV0OiBjbGllbnRTZWNyZXQsXG4gICAgICB9LFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcsXG4gICAgICB9LFxuICAgIH0pXG5cbiAgICByZXR1cm4ge1xuICAgICAgYWNjZXNzVG9rZW46IHJlc3BvbnNlLmRhdGEuYWNjZXNzX3Rva2VuLFxuICAgICAgcmVmcmVzaFRva2VuOiByZXNwb25zZS5kYXRhLnJlZnJlc2hfdG9rZW4gfHwgcmVmcmVzaFRva2VuLFxuICAgICAgZXhwaXJlc0luOiByZXNwb25zZS5kYXRhLmV4cGlyZXNfaW4gfHwgNTE4NDAwMCwgLy8gNjAgZGF5cyBkZWZhdWx0XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoJ0xpbmtlZEluIHRva2VuIHJlZnJlc2ggZmFpbGVkOicsIGVycm9yKVxuICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIHJlZnJlc2ggTGlua2VkSW4gdG9rZW4nKVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hUaWtUb2tUb2tlbihyZWZyZXNoVG9rZW46IHN0cmluZywgbWV0YWRhdGE6IFJlY29yZDxzdHJpbmcsIGFueT4pOiBQcm9taXNlPFJlZnJlc2hSZXN1bHQ+IHtcbiAgdHJ5IHtcbiAgICAvLyBHZXQgY2xpZW50IGtleSBmcm9tIGVudmlyb25tZW50IHZhcmlhYmxlIGFuZCBzZWNyZXQgZnJvbSBTZWNyZXRzIE1hbmFnZXJcbiAgICBjb25zdCBjbGllbnRLZXkgPSBwcm9jZXNzLmVudi5USUtUT0tfQ0xJRU5UX0tFWVxuICAgIGNvbnN0IHNlY3JldE1hbmFnZXIgPSBnZXRTZWNyZXRNYW5hZ2VyKClcbiAgICBjb25zdCBzZWNyZXRzID0gYXdhaXQgc2VjcmV0TWFuYWdlci5nZXRQbGF0Zm9ybVNlY3JldHMoKVxuICAgIGNvbnN0IGNsaWVudFNlY3JldCA9IHNlY3JldHMuVElLVE9LX0NMSUVOVF9TRUNSRVRcbiAgICBcbiAgICBpZiAoIWNsaWVudEtleSB8fCAhY2xpZW50U2VjcmV0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Rpa1RvayBjbGllbnQgY3JlZGVudGlhbHMgbm90IGF2YWlsYWJsZScpXG4gICAgfVxuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5wb3N0KCdodHRwczovL29wZW4udGlrdG9rYXBpcy5jb20vdjIvb2F1dGgvdG9rZW4vJywge1xuICAgICAgY2xpZW50X2tleTogY2xpZW50S2V5LFxuICAgICAgY2xpZW50X3NlY3JldDogY2xpZW50U2VjcmV0LFxuICAgICAgZ3JhbnRfdHlwZTogJ3JlZnJlc2hfdG9rZW4nLFxuICAgICAgcmVmcmVzaF90b2tlbjogcmVmcmVzaFRva2VuLFxuICAgIH0sIHtcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgJ0NhY2hlLUNvbnRyb2wnOiAnbm8tY2FjaGUnLFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjY2Vzc1Rva2VuOiByZXNwb25zZS5kYXRhLmFjY2Vzc190b2tlbixcbiAgICAgIHJlZnJlc2hUb2tlbjogcmVzcG9uc2UuZGF0YS5yZWZyZXNoX3Rva2VuLFxuICAgICAgZXhwaXJlc0luOiByZXNwb25zZS5kYXRhLmV4cGlyZXNfaW4gfHwgODY0MDAsIC8vIDEgZGF5IGRlZmF1bHQgZm9yIFRpa1Rva1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdUaWtUb2sgdG9rZW4gcmVmcmVzaCBmYWlsZWQ6JywgZXJyb3IpXG4gICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gcmVmcmVzaCBUaWtUb2sgdG9rZW4nKVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVuY3J5cHREYXRhKGRhdGE6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGttc0NsaWVudC5zZW5kKG5ldyBFbmNyeXB0Q29tbWFuZCh7XG4gICAgS2V5SWQ6IEtNU19LRVlfSUQsXG4gICAgUGxhaW50ZXh0OiBCdWZmZXIuZnJvbShkYXRhKSxcbiAgfSkpXG5cbiAgcmV0dXJuIEJ1ZmZlci5mcm9tKHJlc3VsdC5DaXBoZXJ0ZXh0QmxvYiEpLnRvU3RyaW5nKCdiYXNlNjQnKVxufVxuXG5hc3luYyBmdW5jdGlvbiBkZWNyeXB0RGF0YShlbmNyeXB0ZWREYXRhOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBrbXNDbGllbnQuc2VuZChuZXcgRGVjcnlwdENvbW1hbmQoe1xuICAgIENpcGhlcnRleHRCbG9iOiBCdWZmZXIuZnJvbShlbmNyeXB0ZWREYXRhLCAnYmFzZTY0JyksXG4gIH0pKVxuXG4gIHJldHVybiBCdWZmZXIuZnJvbShyZXN1bHQuUGxhaW50ZXh0ISkudG9TdHJpbmcoKVxufVxuXG5hc3luYyBmdW5jdGlvbiBzZW5kRXZlbnQoc291cmNlOiBzdHJpbmcsIGRldGFpbFR5cGU6IHN0cmluZywgZGV0YWlsOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgZXZlbnRCcmlkZ2VDbGllbnQuc2VuZChuZXcgUHV0RXZlbnRzQ29tbWFuZCh7XG4gICAgRW50cmllczogW3tcbiAgICAgIFNvdXJjZTogc291cmNlLFxuICAgICAgRGV0YWlsVHlwZTogZGV0YWlsVHlwZSxcbiAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoZGV0YWlsKSxcbiAgICAgIEV2ZW50QnVzTmFtZTogRVZFTlRfQlVTX05BTUUsXG4gICAgfV0sXG4gIH0pKVxufSJdfQ==