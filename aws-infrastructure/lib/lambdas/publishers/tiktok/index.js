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
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const kmsClient = new client_kms_1.KMSClient({});
const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({});
const TOKEN_TABLE_NAME = process.env.TOKEN_TABLE_NAME;
const JOB_STATE_TABLE_NAME = process.env.JOB_STATE_TABLE_NAME;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const KMS_KEY_ID = process.env.KMS_KEY_ID;
const handler = async (event) => {
    console.log('TikTok Publisher Lambda invoked', {
        records: event.Records.length,
    });
    // Process each message
    for (const record of event.Records) {
        try {
            await processMessage(record);
        }
        catch (error) {
            console.error('Error processing message:', error, {
                messageId: record.messageId,
                body: record.body,
            });
            // Throw error to send message to DLQ after retries
            throw error;
        }
    }
};
exports.handler = handler;
async function processMessage(record) {
    const request = JSON.parse(record.body);
    console.log('Processing publish request:', request);
    // Create job state entry
    const jobId = `${request.scheduleId}-${Date.now()}`;
    await updateJobState(jobId, 'processing', request);
    try {
        // Check if content is video (TikTok requires video)
        if (request.content.mediaType !== 'video') {
            throw new Error('TikTok requires video content');
        }
        // Get OAuth token
        const token = await getToken(request.userId, request.brandId, 'tiktok');
        if (!token) {
            throw new Error('TikTok token not found');
        }
        // Check if token needs refresh
        if (token.needsRefresh && token.refreshToken) {
            const newToken = await refreshTikTokToken(token.refreshToken, request.metadata?.clientKey, request.metadata?.clientSecret);
            await storeRefreshedToken(request.userId, request.brandId, newToken);
            token.accessToken = newToken.accessToken;
        }
        // Get TikTok Open ID from metadata
        const openId = request.metadata?.openId;
        if (!openId) {
            throw new Error('TikTok Open ID not found in metadata');
        }
        // Publish to TikTok
        const result = await publishToTikTok(openId, token.accessToken, request.content, request.metadata?.clientKey);
        // Update job state with success
        await updateJobState(jobId, 'completed', {
            ...request,
            result,
        });
        // Send success event
        await sendEvent('postolio.publisher.tiktok', 'post.published', {
            scheduleId: request.scheduleId,
            contentId: request.contentId,
            brandId: request.brandId,
            userId: request.userId,
            platform: 'tiktok',
            publishId: result.publish_id,
            shareUrl: result.share_url,
            publishedAt: new Date().toISOString(),
        });
    }
    catch (error) {
        console.error('Publishing failed:', error);
        // Update job state with failure
        await updateJobState(jobId, 'failed', {
            ...request,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Send failure event
        await sendEvent('postolio.publisher.tiktok', 'post.failed', {
            scheduleId: request.scheduleId,
            contentId: request.contentId,
            brandId: request.brandId,
            userId: request.userId,
            platform: 'tiktok',
            error: error instanceof Error ? error.message : 'Unknown error',
            failedAt: new Date().toISOString(),
        });
        throw error;
    }
}
async function getToken(userId, brandId, platform) {
    const result = await docClient.send(new lib_dynamodb_1.GetCommand({
        TableName: TOKEN_TABLE_NAME,
        Key: {
            pk: `${userId}#${platform}`,
            sk: brandId,
        },
    }));
    if (!result.Item) {
        return null;
    }
    // Decrypt token
    const accessToken = await decryptData(result.Item.encryptedAccessToken);
    const refreshToken = result.Item.encryptedRefreshToken
        ? await decryptData(result.Item.encryptedRefreshToken)
        : null;
    // Check if token needs refresh (TikTok tokens expire after 1 day)
    const expiryTime = result.Item.expiresAt;
    const refreshThreshold = Date.now() + (2 * 60 * 60 * 1000); // 2 hours
    const needsRefresh = expiryTime < refreshThreshold;
    return {
        accessToken,
        refreshToken,
        expiresAt: result.Item.expiresAt,
        needsRefresh,
    };
}
async function decryptData(encryptedData) {
    const result = await kmsClient.send(new client_kms_1.DecryptCommand({
        CiphertextBlob: Buffer.from(encryptedData, 'base64'),
    }));
    return Buffer.from(result.Plaintext).toString();
}
async function refreshTikTokToken(refreshToken, clientKey, clientSecret) {
    // TikTok OAuth 2.0 token refresh
    if (!clientKey || !clientSecret) {
        throw new Error('TikTok client credentials required for token refresh');
    }
    try {
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
            expiresIn: response.data.expires_in,
            scope: response.data.scope,
        };
    }
    catch (error) {
        console.error('Token refresh failed:', error);
        throw new Error('Failed to refresh TikTok token');
    }
}
async function storeRefreshedToken(userId, brandId, token) {
    // Encrypt new tokens
    const encryptedAccessToken = await encryptData(token.accessToken);
    const encryptedRefreshToken = token.refreshToken
        ? await encryptData(token.refreshToken)
        : null;
    // Calculate new expiry
    const expiresAt = Date.now() + (token.expiresIn * 1000);
    // Store in DynamoDB
    await docClient.send(new lib_dynamodb_1.PutCommand({
        TableName: TOKEN_TABLE_NAME,
        Item: {
            pk: `${userId}#tiktok`,
            sk: brandId,
            platform: 'tiktok',
            encryptedAccessToken,
            encryptedRefreshToken,
            expiresAt,
            lastRefreshed: new Date().toISOString(),
            ttl: Math.floor(expiresAt / 1000) + 86400, // TTL 1 day after expiry
        },
    }));
    // Emit event for monitoring
    await sendEvent('postolio.token', 'token.refreshed', {
        userId,
        brandId,
        platform: 'tiktok',
        expiresAt,
        timestamp: new Date().toISOString(),
    });
    console.log('Token refreshed and stored successfully', {
        userId,
        brandId,
        platform: 'tiktok',
        expiresAt,
    });
}
// Helper function for encryption
async function encryptData(plainText) {
    const result = await kmsClient.send(new client_kms_1.EncryptCommand({
        KeyId: KMS_KEY_ID,
        Plaintext: Buffer.from(plainText),
    }));
    return Buffer.from(result.CiphertextBlob).toString('base64');
}
async function publishToTikTok(openId, accessToken, content, clientKey) {
    try {
        // TikTok Content Posting API (v2)
        // Note: This is a simplified version. Real implementation requires:
        // 1. Upload video to TikTok's servers
        // 2. Create post with uploaded video
        if (!content.mediaUrl) {
            throw new Error('Video URL is required for TikTok posts');
        }
        if (!clientKey) {
            throw new Error('TikTok client key is required');
        }
        // Step 1: Initialize video upload
        const initResponse = await axios_1.default.post('https://open.tiktokapis.com/v2/post/publish/video/init', {
            post_info: {
                title: formatCaption(content.caption, content.hashtags),
                privacy_level: 'PUBLIC',
                disable_duet: false,
                disable_comment: false,
                disable_stitch: false,
                video_cover_timestamp_ms: 1000, // 1 second into video
            },
            source_info: {
                source: 'FILE_UPLOAD',
                video_size: await getVideoSize(content.mediaUrl),
                chunk_size: 10485760, // 10MB chunks
                total_chunk_count: 1, // For simplicity, assuming single chunk
            },
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        const uploadUrl = initResponse.data.data.upload_url;
        const publishId = initResponse.data.data.publish_id;
        // Step 2: Upload video file
        const videoData = await downloadVideo(content.mediaUrl);
        await axios_1.default.put(uploadUrl, videoData, {
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Range': `bytes 0-${videoData.length - 1}/${videoData.length}`,
            },
        });
        // Step 3: Check upload status
        const statusResponse = await axios_1.default.post('https://open.tiktokapis.com/v2/post/publish/status/fetch', {
            publish_id: publishId,
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        // Note: In production, you'd need to poll this endpoint until status is 'PUBLISH_COMPLETE'
        return {
            publish_id: publishId,
            status: statusResponse.data.data.status,
            share_url: statusResponse.data.data.share_url,
        };
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error)) {
            const axiosError = error;
            console.error('TikTok API error:', {
                status: axiosError.response?.status,
                data: axiosError.response?.data,
            });
            // Handle rate limiting
            if (axiosError.response?.status === 429) {
                throw new Error('TikTok API rate limit exceeded');
            }
            // Handle quota exceeded
            const errorData = axiosError.response?.data;
            if (errorData?.error?.code === 'rate_limit_exceeded') {
                throw new Error('TikTok daily post limit reached');
            }
            // Handle other API errors
            const errorMessage = errorData?.error?.message || 'TikTok API error';
            throw new Error(errorMessage);
        }
        throw error;
    }
}
async function getVideoSize(videoUrl) {
    // Get video file size for upload initialization
    try {
        const response = await axios_1.default.head(videoUrl);
        const contentLength = response.headers['content-length'];
        return parseInt(contentLength, 10);
    }
    catch (error) {
        console.error('Failed to get video size:', error);
        // Return a default size if we can't determine it
        return 10485760; // 10MB default
    }
}
async function downloadVideo(videoUrl) {
    // Download video file for upload
    try {
        const response = await axios_1.default.get(videoUrl, {
            responseType: 'arraybuffer',
            maxContentLength: 100000000, // 100MB max
            maxBodyLength: 100000000,
        });
        return Buffer.from(response.data);
    }
    catch (error) {
        console.error('Failed to download video:', error);
        throw new Error('Failed to download video for TikTok upload');
    }
}
function formatCaption(caption, hashtags) {
    // TikTok best practices:
    // - Maximum 2,200 characters for captions
    // - Hashtags are very important for discovery
    // - Trending hashtags can boost visibility
    const hashtagString = hashtags
        .slice(0, 20) // TikTok allows many hashtags
        .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
        .join(' ');
    const fullCaption = `${caption} ${hashtagString}`;
    // Truncate if too long
    if (fullCaption.length > 2200) {
        const truncatedCaption = caption.substring(0, 2200 - hashtagString.length - 4);
        return `${truncatedCaption}... ${hashtagString}`;
    }
    return fullCaption;
}
async function updateJobState(jobId, status, data) {
    await docClient.send(new lib_dynamodb_1.PutCommand({
        TableName: JOB_STATE_TABLE_NAME,
        Item: {
            jobId,
            status,
            data,
            updatedAt: new Date().toISOString(),
            ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days TTL
        },
    }));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSw4REFBeUQ7QUFDekQsd0RBQXNGO0FBQ3RGLG9EQUErRTtBQUMvRSxvRUFBaUY7QUFDakYsa0RBQXlDO0FBRXpDLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtBQUMzQyxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUE7QUFDM0QsTUFBTSxTQUFTLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEVBQUUsQ0FBQyxDQUFBO0FBQ25DLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxzQ0FBaUIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtBQUVuRCxNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWlCLENBQUE7QUFDdEQsTUFBTSxvQkFBb0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFxQixDQUFBO0FBQzlELE1BQU0sY0FBYyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBZSxDQUFBO0FBQ2xELE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVyxDQUFBO0FBdUJuQyxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQUUsS0FBZSxFQUFpQixFQUFFO0lBQzlELE9BQU8sQ0FBQyxHQUFHLENBQUMsaUNBQWlDLEVBQUU7UUFDN0MsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTTtLQUM5QixDQUFDLENBQUE7SUFFRix1QkFBdUI7SUFDdkIsS0FBSyxNQUFNLE1BQU0sSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDbkMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDOUIsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMs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QkFDOUIsWUFBWSxFQUFFLGNBQWM7YUFDN0IsQ0FBQztLQUNILENBQUMsQ0FBQyxDQUFBO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNRU0V2ZW50LCBTUVNSZWNvcmQgfSBmcm9tICdhd3MtbGFtYmRhJ1xuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBHZXRDb21tYW5kLCBQdXRDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJ1xuaW1wb3J0IHsgS01TQ2xpZW50LCBEZWNyeXB0Q29tbWFuZCwgRW5jcnlwdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQta21zJ1xuaW1wb3J0IHsgRXZlbnRCcmlkZ2VDbGllbnQsIFB1dEV2ZW50c0NvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZXZlbnRicmlkZ2UnXG5pbXBvcnQgYXhpb3MsIHsgQXhpb3NFcnJvciB9IGZyb20gJ2F4aW9zJ1xuXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KVxuY29uc3Qga21zQ2xpZW50ID0gbmV3IEtNU0NsaWVudCh7fSlcbmNvbnN0IGV2ZW50QnJpZGdlQ2xpZW50ID0gbmV3IEV2ZW50QnJpZGdlQ2xpZW50KHt9KVxuXG5jb25zdCBUT0tFTl9UQUJMRV9OQU1FID0gcHJvY2Vzcy5lbnYuVE9LRU5fVEFCTEVfTkFNRSFcbmNvbnN0IEpPQl9TVEFURV9UQUJMRV9OQU1FID0gcHJvY2Vzcy5lbnYuSk9CX1NUQVRFX1RBQkxFX05BTUUhXG5jb25zdCBFVkVOVF9CVVNfTkFNRSA9IHByb2Nlc3MuZW52LkVWRU5UX0JVU19OQU1FIVxuY29uc3QgS01TX0tFWV9JRCA9IHByb2Nlc3MuZW52LktNU19LRVlfSUQhXG5cbmludGVyZmFjZSBQdWJsaXNoUmVxdWVzdCB7XG4gIHNjaGVkdWxlSWQ6IHN0cmluZ1xuICBjb250ZW50SWQ6IHN0cmluZ1xuICBicmFuZElkOiBzdHJpbmdcbiAgdXNlcklkOiBzdHJpbmdcbiAgcGxhdGZvcm06IHN0cmluZ1xuICBjb250ZW50OiB7XG4gICAgY2FwdGlvbjogc3RyaW5nXG4gICAgaGFzaHRhZ3M6IHN0cmluZ1tdXG4gICAgbWVkaWFVcmw/OiBzdHJpbmdcbiAgICBtZWRpYVR5cGU/OiAnaW1hZ2UnIHwgJ3ZpZGVvJ1xuICB9XG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgYW55PlxufVxuXG5pbnRlcmZhY2UgVGlrVG9rVmlkZW9SZXNwb25zZSB7XG4gIHB1Ymxpc2hfaWQ6IHN0cmluZ1xuICBzdGF0dXM6IHN0cmluZ1xuICBzaGFyZV91cmw/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoZXZlbnQ6IFNRU0V2ZW50KTogUHJvbWlzZTx2b2lkPiA9PiB7XG4gIGNvbnNvbGUubG9nKCdUaWtUb2sgUHVibGlzaGVyIExhbWJkYSBpbnZva2VkJywge1xuICAgIHJlY29yZHM6IGV2ZW50LlJlY29yZHMubGVuZ3RoLFxuICB9KVxuXG4gIC8vIFByb2Nlc3MgZWFjaCBtZXNzYWdlXG4gIGZvciAoY29uc3QgcmVjb3JkIG9mIGV2ZW50LlJlY29yZHMpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgcHJvY2Vzc01lc3NhZ2UocmVjb3JkKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBwcm9jZXNzaW5nIG1lc3NhZ2U6JywgZXJyb3IsIHtcbiAgICAgICAgbWVzc2FnZUlkOiByZWNvcmQubWVzc2FnZUlkLFxuICAgICAgICBib2R5OiByZWNvcmQuYm9keSxcbiAgICAgIH0pXG4gICAgICBcbiAgICAgIC8vIFRocm93IGVycm9yIHRvIHNlbmQgbWVzc2FnZSB0byBETFEgYWZ0ZXIgcmV0cmllc1xuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcHJvY2Vzc01lc3NhZ2UocmVjb3JkOiBTUVNSZWNvcmQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgcmVxdWVzdDogUHVibGlzaFJlcXVlc3QgPSBKU09OLnBhcnNlKHJlY29yZC5ib2R5KVxuICBjb25zb2xlLmxvZygnUHJvY2Vzc2luZyBwdWJsaXNoIHJlcXVlc3Q6JywgcmVxdWVzdClcblxuICAvLyBDcmVhdGUgam9iIHN0YXRlIGVudHJ5XG4gIGNvbnN0IGpvYklkID0gYCR7cmVxdWVzdC5zY2hlZHVsZUlkfS0ke0RhdGUubm93KCl9YFxuICBhd2FpdCB1cGRhdGVKb2JTdGF0ZShqb2JJZCwgJ3Byb2Nlc3NpbmcnLCByZXF1ZXN0KVxuXG4gIHRyeSB7XG4gICAgLy8gQ2hlY2sgaWYgY29udGVudCBpcyB2aWRlbyAoVGlrVG9rIHJlcXVpcmVzIHZpZGVvKVxuICAgIGlmIChyZXF1ZXN0LmNvbnRlbnQubWVkaWFUeXBlICE9PSAndmlkZW8nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Rpa1RvayByZXF1aXJlcyB2aWRlbyBjb250ZW50JylcbiAgICB9XG5cbiAgICAvLyBHZXQgT0F1dGggdG9rZW5cbiAgICBjb25zdCB0b2tlbiA9IGF3YWl0IGdldFRva2VuKHJlcXVlc3QudXNlcklkLCByZXF1ZXN0LmJyYW5kSWQsICd0aWt0b2snKVxuICAgIGlmICghdG9rZW4pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignVGlrVG9rIHRva2VuIG5vdCBmb3VuZCcpXG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgaWYgdG9rZW4gbmVlZHMgcmVmcmVzaFxuICAgIGlmICh0b2tlbi5uZWVkc1JlZnJlc2ggJiYgdG9rZW4ucmVmcmVzaFRva2VuKSB7XG4gICAgICBjb25zdCBuZXdUb2tlbiA9IGF3YWl0IHJlZnJlc2hUaWtUb2tUb2tlbihcbiAgICAgICAgdG9rZW4ucmVmcmVzaFRva2VuLFxuICAgICAgICByZXF1ZXN0Lm1ldGFkYXRhPy5jbGllbnRLZXksXG4gICAgICAgIHJlcXVlc3QubWV0YWRhdGE/LmNsaWVudFNlY3JldFxuICAgICAgKVxuICAgICAgYXdhaXQgc3RvcmVSZWZyZXNoZWRUb2tlbihyZXF1ZXN0LnVzZXJJZCwgcmVxdWVzdC5icmFuZElkLCBuZXdUb2tlbilcbiAgICAgIHRva2VuLmFjY2Vzc1Rva2VuID0gbmV3VG9rZW4uYWNjZXNzVG9rZW5cbiAgICB9XG5cbiAgICAvLyBHZXQgVGlrVG9rIE9wZW4gSUQgZnJvbSBtZXRhZGF0YVxuICAgIGNvbnN0IG9wZW5JZCA9IHJlcXVlc3QubWV0YWRhdGE/Lm9wZW5JZFxuICAgIGlmICghb3BlbklkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Rpa1RvayBPcGVuIElEIG5vdCBmb3VuZCBpbiBtZXRhZGF0YScpXG4gICAgfVxuXG4gICAgLy8gUHVibGlzaCB0byBUaWtUb2tcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwdWJsaXNoVG9UaWtUb2soXG4gICAgICBvcGVuSWQsXG4gICAgICB0b2tlbi5hY2Nlc3NUb2tlbixcbiAgICAgIHJlcXVlc3QuY29udGVudCxcbiAgICAgIHJlcXVlc3QubWV0YWRhdGE/LmNsaWVudEtleVxuICAgIClcblxuICAgIC8vIFVwZGF0ZSBqb2Igc3RhdGUgd2l0aCBzdWNjZXNzXG4gICAgYXdhaXQgdXBkYXRlSm9iU3RhdGUoam9iSWQsICdjb21wbGV0ZWQnLCB7XG4gICAgICAuLi5yZXF1ZXN0LFxuICAgICAgcmVzdWx0LFxuICAgIH0pXG5cbiAgICAvLyBTZW5kIHN1Y2Nlc3MgZXZlbnRcbiAgICBhd2FpdCBzZW5kRXZlbnQoJ3Bvc3RvbGlvLnB1Ymxpc2hlci50aWt0b2snLCAncG9zdC5wdWJsaXNoZWQnLCB7XG4gICAgICBzY2hlZHVsZUlkOiByZXF1ZXN0LnNjaGVkdWxlSWQsXG4gICAgICBjb250ZW50SWQ6IHJlcXVlc3QuY29udGVudElkLFxuICAgICAgYnJhbmRJZDogcmVxdWVzdC5icmFuZElkLFxuICAgICAgdXNlcklkOiByZXF1ZXN0LnVzZXJJZCxcbiAgICAgIHBsYXRmb3JtOiAndGlrdG9rJyxcbiAgICAgIHB1Ymxpc2hJZDogcmVzdWx0LnB1Ymxpc2hfaWQsXG4gICAgICBzaGFyZVVybDogcmVzdWx0LnNoYXJlX3VybCxcbiAgICAgIHB1Ymxpc2hlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgfSlcblxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1B1Ymxpc2hpbmcgZmFpbGVkOicsIGVycm9yKVxuXG4gICAgLy8gVXBkYXRlIGpvYiBzdGF0ZSB3aXRoIGZhaWx1cmVcbiAgICBhd2FpdCB1cGRhdGVKb2JTdGF0ZShqb2JJZCwgJ2ZhaWxlZCcsIHtcbiAgICAgIC4uLnJlcXVlc3QsXG4gICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgfSlcblxuICAgIC8vIFNlbmQgZmFpbHVyZSBldmVudFxuICAgIGF3YWl0IHNlbmRFdmVudCgncG9zdG9saW8ucHVibGlzaGVyLnRpa3RvaycsICdwb3N0LmZhaWxlZCcsIHtcbiAgICAgIHNjaGVkdWxlSWQ6IHJlcXVlc3Quc2NoZWR1bGVJZCxcbiAgICAgIGNvbnRlbnRJZDogcmVxdWVzdC5jb250ZW50SWQsXG4gICAgICBicmFuZElkOiByZXF1ZXN0LmJyYW5kSWQsXG4gICAgICB1c2VySWQ6IHJlcXVlc3QudXNlcklkLFxuICAgICAgcGxhdGZvcm06ICd0aWt0b2snLFxuICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxuICAgICAgZmFpbGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICB9KVxuXG4gICAgdGhyb3cgZXJyb3JcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRUb2tlbih1c2VySWQ6IHN0cmluZywgYnJhbmRJZDogc3RyaW5nLCBwbGF0Zm9ybTogc3RyaW5nKTogUHJvbWlzZTxhbnk+IHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xuICAgIFRhYmxlTmFtZTogVE9LRU5fVEFCTEVfTkFNRSxcbiAgICBLZXk6IHtcbiAgICAgIHBrOiBgJHt1c2VySWR9IyR7cGxhdGZvcm19YCxcbiAgICAgIHNrOiBicmFuZElkLFxuICAgIH0sXG4gIH0pKVxuXG4gIGlmICghcmVzdWx0Lkl0ZW0pIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLy8gRGVjcnlwdCB0b2tlblxuICBjb25zdCBhY2Nlc3NUb2tlbiA9IGF3YWl0IGRlY3J5cHREYXRhKHJlc3VsdC5JdGVtLmVuY3J5cHRlZEFjY2Vzc1Rva2VuKVxuICBjb25zdCByZWZyZXNoVG9rZW4gPSByZXN1bHQuSXRlbS5lbmNyeXB0ZWRSZWZyZXNoVG9rZW5cbiAgICA/IGF3YWl0IGRlY3J5cHREYXRhKHJlc3VsdC5JdGVtLmVuY3J5cHRlZFJlZnJlc2hUb2tlbilcbiAgICA6IG51bGxcblxuICAvLyBDaGVjayBpZiB0b2tlbiBuZWVkcyByZWZyZXNoIChUaWtUb2sgdG9rZW5zIGV4cGlyZSBhZnRlciAxIGRheSlcbiAgY29uc3QgZXhwaXJ5VGltZSA9IHJlc3VsdC5JdGVtLmV4cGlyZXNBdFxuICBjb25zdCByZWZyZXNoVGhyZXNob2xkID0gRGF0ZS5ub3coKSArICgyICogNjAgKiA2MCAqIDEwMDApIC8vIDIgaG91cnNcbiAgY29uc3QgbmVlZHNSZWZyZXNoID0gZXhwaXJ5VGltZSA8IHJlZnJlc2hUaHJlc2hvbGRcblxuICByZXR1cm4ge1xuICAgIGFjY2Vzc1Rva2VuLFxuICAgIHJlZnJlc2hUb2tlbixcbiAgICBleHBpcmVzQXQ6IHJlc3VsdC5JdGVtLmV4cGlyZXNBdCxcbiAgICBuZWVkc1JlZnJlc2gsXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZGVjcnlwdERhdGEoZW5jcnlwdGVkRGF0YTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQga21zQ2xpZW50LnNlbmQobmV3IERlY3J5cHRDb21tYW5kKHtcbiAgICBDaXBoZXJ0ZXh0QmxvYjogQnVmZmVyLmZyb20oZW5jcnlwdGVkRGF0YSwgJ2Jhc2U2NCcpLFxuICB9KSlcblxuICByZXR1cm4gQnVmZmVyLmZyb20ocmVzdWx0LlBsYWludGV4dCEpLnRvU3RyaW5nKClcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFRpa1Rva1Rva2VuKFxuICByZWZyZXNoVG9rZW46IHN0cmluZyxcbiAgY2xpZW50S2V5Pzogc3RyaW5nLFxuICBjbGllbnRTZWNyZXQ/OiBzdHJpbmdcbik6IFByb21pc2U8YW55PiB7XG4gIC8vIFRpa1RvayBPQXV0aCAyLjAgdG9rZW4gcmVmcmVzaFxuICBpZiAoIWNsaWVudEtleSB8fCAhY2xpZW50U2VjcmV0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdUaWtUb2sgY2xpZW50IGNyZWRlbnRpYWxzIHJlcXVpcmVkIGZvciB0b2tlbiByZWZyZXNoJylcbiAgfVxuICBcbiAgdHJ5IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLnBvc3QoJ2h0dHBzOi8vb3Blbi50aWt0b2thcGlzLmNvbS92Mi9vYXV0aC90b2tlbi8nLCB7XG4gICAgICBjbGllbnRfa2V5OiBjbGllbnRLZXksXG4gICAgICBjbGllbnRfc2VjcmV0OiBjbGllbnRTZWNyZXQsXG4gICAgICBncmFudF90eXBlOiAncmVmcmVzaF90b2tlbicsXG4gICAgICByZWZyZXNoX3Rva2VuOiByZWZyZXNoVG9rZW4sXG4gICAgfSwge1xuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAnQ2FjaGUtQ29udHJvbCc6ICduby1jYWNoZScsXG4gICAgICB9LFxuICAgIH0pXG5cbiAgICByZXR1cm4ge1xuICAgICAgYWNjZXNzVG9rZW46IHJlc3BvbnNlLmRhdGEuYWNjZXNzX3Rva2VuLFxuICAgICAgcmVmcmVzaFRva2VuOiByZXNwb25zZS5kYXRhLnJlZnJlc2hfdG9rZW4sXG4gICAgICBleHBpcmVzSW46IHJlc3BvbnNlLmRhdGEuZXhwaXJlc19pbixcbiAgICAgIHNjb3BlOiByZXNwb25zZS5kYXRhLnNjb3BlLFxuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdUb2tlbiByZWZyZXNoIGZhaWxlZDonLCBlcnJvcilcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byByZWZyZXNoIFRpa1RvayB0b2tlbicpXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gc3RvcmVSZWZyZXNoZWRUb2tlbih1c2VySWQ6IHN0cmluZywgYnJhbmRJZDogc3RyaW5nLCB0b2tlbjogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gIC8vIEVuY3J5cHQgbmV3IHRva2Vuc1xuICBjb25zdCBlbmNyeXB0ZWRBY2Nlc3NUb2tlbiA9IGF3YWl0IGVuY3J5cHREYXRhKHRva2VuLmFjY2Vzc1Rva2VuKVxuICBjb25zdCBlbmNyeXB0ZWRSZWZyZXNoVG9rZW4gPSB0b2tlbi5yZWZyZXNoVG9rZW5cbiAgICA/IGF3YWl0IGVuY3J5cHREYXRhKHRva2VuLnJlZnJlc2hUb2tlbilcbiAgICA6IG51bGxcblxuICAvLyBDYWxjdWxhdGUgbmV3IGV4cGlyeVxuICBjb25zdCBleHBpcmVzQXQgPSBEYXRlLm5vdygpICsgKHRva2VuLmV4cGlyZXNJbiAqIDEwMDApXG5cbiAgLy8gU3RvcmUgaW4gRHluYW1vREJcbiAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xuICAgIFRhYmxlTmFtZTogVE9LRU5fVEFCTEVfTkFNRSxcbiAgICBJdGVtOiB7XG4gICAgICBwazogYCR7dXNlcklkfSN0aWt0b2tgLFxuICAgICAgc2s6IGJyYW5kSWQsXG4gICAgICBwbGF0Zm9ybTogJ3Rpa3RvaycsXG4gICAgICBlbmNyeXB0ZWRBY2Nlc3NUb2tlbixcbiAgICAgIGVuY3J5cHRlZFJlZnJlc2hUb2tlbixcbiAgICAgIGV4cGlyZXNBdCxcbiAgICAgIGxhc3RSZWZyZXNoZWQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIHR0bDogTWF0aC5mbG9vcihleHBpcmVzQXQgLyAxMDAwKSArIDg2NDAwLCAvLyBUVEwgMSBkYXkgYWZ0ZXIgZXhwaXJ5XG4gICAgfSxcbiAgfSkpXG5cbiAgLy8gRW1pdCBldmVudCBmb3IgbW9uaXRvcmluZ1xuICBhd2FpdCBzZW5kRXZlbnQoJ3Bvc3RvbGlvLnRva2VuJywgJ3Rva2VuLnJlZnJlc2hlZCcsIHtcbiAgICB1c2VySWQsXG4gICAgYnJhbmRJZCxcbiAgICBwbGF0Zm9ybTogJ3Rpa3RvaycsXG4gICAgZXhwaXJlc0F0LFxuICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICB9KVxuXG4gIGNvbnNvbGUubG9nKCdUb2tlbiByZWZyZXNoZWQgYW5kIHN0b3JlZCBzdWNjZXNzZnVsbHknLCB7XG4gICAgdXNlcklkLFxuICAgIGJyYW5kSWQsXG4gICAgcGxhdGZvcm06ICd0aWt0b2snLFxuICAgIGV4cGlyZXNBdCxcbiAgfSlcbn1cblxuLy8gSGVscGVyIGZ1bmN0aW9uIGZvciBlbmNyeXB0aW9uXG5hc3luYyBmdW5jdGlvbiBlbmNyeXB0RGF0YShwbGFpblRleHQ6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGttc0NsaWVudC5zZW5kKG5ldyBFbmNyeXB0Q29tbWFuZCh7XG4gICAgS2V5SWQ6IEtNU19LRVlfSUQsXG4gICAgUGxhaW50ZXh0OiBCdWZmZXIuZnJvbShwbGFpblRleHQpLFxuICB9KSlcblxuICByZXR1cm4gQnVmZmVyLmZyb20ocmVzdWx0LkNpcGhlcnRleHRCbG9iISkudG9TdHJpbmcoJ2Jhc2U2NCcpXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHB1Ymxpc2hUb1Rpa1RvayhcbiAgb3BlbklkOiBzdHJpbmcsXG4gIGFjY2Vzc1Rva2VuOiBzdHJpbmcsXG4gIGNvbnRlbnQ6IFB1Ymxpc2hSZXF1ZXN0Wydjb250ZW50J10sXG4gIGNsaWVudEtleT86IHN0cmluZ1xuKTogUHJvbWlzZTxUaWtUb2tWaWRlb1Jlc3BvbnNlPiB7XG4gIHRyeSB7XG4gICAgLy8gVGlrVG9rIENvbnRlbnQgUG9zdGluZyBBUEkgKHYyKVxuICAgIC8vIE5vdGU6IFRoaXMgaXMgYSBzaW1wbGlmaWVkIHZlcnNpb24uIFJlYWwgaW1wbGVtZW50YXRpb24gcmVxdWlyZXM6XG4gICAgLy8gMS4gVXBsb2FkIHZpZGVvIHRvIFRpa1RvaydzIHNlcnZlcnNcbiAgICAvLyAyLiBDcmVhdGUgcG9zdCB3aXRoIHVwbG9hZGVkIHZpZGVvXG4gICAgXG4gICAgaWYgKCFjb250ZW50Lm1lZGlhVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1ZpZGVvIFVSTCBpcyByZXF1aXJlZCBmb3IgVGlrVG9rIHBvc3RzJylcbiAgICB9XG5cbiAgICBpZiAoIWNsaWVudEtleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdUaWtUb2sgY2xpZW50IGtleSBpcyByZXF1aXJlZCcpXG4gICAgfVxuXG4gICAgLy8gU3RlcCAxOiBJbml0aWFsaXplIHZpZGVvIHVwbG9hZFxuICAgIGNvbnN0IGluaXRSZXNwb25zZSA9IGF3YWl0IGF4aW9zLnBvc3QoXG4gICAgICAnaHR0cHM6Ly9vcGVuLnRpa3Rva2FwaXMuY29tL3YyL3Bvc3QvcHVibGlzaC92aWRlby9pbml0JyxcbiAgICAgIHtcbiAgICAgICAgcG9zdF9pbmZvOiB7XG4gICAgICAgICAgdGl0bGU6IGZvcm1hdENhcHRpb24oY29udGVudC5jYXB0aW9uLCBjb250ZW50Lmhhc2h0YWdzKSxcbiAgICAgICAgICBwcml2YWN5X2xldmVsOiAnUFVCTElDJyxcbiAgICAgICAgICBkaXNhYmxlX2R1ZXQ6IGZhbHNlLFxuICAgICAgICAgIGRpc2FibGVfY29tbWVudDogZmFsc2UsXG4gICAgICAgICAgZGlzYWJsZV9zdGl0Y2g6IGZhbHNlLFxuICAgICAgICAgIHZpZGVvX2NvdmVyX3RpbWVzdGFtcF9tczogMTAwMCwgLy8gMSBzZWNvbmQgaW50byB2aWRlb1xuICAgICAgICB9LFxuICAgICAgICBzb3VyY2VfaW5mbzoge1xuICAgICAgICAgIHNvdXJjZTogJ0ZJTEVfVVBMT0FEJyxcbiAgICAgICAgICB2aWRlb19zaXplOiBhd2FpdCBnZXRWaWRlb1NpemUoY29udGVudC5tZWRpYVVybCksXG4gICAgICAgICAgY2h1bmtfc2l6ZTogMTA0ODU3NjAsIC8vIDEwTUIgY2h1bmtzXG4gICAgICAgICAgdG90YWxfY2h1bmtfY291bnQ6IDEsIC8vIEZvciBzaW1wbGljaXR5LCBhc3N1bWluZyBzaW5nbGUgY2h1bmtcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHthY2Nlc3NUb2tlbn1gLFxuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgIH0sXG4gICAgICB9XG4gICAgKVxuXG4gICAgY29uc3QgdXBsb2FkVXJsID0gaW5pdFJlc3BvbnNlLmRhdGEuZGF0YS51cGxvYWRfdXJsXG4gICAgY29uc3QgcHVibGlzaElkID0gaW5pdFJlc3BvbnNlLmRhdGEuZGF0YS5wdWJsaXNoX2lkXG5cbiAgICAvLyBTdGVwIDI6IFVwbG9hZCB2aWRlbyBmaWxlXG4gICAgY29uc3QgdmlkZW9EYXRhID0gYXdhaXQgZG93bmxvYWRWaWRlbyhjb250ZW50Lm1lZGlhVXJsKVxuICAgIFxuICAgIGF3YWl0IGF4aW9zLnB1dCh1cGxvYWRVcmwsIHZpZGVvRGF0YSwge1xuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ3ZpZGVvL21wNCcsXG4gICAgICAgICdDb250ZW50LVJhbmdlJzogYGJ5dGVzIDAtJHt2aWRlb0RhdGEubGVuZ3RoIC0gMX0vJHt2aWRlb0RhdGEubGVuZ3RofWAsXG4gICAgICB9LFxuICAgIH0pXG5cbiAgICAvLyBTdGVwIDM6IENoZWNrIHVwbG9hZCBzdGF0dXNcbiAgICBjb25zdCBzdGF0dXNSZXNwb25zZSA9IGF3YWl0IGF4aW9zLnBvc3QoXG4gICAgICAnaHR0cHM6Ly9vcGVuLnRpa3Rva2FwaXMuY29tL3YyL3Bvc3QvcHVibGlzaC9zdGF0dXMvZmV0Y2gnLFxuICAgICAge1xuICAgICAgICBwdWJsaXNoX2lkOiBwdWJsaXNoSWQsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiBgQmVhcmVyICR7YWNjZXNzVG9rZW59YCxcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICB9LFxuICAgICAgfVxuICAgIClcblxuICAgIC8vIE5vdGU6IEluIHByb2R1Y3Rpb24sIHlvdSdkIG5lZWQgdG8gcG9sbCB0aGlzIGVuZHBvaW50IHVudGlsIHN0YXR1cyBpcyAnUFVCTElTSF9DT01QTEVURSdcbiAgICByZXR1cm4ge1xuICAgICAgcHVibGlzaF9pZDogcHVibGlzaElkLFxuICAgICAgc3RhdHVzOiBzdGF0dXNSZXNwb25zZS5kYXRhLmRhdGEuc3RhdHVzLFxuICAgICAgc2hhcmVfdXJsOiBzdGF0dXNSZXNwb25zZS5kYXRhLmRhdGEuc2hhcmVfdXJsLFxuICAgIH1cblxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChheGlvcy5pc0F4aW9zRXJyb3IoZXJyb3IpKSB7XG4gICAgICBjb25zdCBheGlvc0Vycm9yID0gZXJyb3IgYXMgQXhpb3NFcnJvclxuICAgICAgY29uc29sZS5lcnJvcignVGlrVG9rIEFQSSBlcnJvcjonLCB7XG4gICAgICAgIHN0YXR1czogYXhpb3NFcnJvci5yZXNwb25zZT8uc3RhdHVzLFxuICAgICAgICBkYXRhOiBheGlvc0Vycm9yLnJlc3BvbnNlPy5kYXRhLFxuICAgICAgfSlcbiAgICAgIFxuICAgICAgLy8gSGFuZGxlIHJhdGUgbGltaXRpbmdcbiAgICAgIGlmIChheGlvc0Vycm9yLnJlc3BvbnNlPy5zdGF0dXMgPT09IDQyOSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Rpa1RvayBBUEkgcmF0ZSBsaW1pdCBleGNlZWRlZCcpXG4gICAgICB9XG5cbiAgICAgIC8vIEhhbmRsZSBxdW90YSBleGNlZWRlZFxuICAgICAgY29uc3QgZXJyb3JEYXRhID0gYXhpb3NFcnJvci5yZXNwb25zZT8uZGF0YSBhcyBhbnlcbiAgICAgIGlmIChlcnJvckRhdGE/LmVycm9yPy5jb2RlID09PSAncmF0ZV9saW1pdF9leGNlZWRlZCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUaWtUb2sgZGFpbHkgcG9zdCBsaW1pdCByZWFjaGVkJylcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gSGFuZGxlIG90aGVyIEFQSSBlcnJvcnNcbiAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yRGF0YT8uZXJyb3I/Lm1lc3NhZ2UgfHwgJ1Rpa1RvayBBUEkgZXJyb3InXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKVxuICAgIH1cbiAgICBcbiAgICB0aHJvdyBlcnJvclxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldFZpZGVvU2l6ZSh2aWRlb1VybDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgLy8gR2V0IHZpZGVvIGZpbGUgc2l6ZSBmb3IgdXBsb2FkIGluaXRpYWxpemF0aW9uXG4gIHRyeSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5oZWFkKHZpZGVvVXJsKVxuICAgIGNvbnN0IGNvbnRlbnRMZW5ndGggPSByZXNwb25zZS5oZWFkZXJzWydjb250ZW50LWxlbmd0aCddXG4gICAgcmV0dXJuIHBhcnNlSW50KGNvbnRlbnRMZW5ndGgsIDEwKVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBnZXQgdmlkZW8gc2l6ZTonLCBlcnJvcilcbiAgICAvLyBSZXR1cm4gYSBkZWZhdWx0IHNpemUgaWYgd2UgY2FuJ3QgZGV0ZXJtaW5lIGl0XG4gICAgcmV0dXJuIDEwNDg1NzYwIC8vIDEwTUIgZGVmYXVsdFxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRvd25sb2FkVmlkZW8odmlkZW9Vcmw6IHN0cmluZyk6IFByb21pc2U8QnVmZmVyPiB7XG4gIC8vIERvd25sb2FkIHZpZGVvIGZpbGUgZm9yIHVwbG9hZFxuICB0cnkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0KHZpZGVvVXJsLCB7XG4gICAgICByZXNwb25zZVR5cGU6ICdhcnJheWJ1ZmZlcicsXG4gICAgICBtYXhDb250ZW50TGVuZ3RoOiAxMDAwMDAwMDAsIC8vIDEwME1CIG1heFxuICAgICAgbWF4Qm9keUxlbmd0aDogMTAwMDAwMDAwLFxuICAgIH0pXG4gICAgcmV0dXJuIEJ1ZmZlci5mcm9tKHJlc3BvbnNlLmRhdGEpXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGRvd25sb2FkIHZpZGVvOicsIGVycm9yKVxuICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIGRvd25sb2FkIHZpZGVvIGZvciBUaWtUb2sgdXBsb2FkJylcbiAgfVxufVxuXG5mdW5jdGlvbiBmb3JtYXRDYXB0aW9uKGNhcHRpb246IHN0cmluZywgaGFzaHRhZ3M6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgLy8gVGlrVG9rIGJlc3QgcHJhY3RpY2VzOlxuICAvLyAtIE1heGltdW0gMiwyMDAgY2hhcmFjdGVycyBmb3IgY2FwdGlvbnNcbiAgLy8gLSBIYXNodGFncyBhcmUgdmVyeSBpbXBvcnRhbnQgZm9yIGRpc2NvdmVyeVxuICAvLyAtIFRyZW5kaW5nIGhhc2h0YWdzIGNhbiBib29zdCB2aXNpYmlsaXR5XG4gIFxuICBjb25zdCBoYXNodGFnU3RyaW5nID0gaGFzaHRhZ3NcbiAgICAuc2xpY2UoMCwgMjApIC8vIFRpa1RvayBhbGxvd3MgbWFueSBoYXNodGFnc1xuICAgIC5tYXAodGFnID0+IHRhZy5zdGFydHNXaXRoKCcjJykgPyB0YWcgOiBgIyR7dGFnfWApXG4gICAgLmpvaW4oJyAnKVxuICBcbiAgY29uc3QgZnVsbENhcHRpb24gPSBgJHtjYXB0aW9ufSAke2hhc2h0YWdTdHJpbmd9YFxuICBcbiAgLy8gVHJ1bmNhdGUgaWYgdG9vIGxvbmdcbiAgaWYgKGZ1bGxDYXB0aW9uLmxlbmd0aCA+IDIyMDApIHtcbiAgICBjb25zdCB0cnVuY2F0ZWRDYXB0aW9uID0gY2FwdGlvbi5zdWJzdHJpbmcoMCwgMjIwMCAtIGhhc2h0YWdTdHJpbmcubGVuZ3RoIC0gNClcbiAgICByZXR1cm4gYCR7dHJ1bmNhdGVkQ2FwdGlvbn0uLi4gJHtoYXNodGFnU3RyaW5nfWBcbiAgfVxuICBcbiAgcmV0dXJuIGZ1bGxDYXB0aW9uXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHVwZGF0ZUpvYlN0YXRlKFxuICBqb2JJZDogc3RyaW5nLFxuICBzdGF0dXM6IHN0cmluZyxcbiAgZGF0YTogYW55XG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xuICAgIFRhYmxlTmFtZTogSk9CX1NUQVRFX1RBQkxFX05BTUUsXG4gICAgSXRlbToge1xuICAgICAgam9iSWQsXG4gICAgICBzdGF0dXMsXG4gICAgICBkYXRhLFxuICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB0dGw6IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDcgKiAyNCAqIDYwICogNjApLCAvLyA3IGRheXMgVFRMXG4gICAgfSxcbiAgfSkpXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNlbmRFdmVudChzb3VyY2U6IHN0cmluZywgZGV0YWlsVHlwZTogc3RyaW5nLCBkZXRhaWw6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBldmVudEJyaWRnZUNsaWVudC5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcbiAgICBFbnRyaWVzOiBbe1xuICAgICAgU291cmNlOiBzb3VyY2UsXG4gICAgICBEZXRhaWxUeXBlOiBkZXRhaWxUeXBlLFxuICAgICAgRGV0YWlsOiBKU09OLnN0cmluZ2lmeShkZXRhaWwpLFxuICAgICAgRXZlbnRCdXNOYW1lOiBFVkVOVF9CVVNfTkFNRSxcbiAgICB9XSxcbiAgfSkpXG59Il19