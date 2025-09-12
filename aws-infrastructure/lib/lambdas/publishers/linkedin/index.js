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
    console.log('LinkedIn Publisher Lambda invoked', {
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
        // Get OAuth token
        const token = await getToken(request.userId, request.brandId, 'linkedin');
        if (!token) {
            throw new Error('LinkedIn token not found');
        }
        // Check if token needs refresh
        if (token.needsRefresh && token.refreshToken) {
            const newToken = await refreshLinkedInToken(token.refreshToken, request.metadata?.clientId, request.metadata?.clientSecret);
            await storeRefreshedToken(request.userId, request.brandId, newToken);
            token.accessToken = newToken.accessToken;
        }
        // Get LinkedIn person URN from metadata
        const personUrn = request.metadata?.personUrn;
        if (!personUrn) {
            throw new Error('LinkedIn person URN not found in metadata');
        }
        // Publish to LinkedIn
        const result = await publishToLinkedIn(personUrn, token.accessToken, request.content);
        // Update job state with success
        await updateJobState(jobId, 'completed', {
            ...request,
            result,
        });
        // Send success event
        await sendEvent('postolio.publisher.linkedin', 'post.published', {
            scheduleId: request.scheduleId,
            contentId: request.contentId,
            brandId: request.brandId,
            userId: request.userId,
            platform: 'linkedin',
            postId: result.id,
            activityUrl: result.activity,
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
        await sendEvent('postolio.publisher.linkedin', 'post.failed', {
            scheduleId: request.scheduleId,
            contentId: request.contentId,
            brandId: request.brandId,
            userId: request.userId,
            platform: 'linkedin',
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
    // Check if token needs refresh (LinkedIn tokens expire after 60 days)
    const expiryTime = result.Item.expiresAt;
    const refreshThreshold = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
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
async function refreshLinkedInToken(refreshToken, clientId, clientSecret) {
    // LinkedIn OAuth 2.0 token refresh
    if (!clientId || !clientSecret) {
        throw new Error('LinkedIn client credentials required for token refresh');
    }
    try {
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
            expiresIn: response.data.expires_in,
            refreshToken: response.data.refresh_token || refreshToken, // LinkedIn may or may not return new refresh token
        };
    }
    catch (error) {
        console.error('Token refresh failed:', error);
        throw new Error('Failed to refresh LinkedIn token');
    }
}
async function storeRefreshedToken(userId, brandId, token) {
    // This would normally call back to the Token Service API
    // For now, we'll skip this as it requires more setup
    console.log('Would store refreshed token:', { userId, brandId, token });
}
async function publishToLinkedIn(personUrn, accessToken, content) {
    try {
        const caption = formatCaption(content.caption, content.hashtags);
        // Build LinkedIn share document
        const shareContent = {
            author: personUrn,
            lifecycleState: 'PUBLISHED',
            specificContent: {
                'com.linkedin.ugc.ShareContent': {
                    shareCommentary: {
                        text: caption,
                    },
                    shareMediaCategory: content.mediaUrl ? 'IMAGE' : 'NONE',
                },
            },
            visibility: {
                'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
            },
        };
        // Add media if present
        if (content.mediaUrl) {
            // Step 1: Register image upload
            const registerResponse = await axios_1.default.post('https://api.linkedin.com/v2/assets?action=registerUpload', {
                registerUploadRequest: {
                    recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
                    owner: personUrn,
                    serviceRelationships: [
                        {
                            relationshipType: 'OWNER',
                            identifier: 'urn:li:userGeneratedContent',
                        },
                    ],
                },
            }, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Restli-Protocol-Version': '2.0.0',
                },
            });
            const uploadUrl = registerResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
            const mediaAsset = registerResponse.data.value.asset;
            // Step 2: Upload image to LinkedIn's CDN
            const imageResponse = await axios_1.default.get(content.mediaUrl, { responseType: 'arraybuffer' });
            await axios_1.default.put(uploadUrl, imageResponse.data, {
                headers: {
                    'Content-Type': 'image/jpeg', // Adjust based on actual image type
                },
            });
            // Step 3: Add media to share content
            shareContent.specificContent['com.linkedin.ugc.ShareContent'].media = [
                {
                    status: 'READY',
                    description: {
                        text: 'Posted via Postolio',
                    },
                    media: mediaAsset,
                    title: {
                        text: 'Image',
                    },
                },
            ];
        }
        // Step 4: Create the share
        const shareResponse = await axios_1.default.post('https://api.linkedin.com/v2/ugcPosts', shareContent, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-Restli-Protocol-Version': '2.0.0',
            },
        });
        return {
            id: shareResponse.data.id,
            activity: `https://www.linkedin.com/feed/update/${shareResponse.data.id}`,
        };
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error)) {
            const axiosError = error;
            console.error('LinkedIn API error:', {
                status: axiosError.response?.status,
                data: axiosError.response?.data,
            });
            // Handle rate limiting
            if (axiosError.response?.status === 429) {
                throw new Error('LinkedIn API rate limit exceeded');
            }
            // Handle other API errors
            const errorMessage = axiosError.response?.data?.message || 'LinkedIn API error';
            throw new Error(errorMessage);
        }
        throw error;
    }
}
function formatCaption(caption, hashtags) {
    // LinkedIn best practices:
    // - Maximum 3,000 characters for posts
    // - Hashtags work but are less important than on Instagram
    // - Focus on professional tone
    const hashtagString = hashtags
        .slice(0, 10) // Limit hashtags
        .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
        .join(' ');
    const fullCaption = hashtagString ? `${caption}\n\n${hashtagString}` : caption;
    // Truncate if too long
    if (fullCaption.length > 3000) {
        const truncatedCaption = caption.substring(0, 3000 - hashtagString.length - 7);
        return `${truncatedCaption}...\n\n${hashtagString}`;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSw4REFBeUQ7QUFDekQsd0RBQXNGO0FBQ3RGLG9EQUErRDtBQUMvRCxvRUFBaUY7QUFDakYsa0RBQXlDO0FBRXpDLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtBQUMzQyxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUE7QUFDM0QsTUFBTSxTQUFTLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEVBQUUsQ0FBQyxDQUFBO0FBQ25DLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxzQ0FBaUIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtBQUVuRCxNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWlCLENBQUE7QUFDdEQsTUFBTSxvQkFBb0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFxQixDQUFBO0FBQzlELE1BQU0sY0FBYyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBZSxDQUFBO0FBQ2xELE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVyxDQUFBO0FBd0JuQyxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQUUsS0FBZSxFQUFpQixFQUFFO0lBQzlELE9BQU8sQ0FBQyxHQUFHLENBQUMsbUNBQW1DLEVBQUU7UUFDL0MsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTTtLQUM5QixDQUFDLENBQUE7SUFFRix1QkFBdUI7SUFDdkIsS0FBSyxNQUFNLE1BQU0sSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDbkMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDOUIsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMs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QyxTQUFTLENBQUMsQ0FBQyxFQUFFLElBQUksR0FBRyxhQUFhLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFBO1FBQzlFLE9BQU8sR0FBRyxnQkFBZ0IsVUFBVSxhQUFhLEVBQUUsQ0FBQTtJQUNyRCxDQUFDO0lBRUQsT0FBTyxXQUFXLENBQUE7QUFDcEIsQ0FBQztBQUVELEtBQUssVUFBVSxjQUFjLENBQzNCLEtBQWEsRUFDYixNQUFjLEVBQ2QsSUFBUztJQUVULE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLHlCQUFVLENBQUM7UUFDbEMsU0FBUyxFQUFFLG9CQUFvQjtRQUMvQixJQUFJLEVBQUU7WUFDSixLQUFLO1lBQ0wsTUFBTTtZQUNOLElBQUk7WUFDSixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7WUFDbkMsR0FBRyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsYUFBYTtTQUN2RTtLQUNGLENBQUMsQ0FBQyxDQUFBO0FBQ0wsQ0FBQztBQUVELEtBQUssVUFBVSxTQUFTLENBQUMsTUFBYyxFQUFFLFVBQWtCLEVBQUUsTUFBVztJQUN0RSxNQUFNLGlCQUFpQixDQUFDLElBQUksQ0FBQyxJQUFJLHFDQUFnQixDQUFDO1FBQ2hELE9BQU8sRUFBRSxDQUFDO2dCQUNSLE1BQU0sRUFBRSxNQUFNO2dCQUNkLFVBQVUsRUFBRSxVQUFVO2dCQUN0QixNQUFNLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUM7Z0JBQzlCLFlBQVksRUFBRSxjQUFjO2FBQzdCLENBQUM7S0FDSCxDQUFDLENBQUMsQ0FBQTtBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTUVNFdmVudCwgU1FTUmVjb3JkIH0gZnJvbSAnYXdzLWxhbWJkYSdcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJ1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgR2V0Q29tbWFuZCwgUHV0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYidcbmltcG9ydCB7IEtNU0NsaWVudCwgRGVjcnlwdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQta21zJ1xuaW1wb3J0IHsgRXZlbnRCcmlkZ2VDbGllbnQsIFB1dEV2ZW50c0NvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZXZlbnRicmlkZ2UnXG5pbXBvcnQgYXhpb3MsIHsgQXhpb3NFcnJvciB9IGZyb20gJ2F4aW9zJ1xuXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KVxuY29uc3Qga21zQ2xpZW50ID0gbmV3IEtNU0NsaWVudCh7fSlcbmNvbnN0IGV2ZW50QnJpZGdlQ2xpZW50ID0gbmV3IEV2ZW50QnJpZGdlQ2xpZW50KHt9KVxuXG5jb25zdCBUT0tFTl9UQUJMRV9OQU1FID0gcHJvY2Vzcy5lbnYuVE9LRU5fVEFCTEVfTkFNRSFcbmNvbnN0IEpPQl9TVEFURV9UQUJMRV9OQU1FID0gcHJvY2Vzcy5lbnYuSk9CX1NUQVRFX1RBQkxFX05BTUUhXG5jb25zdCBFVkVOVF9CVVNfTkFNRSA9IHByb2Nlc3MuZW52LkVWRU5UX0JVU19OQU1FIVxuY29uc3QgS01TX0tFWV9JRCA9IHByb2Nlc3MuZW52LktNU19LRVlfSUQhXG5cbmludGVyZmFjZSBQdWJsaXNoUmVxdWVzdCB7XG4gIHNjaGVkdWxlSWQ6IHN0cmluZ1xuICBjb250ZW50SWQ6IHN0cmluZ1xuICBicmFuZElkOiBzdHJpbmdcbiAgdXNlcklkOiBzdHJpbmdcbiAgcGxhdGZvcm06IHN0cmluZ1xuICBjb250ZW50OiB7XG4gICAgY2FwdGlvbjogc3RyaW5nXG4gICAgaGFzaHRhZ3M6IHN0cmluZ1tdXG4gICAgbWVkaWFVcmw/OiBzdHJpbmdcbiAgfVxuICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIGFueT5cbn1cblxuaW50ZXJmYWNlIExpbmtlZEluU2hhcmVSZXNwb25zZSB7XG4gIGlkOiBzdHJpbmdcbiAgYWN0aXZpdHk6IHN0cmluZ1xuICBjb250ZW50Pzoge1xuICAgIGNvbnRlbnRVcmw/OiBzdHJpbmdcbiAgfVxufVxuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudDogU1FTRXZlbnQpOiBQcm9taXNlPHZvaWQ+ID0+IHtcbiAgY29uc29sZS5sb2coJ0xpbmtlZEluIFB1Ymxpc2hlciBMYW1iZGEgaW52b2tlZCcsIHtcbiAgICByZWNvcmRzOiBldmVudC5SZWNvcmRzLmxlbmd0aCxcbiAgfSlcblxuICAvLyBQcm9jZXNzIGVhY2ggbWVzc2FnZVxuICBmb3IgKGNvbnN0IHJlY29yZCBvZiBldmVudC5SZWNvcmRzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHByb2Nlc3NNZXNzYWdlKHJlY29yZClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgcHJvY2Vzc2luZyBtZXNzYWdlOicsIGVycm9yLCB7XG4gICAgICAgIG1lc3NhZ2VJZDogcmVjb3JkLm1lc3NhZ2VJZCxcbiAgICAgICAgYm9keTogcmVjb3JkLmJvZHksXG4gICAgICB9KVxuICAgICAgXG4gICAgICAvLyBUaHJvdyBlcnJvciB0byBzZW5kIG1lc3NhZ2UgdG8gRExRIGFmdGVyIHJldHJpZXNcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHByb2Nlc3NNZXNzYWdlKHJlY29yZDogU1FTUmVjb3JkKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHJlcXVlc3Q6IFB1Ymxpc2hSZXF1ZXN0ID0gSlNPTi5wYXJzZShyZWNvcmQuYm9keSlcbiAgY29uc29sZS5sb2coJ1Byb2Nlc3NpbmcgcHVibGlzaCByZXF1ZXN0OicsIHJlcXVlc3QpXG5cbiAgLy8gQ3JlYXRlIGpvYiBzdGF0ZSBlbnRyeVxuICBjb25zdCBqb2JJZCA9IGAke3JlcXVlc3Quc2NoZWR1bGVJZH0tJHtEYXRlLm5vdygpfWBcbiAgYXdhaXQgdXBkYXRlSm9iU3RhdGUoam9iSWQsICdwcm9jZXNzaW5nJywgcmVxdWVzdClcblxuICB0cnkge1xuICAgIC8vIEdldCBPQXV0aCB0b2tlblxuICAgIGNvbnN0IHRva2VuID0gYXdhaXQgZ2V0VG9rZW4ocmVxdWVzdC51c2VySWQsIHJlcXVlc3QuYnJhbmRJZCwgJ2xpbmtlZGluJylcbiAgICBpZiAoIXRva2VuKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0xpbmtlZEluIHRva2VuIG5vdCBmb3VuZCcpXG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgaWYgdG9rZW4gbmVlZHMgcmVmcmVzaFxuICAgIGlmICh0b2tlbi5uZWVkc1JlZnJlc2ggJiYgdG9rZW4ucmVmcmVzaFRva2VuKSB7XG4gICAgICBjb25zdCBuZXdUb2tlbiA9IGF3YWl0IHJlZnJlc2hMaW5rZWRJblRva2VuKHRva2VuLnJlZnJlc2hUb2tlbiwgcmVxdWVzdC5tZXRhZGF0YT8uY2xpZW50SWQsIHJlcXVlc3QubWV0YWRhdGE/LmNsaWVudFNlY3JldClcbiAgICAgIGF3YWl0IHN0b3JlUmVmcmVzaGVkVG9rZW4ocmVxdWVzdC51c2VySWQsIHJlcXVlc3QuYnJhbmRJZCwgbmV3VG9rZW4pXG4gICAgICB0b2tlbi5hY2Nlc3NUb2tlbiA9IG5ld1Rva2VuLmFjY2Vzc1Rva2VuXG4gICAgfVxuXG4gICAgLy8gR2V0IExpbmtlZEluIHBlcnNvbiBVUk4gZnJvbSBtZXRhZGF0YVxuICAgIGNvbnN0IHBlcnNvblVybiA9IHJlcXVlc3QubWV0YWRhdGE/LnBlcnNvblVyblxuICAgIGlmICghcGVyc29uVXJuKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0xpbmtlZEluIHBlcnNvbiBVUk4gbm90IGZvdW5kIGluIG1ldGFkYXRhJylcbiAgICB9XG5cbiAgICAvLyBQdWJsaXNoIHRvIExpbmtlZEluXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcHVibGlzaFRvTGlua2VkSW4oXG4gICAgICBwZXJzb25Vcm4sXG4gICAgICB0b2tlbi5hY2Nlc3NUb2tlbixcbiAgICAgIHJlcXVlc3QuY29udGVudFxuICAgIClcblxuICAgIC8vIFVwZGF0ZSBqb2Igc3RhdGUgd2l0aCBzdWNjZXNzXG4gICAgYXdhaXQgdXBkYXRlSm9iU3RhdGUoam9iSWQsICdjb21wbGV0ZWQnLCB7XG4gICAgICAuLi5yZXF1ZXN0LFxuICAgICAgcmVzdWx0LFxuICAgIH0pXG5cbiAgICAvLyBTZW5kIHN1Y2Nlc3MgZXZlbnRcbiAgICBhd2FpdCBzZW5kRXZlbnQoJ3Bvc3RvbGlvLnB1Ymxpc2hlci5saW5rZWRpbicsICdwb3N0LnB1Ymxpc2hlZCcsIHtcbiAgICAgIHNjaGVkdWxlSWQ6IHJlcXVlc3Quc2NoZWR1bGVJZCxcbiAgICAgIGNvbnRlbnRJZDogcmVxdWVzdC5jb250ZW50SWQsXG4gICAgICBicmFuZElkOiByZXF1ZXN0LmJyYW5kSWQsXG4gICAgICB1c2VySWQ6IHJlcXVlc3QudXNlcklkLFxuICAgICAgcGxhdGZvcm06ICdsaW5rZWRpbicsXG4gICAgICBwb3N0SWQ6IHJlc3VsdC5pZCxcbiAgICAgIGFjdGl2aXR5VXJsOiByZXN1bHQuYWN0aXZpdHksXG4gICAgICBwdWJsaXNoZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIH0pXG5cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdQdWJsaXNoaW5nIGZhaWxlZDonLCBlcnJvcilcblxuICAgIC8vIFVwZGF0ZSBqb2Igc3RhdGUgd2l0aCBmYWlsdXJlXG4gICAgYXdhaXQgdXBkYXRlSm9iU3RhdGUoam9iSWQsICdmYWlsZWQnLCB7XG4gICAgICAuLi5yZXF1ZXN0LFxuICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxuICAgIH0pXG5cbiAgICAvLyBTZW5kIGZhaWx1cmUgZXZlbnRcbiAgICBhd2FpdCBzZW5kRXZlbnQoJ3Bvc3RvbGlvLnB1Ymxpc2hlci5saW5rZWRpbicsICdwb3N0LmZhaWxlZCcsIHtcbiAgICAgIHNjaGVkdWxlSWQ6IHJlcXVlc3Quc2NoZWR1bGVJZCxcbiAgICAgIGNvbnRlbnRJZDogcmVxdWVzdC5jb250ZW50SWQsXG4gICAgICBicmFuZElkOiByZXF1ZXN0LmJyYW5kSWQsXG4gICAgICB1c2VySWQ6IHJlcXVlc3QudXNlcklkLFxuICAgICAgcGxhdGZvcm06ICdsaW5rZWRpbicsXG4gICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgICBmYWlsZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIH0pXG5cbiAgICB0aHJvdyBlcnJvclxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldFRva2VuKHVzZXJJZDogc3RyaW5nLCBicmFuZElkOiBzdHJpbmcsIHBsYXRmb3JtOiBzdHJpbmcpOiBQcm9taXNlPGFueT4ge1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XG4gICAgVGFibGVOYW1lOiBUT0tFTl9UQUJMRV9OQU1FLFxuICAgIEtleToge1xuICAgICAgcGs6IGAke3VzZXJJZH0jJHtwbGF0Zm9ybX1gLFxuICAgICAgc2s6IGJyYW5kSWQsXG4gICAgfSxcbiAgfSkpXG5cbiAgaWYgKCFyZXN1bHQuSXRlbSkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvLyBEZWNyeXB0IHRva2VuXG4gIGNvbnN0IGFjY2Vzc1Rva2VuID0gYXdhaXQgZGVjcnlwdERhdGEocmVzdWx0Lkl0ZW0uZW5jcnlwdGVkQWNjZXNzVG9rZW4pXG4gIGNvbnN0IHJlZnJlc2hUb2tlbiA9IHJlc3VsdC5JdGVtLmVuY3J5cHRlZFJlZnJlc2hUb2tlblxuICAgID8gYXdhaXQgZGVjcnlwdERhdGEocmVzdWx0Lkl0ZW0uZW5jcnlwdGVkUmVmcmVzaFRva2VuKVxuICAgIDogbnVsbFxuXG4gIC8vIENoZWNrIGlmIHRva2VuIG5lZWRzIHJlZnJlc2ggKExpbmtlZEluIHRva2VucyBleHBpcmUgYWZ0ZXIgNjAgZGF5cylcbiAgY29uc3QgZXhwaXJ5VGltZSA9IHJlc3VsdC5JdGVtLmV4cGlyZXNBdFxuICBjb25zdCByZWZyZXNoVGhyZXNob2xkID0gRGF0ZS5ub3coKSArICg3ICogMjQgKiA2MCAqIDYwICogMTAwMCkgLy8gNyBkYXlzXG4gIGNvbnN0IG5lZWRzUmVmcmVzaCA9IGV4cGlyeVRpbWUgPCByZWZyZXNoVGhyZXNob2xkXG5cbiAgcmV0dXJuIHtcbiAgICBhY2Nlc3NUb2tlbixcbiAgICByZWZyZXNoVG9rZW4sXG4gICAgZXhwaXJlc0F0OiByZXN1bHQuSXRlbS5leHBpcmVzQXQsXG4gICAgbmVlZHNSZWZyZXNoLFxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRlY3J5cHREYXRhKGVuY3J5cHRlZERhdGE6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGttc0NsaWVudC5zZW5kKG5ldyBEZWNyeXB0Q29tbWFuZCh7XG4gICAgQ2lwaGVydGV4dEJsb2I6IEJ1ZmZlci5mcm9tKGVuY3J5cHRlZERhdGEsICdiYXNlNjQnKSxcbiAgfSkpXG5cbiAgcmV0dXJuIEJ1ZmZlci5mcm9tKHJlc3VsdC5QbGFpbnRleHQhKS50b1N0cmluZygpXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hMaW5rZWRJblRva2VuKHJlZnJlc2hUb2tlbjogc3RyaW5nLCBjbGllbnRJZD86IHN0cmluZywgY2xpZW50U2VjcmV0Pzogc3RyaW5nKTogUHJvbWlzZTxhbnk+IHtcbiAgLy8gTGlua2VkSW4gT0F1dGggMi4wIHRva2VuIHJlZnJlc2hcbiAgaWYgKCFjbGllbnRJZCB8fCAhY2xpZW50U2VjcmV0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdMaW5rZWRJbiBjbGllbnQgY3JlZGVudGlhbHMgcmVxdWlyZWQgZm9yIHRva2VuIHJlZnJlc2gnKVxuICB9XG4gIFxuICB0cnkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MucG9zdCgnaHR0cHM6Ly93d3cubGlua2VkaW4uY29tL29hdXRoL3YyL2FjY2Vzc1Rva2VuJywgbnVsbCwge1xuICAgICAgcGFyYW1zOiB7XG4gICAgICAgIGdyYW50X3R5cGU6ICdyZWZyZXNoX3Rva2VuJyxcbiAgICAgICAgcmVmcmVzaF90b2tlbjogcmVmcmVzaFRva2VuLFxuICAgICAgICBjbGllbnRfaWQ6IGNsaWVudElkLFxuICAgICAgICBjbGllbnRfc2VjcmV0OiBjbGllbnRTZWNyZXQsXG4gICAgICB9LFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcsXG4gICAgICB9LFxuICAgIH0pXG5cbiAgICByZXR1cm4ge1xuICAgICAgYWNjZXNzVG9rZW46IHJlc3BvbnNlLmRhdGEuYWNjZXNzX3Rva2VuLFxuICAgICAgZXhwaXJlc0luOiByZXNwb25zZS5kYXRhLmV4cGlyZXNfaW4sXG4gICAgICByZWZyZXNoVG9rZW46IHJlc3BvbnNlLmRhdGEucmVmcmVzaF90b2tlbiB8fCByZWZyZXNoVG9rZW4sIC8vIExpbmtlZEluIG1heSBvciBtYXkgbm90IHJldHVybiBuZXcgcmVmcmVzaCB0b2tlblxuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdUb2tlbiByZWZyZXNoIGZhaWxlZDonLCBlcnJvcilcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byByZWZyZXNoIExpbmtlZEluIHRva2VuJylcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBzdG9yZVJlZnJlc2hlZFRva2VuKHVzZXJJZDogc3RyaW5nLCBicmFuZElkOiBzdHJpbmcsIHRva2VuOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgLy8gVGhpcyB3b3VsZCBub3JtYWxseSBjYWxsIGJhY2sgdG8gdGhlIFRva2VuIFNlcnZpY2UgQVBJXG4gIC8vIEZvciBub3csIHdlJ2xsIHNraXAgdGhpcyBhcyBpdCByZXF1aXJlcyBtb3JlIHNldHVwXG4gIGNvbnNvbGUubG9nKCdXb3VsZCBzdG9yZSByZWZyZXNoZWQgdG9rZW46JywgeyB1c2VySWQsIGJyYW5kSWQsIHRva2VuIH0pXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHB1Ymxpc2hUb0xpbmtlZEluKFxuICBwZXJzb25Vcm46IHN0cmluZyxcbiAgYWNjZXNzVG9rZW46IHN0cmluZyxcbiAgY29udGVudDogUHVibGlzaFJlcXVlc3RbJ2NvbnRlbnQnXVxuKTogUHJvbWlzZTxMaW5rZWRJblNoYXJlUmVzcG9uc2U+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjYXB0aW9uID0gZm9ybWF0Q2FwdGlvbihjb250ZW50LmNhcHRpb24sIGNvbnRlbnQuaGFzaHRhZ3MpXG4gICAgXG4gICAgLy8gQnVpbGQgTGlua2VkSW4gc2hhcmUgZG9jdW1lbnRcbiAgICBjb25zdCBzaGFyZUNvbnRlbnQ6IGFueSA9IHtcbiAgICAgIGF1dGhvcjogcGVyc29uVXJuLFxuICAgICAgbGlmZWN5Y2xlU3RhdGU6ICdQVUJMSVNIRUQnLFxuICAgICAgc3BlY2lmaWNDb250ZW50OiB7XG4gICAgICAgICdjb20ubGlua2VkaW4udWdjLlNoYXJlQ29udGVudCc6IHtcbiAgICAgICAgICBzaGFyZUNvbW1lbnRhcnk6IHtcbiAgICAgICAgICAgIHRleHQ6IGNhcHRpb24sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzaGFyZU1lZGlhQ2F0ZWdvcnk6IGNvbnRlbnQubWVkaWFVcmwgPyAnSU1BR0UnIDogJ05PTkUnLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHZpc2liaWxpdHk6IHtcbiAgICAgICAgJ2NvbS5saW5rZWRpbi51Z2MuTWVtYmVyTmV0d29ya1Zpc2liaWxpdHknOiAnUFVCTElDJyxcbiAgICAgIH0sXG4gICAgfVxuXG4gICAgLy8gQWRkIG1lZGlhIGlmIHByZXNlbnRcbiAgICBpZiAoY29udGVudC5tZWRpYVVybCkge1xuICAgICAgLy8gU3RlcCAxOiBSZWdpc3RlciBpbWFnZSB1cGxvYWRcbiAgICAgIGNvbnN0IHJlZ2lzdGVyUmVzcG9uc2UgPSBhd2FpdCBheGlvcy5wb3N0KFxuICAgICAgICAnaHR0cHM6Ly9hcGkubGlua2VkaW4uY29tL3YyL2Fzc2V0cz9hY3Rpb249cmVnaXN0ZXJVcGxvYWQnLFxuICAgICAgICB7XG4gICAgICAgICAgcmVnaXN0ZXJVcGxvYWRSZXF1ZXN0OiB7XG4gICAgICAgICAgICByZWNpcGVzOiBbJ3VybjpsaTpkaWdpdGFsbWVkaWFSZWNpcGU6ZmVlZHNoYXJlLWltYWdlJ10sXG4gICAgICAgICAgICBvd25lcjogcGVyc29uVXJuLFxuICAgICAgICAgICAgc2VydmljZVJlbGF0aW9uc2hpcHM6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIHJlbGF0aW9uc2hpcFR5cGU6ICdPV05FUicsXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllcjogJ3VybjpsaTp1c2VyR2VuZXJhdGVkQ29udGVudCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHthY2Nlc3NUb2tlbn1gLFxuICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgICdYLVJlc3RsaS1Qcm90b2NvbC1WZXJzaW9uJzogJzIuMC4wJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9XG4gICAgICApXG5cbiAgICAgIGNvbnN0IHVwbG9hZFVybCA9IHJlZ2lzdGVyUmVzcG9uc2UuZGF0YS52YWx1ZS51cGxvYWRNZWNoYW5pc21bJ2NvbS5saW5rZWRpbi5kaWdpdGFsbWVkaWEudXBsb2FkaW5nLk1lZGlhVXBsb2FkSHR0cFJlcXVlc3QnXS51cGxvYWRVcmxcbiAgICAgIGNvbnN0IG1lZGlhQXNzZXQgPSByZWdpc3RlclJlc3BvbnNlLmRhdGEudmFsdWUuYXNzZXRcblxuICAgICAgLy8gU3RlcCAyOiBVcGxvYWQgaW1hZ2UgdG8gTGlua2VkSW4ncyBDRE5cbiAgICAgIGNvbnN0IGltYWdlUmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQoY29udGVudC5tZWRpYVVybCwgeyByZXNwb25zZVR5cGU6ICdhcnJheWJ1ZmZlcicgfSlcbiAgICAgIGF3YWl0IGF4aW9zLnB1dCh1cGxvYWRVcmwsIGltYWdlUmVzcG9uc2UuZGF0YSwge1xuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdpbWFnZS9qcGVnJywgLy8gQWRqdXN0IGJhc2VkIG9uIGFjdHVhbCBpbWFnZSB0eXBlXG4gICAgICAgIH0sXG4gICAgICB9KVxuXG4gICAgICAvLyBTdGVwIDM6IEFkZCBtZWRpYSB0byBzaGFyZSBjb250ZW50XG4gICAgICBzaGFyZUNvbnRlbnQuc3BlY2lmaWNDb250ZW50Wydjb20ubGlua2VkaW4udWdjLlNoYXJlQ29udGVudCddLm1lZGlhID0gW1xuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzOiAnUkVBRFknLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiB7XG4gICAgICAgICAgICB0ZXh0OiAnUG9zdGVkIHZpYSBQb3N0b2xpbycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBtZWRpYTogbWVkaWFBc3NldCxcbiAgICAgICAgICB0aXRsZToge1xuICAgICAgICAgICAgdGV4dDogJ0ltYWdlJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXVxuICAgIH1cblxuICAgIC8vIFN0ZXAgNDogQ3JlYXRlIHRoZSBzaGFyZVxuICAgIGNvbnN0IHNoYXJlUmVzcG9uc2UgPSBhd2FpdCBheGlvcy5wb3N0KFxuICAgICAgJ2h0dHBzOi8vYXBpLmxpbmtlZGluLmNvbS92Mi91Z2NQb3N0cycsXG4gICAgICBzaGFyZUNvbnRlbnQsXG4gICAgICB7XG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHthY2Nlc3NUb2tlbn1gLFxuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgJ1gtUmVzdGxpLVByb3RvY29sLVZlcnNpb24nOiAnMi4wLjAnLFxuICAgICAgICB9LFxuICAgICAgfVxuICAgIClcblxuICAgIHJldHVybiB7XG4gICAgICBpZDogc2hhcmVSZXNwb25zZS5kYXRhLmlkLFxuICAgICAgYWN0aXZpdHk6IGBodHRwczovL3d3dy5saW5rZWRpbi5jb20vZmVlZC91cGRhdGUvJHtzaGFyZVJlc3BvbnNlLmRhdGEuaWR9YCxcbiAgICB9XG5cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoYXhpb3MuaXNBeGlvc0Vycm9yKGVycm9yKSkge1xuICAgICAgY29uc3QgYXhpb3NFcnJvciA9IGVycm9yIGFzIEF4aW9zRXJyb3JcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0xpbmtlZEluIEFQSSBlcnJvcjonLCB7XG4gICAgICAgIHN0YXR1czogYXhpb3NFcnJvci5yZXNwb25zZT8uc3RhdHVzLFxuICAgICAgICBkYXRhOiBheGlvc0Vycm9yLnJlc3BvbnNlPy5kYXRhLFxuICAgICAgfSlcbiAgICAgIFxuICAgICAgLy8gSGFuZGxlIHJhdGUgbGltaXRpbmdcbiAgICAgIGlmIChheGlvc0Vycm9yLnJlc3BvbnNlPy5zdGF0dXMgPT09IDQyOSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0xpbmtlZEluIEFQSSByYXRlIGxpbWl0IGV4Y2VlZGVkJylcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gSGFuZGxlIG90aGVyIEFQSSBlcnJvcnNcbiAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IChheGlvc0Vycm9yLnJlc3BvbnNlPy5kYXRhIGFzIGFueSk/Lm1lc3NhZ2UgfHwgJ0xpbmtlZEluIEFQSSBlcnJvcidcbiAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpXG4gICAgfVxuICAgIFxuICAgIHRocm93IGVycm9yXG4gIH1cbn1cblxuZnVuY3Rpb24gZm9ybWF0Q2FwdGlvbihjYXB0aW9uOiBzdHJpbmcsIGhhc2h0YWdzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gIC8vIExpbmtlZEluIGJlc3QgcHJhY3RpY2VzOlxuICAvLyAtIE1heGltdW0gMywwMDAgY2hhcmFjdGVycyBmb3IgcG9zdHNcbiAgLy8gLSBIYXNodGFncyB3b3JrIGJ1dCBhcmUgbGVzcyBpbXBvcnRhbnQgdGhhbiBvbiBJbnN0YWdyYW1cbiAgLy8gLSBGb2N1cyBvbiBwcm9mZXNzaW9uYWwgdG9uZVxuICBcbiAgY29uc3QgaGFzaHRhZ1N0cmluZyA9IGhhc2h0YWdzXG4gICAgLnNsaWNlKDAsIDEwKSAvLyBMaW1pdCBoYXNodGFnc1xuICAgIC5tYXAodGFnID0+IHRhZy5zdGFydHNXaXRoKCcjJykgPyB0YWcgOiBgIyR7dGFnfWApXG4gICAgLmpvaW4oJyAnKVxuICBcbiAgY29uc3QgZnVsbENhcHRpb24gPSBoYXNodGFnU3RyaW5nID8gYCR7Y2FwdGlvbn1cXG5cXG4ke2hhc2h0YWdTdHJpbmd9YCA6IGNhcHRpb25cbiAgXG4gIC8vIFRydW5jYXRlIGlmIHRvbyBsb25nXG4gIGlmIChmdWxsQ2FwdGlvbi5sZW5ndGggPiAzMDAwKSB7XG4gICAgY29uc3QgdHJ1bmNhdGVkQ2FwdGlvbiA9IGNhcHRpb24uc3Vic3RyaW5nKDAsIDMwMDAgLSBoYXNodGFnU3RyaW5nLmxlbmd0aCAtIDcpXG4gICAgcmV0dXJuIGAke3RydW5jYXRlZENhcHRpb259Li4uXFxuXFxuJHtoYXNodGFnU3RyaW5nfWBcbiAgfVxuICBcbiAgcmV0dXJuIGZ1bGxDYXB0aW9uXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHVwZGF0ZUpvYlN0YXRlKFxuICBqb2JJZDogc3RyaW5nLFxuICBzdGF0dXM6IHN0cmluZyxcbiAgZGF0YTogYW55XG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xuICAgIFRhYmxlTmFtZTogSk9CX1NUQVRFX1RBQkxFX05BTUUsXG4gICAgSXRlbToge1xuICAgICAgam9iSWQsXG4gICAgICBzdGF0dXMsXG4gICAgICBkYXRhLFxuICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB0dGw6IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDcgKiAyNCAqIDYwICogNjApLCAvLyA3IGRheXMgVFRMXG4gICAgfSxcbiAgfSkpXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNlbmRFdmVudChzb3VyY2U6IHN0cmluZywgZGV0YWlsVHlwZTogc3RyaW5nLCBkZXRhaWw6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBldmVudEJyaWRnZUNsaWVudC5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcbiAgICBFbnRyaWVzOiBbe1xuICAgICAgU291cmNlOiBzb3VyY2UsXG4gICAgICBEZXRhaWxUeXBlOiBkZXRhaWxUeXBlLFxuICAgICAgRGV0YWlsOiBKU09OLnN0cmluZ2lmeShkZXRhaWwpLFxuICAgICAgRXZlbnRCdXNOYW1lOiBFVkVOVF9CVVNfTkFNRSxcbiAgICB9XSxcbiAgfSkpXG59Il19