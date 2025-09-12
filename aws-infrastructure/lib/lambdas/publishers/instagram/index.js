"use strict";
/**
 * Instagram Publisher Lambda
 * Implements security fixes, validation, circuit breaker, and idempotency
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_kms_1 = require("@aws-sdk/client-kms");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const logger_1 = require("@aws-lambda-powertools/logger");
const metrics_1 = require("@aws-lambda-powertools/metrics");
const tracer_1 = require("@aws-lambda-powertools/tracer");
const axios_1 = __importDefault(require("axios"));
const axios_retry_1 = __importDefault(require("axios-retry"));
// Import shared utilities
const validation_schemas_1 = require("../../shared/validation-schemas");
const token_refresh_handler_1 = require("../../shared/token-refresh-handler");
const circuit_breaker_1 = require("../../shared/circuit-breaker");
const idempotency_handler_1 = require("../../shared/idempotency-handler");
// Initialize AWS clients
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const kmsClient = new client_kms_1.KMSClient({});
const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({});
// Initialize observability tools
const logger = new logger_1.Logger({ serviceName: 'instagram-publisher' });
const metrics = new metrics_1.Metrics({ namespace: 'Postolio/Publisher', serviceName: 'instagram' });
const tracer = new tracer_1.Tracer({ serviceName: 'instagram-publisher' });
// Environment variables
const TOKEN_TABLE_NAME = process.env.TOKEN_TABLE_NAME;
const JOB_STATE_TABLE_NAME = process.env.JOB_STATE_TABLE_NAME;
const IDEMPOTENCY_TABLE_NAME = process.env.IDEMPOTENCY_TABLE_NAME;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const KMS_KEY_ID = process.env.KMS_KEY_ID;
// Initialize handlers
const tokenRefreshHandler = new token_refresh_handler_1.TokenRefreshHandler({
    docClient,
    kmsClient,
    eventBridgeClient,
    tokenTableName: TOKEN_TABLE_NAME,
    kmsKeyId: KMS_KEY_ID,
    eventBusName: EVENT_BUS_NAME,
});
const idempotencyHandler = new idempotency_handler_1.IdempotencyHandler(docClient, {
    tableName: IDEMPOTENCY_TABLE_NAME,
    ttlSeconds: 86400, // 24 hours
});
// Initialize circuit breakers for Instagram API
const circuitBreakerFactory = new circuit_breaker_1.CircuitBreakerFactory();
const instagramApiBreaker = circuitBreakerFactory.getBreaker('instagram-api', {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
    monitoringPeriod: 60000 // 1 minute
});
// Configure axios with retry logic
const axiosInstance = axios_1.default.create({
    timeout: 25000, // 25 seconds (less than circuit breaker timeout)
});
(0, axios_retry_1.default)(axiosInstance, {
    retries: 3,
    retryDelay: axios_retry_1.default.exponentialDelay,
    retryCondition: (error) => {
        return axios_retry_1.default.isNetworkOrIdempotentRequestError(error) ||
            (error.response?.status === 429); // Rate limit
    },
    onRetry: (retryCount, error) => {
        logger.warn('Retrying Instagram API request', {
            retryCount,
            error: error.message,
        });
    },
});
/**
 * Main Lambda handler
 */
const handler = async (event) => {
    logger.info('Instagram Publisher Lambda invoked', {
        records: event.Records.length,
    });
    metrics.addMetric('Invocations', metrics_1.MetricUnit.Count, 1);
    // Process messages in parallel with concurrency limit
    const results = await Promise.allSettled(event.Records.map((record) => processMessage(record)));
    // Check for failures
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
        metrics.addMetric('BatchFailures', metrics_1.MetricUnit.Count, failures.length);
        // Throw error to trigger retry for failed messages
        const errorMessages = failures.map(f => f.reason?.message || 'Unknown error').join('; ');
        throw new Error(`Failed to process ${failures.length} messages: ${errorMessages}`);
    }
    metrics.publishStoredMetrics();
};
exports.handler = handler;
/**
 * Process individual SQS message with full error handling
 */
async function processMessage(record) {
    const segment = tracer.getSegment();
    const subsegment = segment?.addNewSubsegment('processMessage');
    try {
        // Validate input
        const request = (0, validation_schemas_1.validateInput)(validation_schemas_1.PublishRequestSchema, JSON.parse(record.body));
        logger.info('Processing publish request', {
            scheduleId: request.scheduleId,
            contentId: request.contentId,
            brandId: request.brandId,
            platform: request.platform,
        });
        // Generate idempotency key
        const idempotencyKey = request.idempotencyKey || `${request.contentId}-${request.platform}-${Date.now()}`;
        // Check idempotency
        const shouldProcess = await idempotencyHandler.checkAndRecord(idempotencyKey, {
            contentId: request.contentId,
            platform: request.platform,
            brandId: request.brandId,
            scheduledAt: request.scheduledAt,
        });
        if (!shouldProcess) {
            logger.info('Duplicate request detected, skipping', {
                idempotencyKey,
                contentId: request.contentId,
            });
            metrics.addMetric('DuplicateMessages', metrics_1.MetricUnit.Count, 1);
            return;
        }
        // Process the request
        const result = await publishContent(request);
        // Mark complete
        await idempotencyHandler.markComplete(idempotencyKey, result);
        metrics.addMetric('SuccessfulPublish', metrics_1.MetricUnit.Count, 1);
    }
    catch (error) {
        subsegment?.addError(error);
        if (error instanceof validation_schemas_1.ValidationError) {
            logger.error('Validation failed', {
                messageId: record.messageId,
                errors: error.errors.issues,
            });
            metrics.addMetric('ValidationErrors', metrics_1.MetricUnit.Count, 1);
            // Don't retry validation errors
            return;
        }
        if (error instanceof idempotency_handler_1.IdempotencyError) {
            logger.info('Duplicate message detected, skipping', {
                messageId: record.messageId,
            });
            metrics.addMetric('DuplicateMessages', metrics_1.MetricUnit.Count, 1);
            // Don't retry duplicates
            return;
        }
        logger.error('Failed to process message', {
            messageId: record.messageId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        metrics.addMetric('ProcessingErrors', metrics_1.MetricUnit.Count, 1);
        throw error;
    }
    finally {
        subsegment?.close();
    }
}
/**
 * Publish content to Instagram with all improvements
 */
async function publishContent(request) {
    // Create job state entry
    const jobId = `${request.scheduleId}-${Date.now()}`;
    await updateJobState(jobId, 'processing', request);
    try {
        // Get OAuth token
        const token = await getToken(request.userId, request.brandId, 'instagram');
        if (!token) {
            throw new Error('Instagram token not found');
        }
        // Refresh token if needed (without logging the token!)
        if (token.needsRefresh && token.refreshToken) {
            await refreshAndStoreToken(request.userId, request.brandId, token);
        }
        // Validate Instagram-specific metadata
        const instagramAccountId = request.metadata?.instagramAccountId;
        if (!instagramAccountId) {
            throw new Error('Instagram Business Account ID not found in metadata');
        }
        // Publish to Instagram using circuit breaker
        const result = await instagramApiBreaker.execute(async () => await publishToInstagram(instagramAccountId, token.accessToken, request.content));
        // Update job state with success
        await updateJobState(jobId, 'completed', {
            scheduleId: request.scheduleId,
            contentId: request.contentId,
            result,
        });
        // Send success event
        const successEvent = validation_schemas_1.PostPublishedEventSchema.parse({
            scheduleId: request.scheduleId,
            contentId: request.contentId,
            brandId: request.brandId,
            userId: request.userId,
            platform: 'instagram',
            postId: result.id,
            permalink: result.permalink,
            publishedAt: new Date().toISOString(),
        });
        await sendEvent('postolio.publisher.instagram', 'post.published', successEvent);
        return result;
    }
    catch (error) {
        logger.error('Publishing failed', {
            scheduleId: request.scheduleId,
            contentId: request.contentId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Update job state with failure
        await updateJobState(jobId, 'failed', {
            scheduleId: request.scheduleId,
            contentId: request.contentId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Send failure event
        const failureEvent = validation_schemas_1.PostFailedEventSchema.parse({
            scheduleId: request.scheduleId,
            contentId: request.contentId,
            brandId: request.brandId,
            userId: request.userId,
            platform: 'instagram',
            error: error instanceof Error ? error.message : 'Unknown error',
            failedAt: new Date().toISOString(),
        });
        await sendEvent('postolio.publisher.instagram', 'post.failed', failureEvent);
        throw error;
    }
}
/**
 * Get and decrypt OAuth token
 */
async function getToken(userId, brandId, platform) {
    const segment = tracer.getSegment();
    const subsegment = segment?.addNewSubsegment('getToken');
    try {
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
        // Decrypt token (NEVER log the actual token value!)
        const accessToken = await decryptData(result.Item.encryptedAccessToken);
        const refreshToken = result.Item.encryptedRefreshToken
            ? await decryptData(result.Item.encryptedRefreshToken)
            : undefined;
        // Check if token needs refresh
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
    finally {
        subsegment?.close();
    }
}
/**
 * Decrypt data using KMS
 */
async function decryptData(encryptedData) {
    const result = await kmsClient.send(new client_kms_1.DecryptCommand({
        CiphertextBlob: Buffer.from(encryptedData, 'base64'),
    }));
    return Buffer.from(result.Plaintext).toString();
}
/**
 * Refresh Instagram token and store it securely
 */
async function refreshAndStoreToken(userId, brandId, token) {
    try {
        const response = await axiosInstance.get('https://graph.instagram.com/refresh_access_token', {
            params: {
                grant_type: 'ig_refresh_token',
                access_token: token.accessToken,
            },
        });
        // Store refreshed token securely (no logging!)
        await tokenRefreshHandler.storeToken(userId, brandId, 'instagram', {
            accessToken: response.data.access_token,
            refreshToken: token.refreshToken, // Keep existing refresh token if not provided
            expiresIn: response.data.expires_in || 5184000, // 60 days default
        });
        // Update the token in memory for current request
        token.accessToken = response.data.access_token;
    }
    catch (error) {
        logger.error('Token refresh failed', {
            userId,
            brandId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        metrics.addMetric('TokenRefreshFailures', metrics_1.MetricUnit.Count, 1);
        // Continue with existing token
    }
}
/**
 * Publish content to Instagram Graph API
 */
async function publishToInstagram(accountId, accessToken, content) {
    const segment = tracer.getSegment();
    const subsegment = segment?.addNewSubsegment('publishToInstagram');
    try {
        if (!content.mediaUrl) {
            throw new Error('Media URL is required for Instagram posts');
        }
        const caption = formatCaption(content.caption, content.hashtags || []);
        // Step 1: Create media container
        logger.info('Creating Instagram media container', { accountId });
        const containerResponse = await axiosInstance.post(`https://graph.facebook.com/v18.0/${accountId}/media`, null, {
            params: {
                image_url: content.mediaUrl,
                caption: caption,
                access_token: accessToken,
            },
        });
        const mediaContainerId = containerResponse.data.id;
        // Step 2: Poll for media processing completion
        await waitForMediaProcessing(mediaContainerId, accessToken);
        // Step 3: Publish media
        logger.info('Publishing Instagram media', { mediaContainerId });
        const publishResponse = await axiosInstance.post(`https://graph.facebook.com/v18.0/${accountId}/media_publish`, null, {
            params: {
                creation_id: mediaContainerId,
                access_token: accessToken,
            },
        });
        const mediaId = publishResponse.data.id;
        // Step 4: Get permalink
        const permalinkResponse = await axiosInstance.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
            params: {
                fields: 'permalink',
                access_token: accessToken,
            },
        });
        metrics.addMetric('InstagramPostsPublished', metrics_1.MetricUnit.Count, 1);
        return {
            id: mediaId,
            permalink: permalinkResponse.data.permalink,
        };
    }
    catch (error) {
        subsegment?.addError(error);
        if (axios_1.default.isAxiosError(error)) {
            const axiosError = error;
            // Handle rate limiting
            if (axiosError.response?.status === 429) {
                metrics.addMetric('RateLimitErrors', metrics_1.MetricUnit.Count, 1);
                throw new Error('Instagram API rate limit exceeded');
            }
            // Handle other API errors (without exposing internal details)
            const statusCode = axiosError.response?.status || 0;
            logger.error('Instagram API error', {
                status: statusCode,
                // Don't log potentially sensitive response data
            });
            throw new Error(`Instagram API error (${statusCode})`);
        }
        throw error;
    }
    finally {
        subsegment?.close();
    }
}
/**
 * Wait for Instagram to process media
 */
async function waitForMediaProcessing(mediaContainerId, accessToken, maxAttempts = 10) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // 3 seconds between checks
        const statusResponse = await axiosInstance.get(`https://graph.facebook.com/v18.0/${mediaContainerId}`, {
            params: {
                fields: 'status_code',
                access_token: accessToken,
            },
        });
        if (statusResponse.data.status_code === 'FINISHED') {
            return;
        }
        if (statusResponse.data.status_code === 'ERROR') {
            throw new Error('Instagram media processing failed');
        }
    }
    throw new Error('Instagram media processing timeout');
}
/**
 * Format caption with hashtags
 */
function formatCaption(caption, hashtags) {
    const hashtagString = hashtags
        .slice(0, 30) // Instagram limit
        .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
        .join(' ');
    const fullCaption = `${caption}\n\n${hashtagString}`;
    // Truncate if too long
    if (fullCaption.length > 2200) {
        const truncatedCaption = caption.substring(0, 2200 - hashtagString.length - 4) + '...';
        return `${truncatedCaption}\n\n${hashtagString}`;
    }
    return fullCaption;
}
/**
 * Update job state in DynamoDB
 */
async function updateJobState(jobId, status, data) {
    await docClient.send(new lib_dynamodb_1.PutCommand({
        TableName: JOB_STATE_TABLE_NAME,
        Item: {
            jobId,
            status,
            // Don't store sensitive data in job state
            data: {
                scheduleId: data.scheduleId,
                contentId: data.contentId,
                result: data.result,
                error: data.error,
            },
            updatedAt: new Date().toISOString(),
            ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days TTL
        },
    }));
}
/**
 * Send event to EventBridge
 */
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztHQUdHOzs7Ozs7QUFHSCw4REFBeUQ7QUFDekQsd0RBQXNGO0FBQ3RGLG9EQUErRDtBQUMvRCxvRUFBaUY7QUFDakYsMERBQXNEO0FBQ3RELDREQUFvRTtBQUNwRSwwREFBc0Q7QUFDdEQsa0RBQXdEO0FBQ3hELDhEQUFvQztBQUVwQywwQkFBMEI7QUFDMUIsd0VBT3dDO0FBQ3hDLDhFQUF3RTtBQUN4RSxrRUFBb0Y7QUFDcEYsMEVBQXVGO0FBRXZGLHlCQUF5QjtBQUN6QixNQUFNLFlBQVksR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxDQUFDLENBQUE7QUFDM0MsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFBO0FBQzNELE1BQU0sU0FBUyxHQUFHLElBQUksc0JBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtBQUNuQyxNQUFNLGlCQUFpQixHQUFHLElBQUksc0NBQWlCLENBQUMsRUFBRSxDQUFDLENBQUE7QUFFbkQsaUNBQWlDO0FBQ2pDLE1BQU0sTUFBTSxHQUFHLElBQUksZUFBTSxDQUFDLEVBQUUsV0FBVyxFQUFFLHFCQUFxQixFQUFFLENBQUMsQ0FBQTtBQUNqRSxNQUFNLE9BQU8sR0FBRyxJQUFJLGlCQUFPLENBQUMsRUFBRSxTQUFTLEVBQUUsb0JBQW9CLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUE7QUFDMUYsTUFBTSxNQUFNLEdBQUcsSUFBSSxlQUFNLENBQUMsRUFBRSxXQUFXLEVBQUUscUJBQXFCLEVBQUUsQ0FBQyxDQUFBO0FBRWpFLHdCQUF3QjtBQUN4QixNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWlCLENBQUE7QUFDdEQsTUFBTSxvQkFBb0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFxQixDQUFBO0FB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TSxFQUFFLE1BQU07Z0JBQ2QsVUFBVSxFQUFFLFVBQVU7Z0JBQ3RCLE1BQU0sRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQztnQkFDOUIsWUFBWSxFQUFFLGNBQWM7YUFDN0IsQ0FBQztLQUNILENBQUMsQ0FBQyxDQUFBO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogSW5zdGFncmFtIFB1Ymxpc2hlciBMYW1iZGFcbiAqIEltcGxlbWVudHMgc2VjdXJpdHkgZml4ZXMsIHZhbGlkYXRpb24sIGNpcmN1aXQgYnJlYWtlciwgYW5kIGlkZW1wb3RlbmN5XG4gKi9cblxuaW1wb3J0IHsgU1FTRXZlbnQsIFNRU1JlY29yZCB9IGZyb20gJ2F3cy1sYW1iZGEnXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYidcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIEdldENvbW1hbmQsIFB1dENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInXG5pbXBvcnQgeyBLTVNDbGllbnQsIERlY3J5cHRDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWttcydcbmltcG9ydCB7IEV2ZW50QnJpZGdlQ2xpZW50LCBQdXRFdmVudHNDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWV2ZW50YnJpZGdlJ1xuaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9sb2dnZXInXG5pbXBvcnQgeyBNZXRyaWNzLCBNZXRyaWNVbml0IH0gZnJvbSAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9tZXRyaWNzJ1xuaW1wb3J0IHsgVHJhY2VyIH0gZnJvbSAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy90cmFjZXInXG5pbXBvcnQgYXhpb3MsIHsgQXhpb3NFcnJvciwgQXhpb3NJbnN0YW5jZSB9IGZyb20gJ2F4aW9zJ1xuaW1wb3J0IGF4aW9zUmV0cnkgZnJvbSAnYXhpb3MtcmV0cnknXG5cbi8vIEltcG9ydCBzaGFyZWQgdXRpbGl0aWVzXG5pbXBvcnQgeyBcbiAgUHVibGlzaFJlcXVlc3RTY2hlbWEsIFxuICBQb3N0UHVibGlzaGVkRXZlbnRTY2hlbWEsXG4gIFBvc3RGYWlsZWRFdmVudFNjaGVtYSxcbiAgdmFsaWRhdGVJbnB1dCxcbiAgVmFsaWRhdGlvbkVycm9yLFxuICB0eXBlIFB1Ymxpc2hSZXF1ZXN0IFxufSBmcm9tICcuLi8uLi9zaGFyZWQvdmFsaWRhdGlvbi1zY2hlbWFzJ1xuaW1wb3J0IHsgVG9rZW5SZWZyZXNoSGFuZGxlciB9IGZyb20gJy4uLy4uL3NoYXJlZC90b2tlbi1yZWZyZXNoLWhhbmRsZXInXG5pbXBvcnQgeyBDaXJjdWl0QnJlYWtlciwgQ2lyY3VpdEJyZWFrZXJGYWN0b3J5IH0gZnJvbSAnLi4vLi4vc2hhcmVkL2NpcmN1aXQtYnJlYWtlcidcbmltcG9ydCB7IElkZW1wb3RlbmN5SGFuZGxlciwgSWRlbXBvdGVuY3lFcnJvciB9IGZyb20gJy4uLy4uL3NoYXJlZC9pZGVtcG90ZW5jeS1oYW5kbGVyJ1xuXG4vLyBJbml0aWFsaXplIEFXUyBjbGllbnRzXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KVxuY29uc3Qga21zQ2xpZW50ID0gbmV3IEtNU0NsaWVudCh7fSlcbmNvbnN0IGV2ZW50QnJpZGdlQ2xpZW50ID0gbmV3IEV2ZW50QnJpZGdlQ2xpZW50KHt9KVxuXG4vLyBJbml0aWFsaXplIG9ic2VydmFiaWxpdHkgdG9vbHNcbmNvbnN0IGxvZ2dlciA9IG5ldyBMb2dnZXIoeyBzZXJ2aWNlTmFtZTogJ2luc3RhZ3JhbS1wdWJsaXNoZXInIH0pXG5jb25zdCBtZXRyaWNzID0gbmV3IE1ldHJpY3MoeyBuYW1lc3BhY2U6ICdQb3N0b2xpby9QdWJsaXNoZXInLCBzZXJ2aWNlTmFtZTogJ2luc3RhZ3JhbScgfSlcbmNvbnN0IHRyYWNlciA9IG5ldyBUcmFjZXIoeyBzZXJ2aWNlTmFtZTogJ2luc3RhZ3JhbS1wdWJsaXNoZXInIH0pXG5cbi8vIEVudmlyb25tZW50IHZhcmlhYmxlc1xuY29uc3QgVE9LRU5fVEFCTEVfTkFNRSA9IHByb2Nlc3MuZW52LlRPS0VOX1RBQkxFX05BTUUhXG5jb25zdCBKT0JfU1RBVEVfVEFCTEVfTkFNRSA9IHByb2Nlc3MuZW52LkpPQl9TVEFURV9UQUJMRV9OQU1FIVxuY29uc3QgSURFTVBPVEVOQ1lfVEFCTEVfTkFNRSA9IHByb2Nlc3MuZW52LklERU1QT1RFTkNZX1RBQkxFX05BTUUhXG5jb25zdCBFVkVOVF9CVVNfTkFNRSA9IHByb2Nlc3MuZW52LkVWRU5UX0JVU19OQU1FIVxuY29uc3QgS01TX0tFWV9JRCA9IHByb2Nlc3MuZW52LktNU19LRVlfSUQhXG5cbi8vIEluaXRpYWxpemUgaGFuZGxlcnNcbmNvbnN0IHRva2VuUmVmcmVzaEhhbmRsZXIgPSBuZXcgVG9rZW5SZWZyZXNoSGFuZGxlcih7XG4gIGRvY0NsaWVudCxcbiAga21zQ2xpZW50LFxuICBldmVudEJyaWRnZUNsaWVudCxcbiAgdG9rZW5UYWJsZU5hbWU6IFRPS0VOX1RBQkxFX05BTUUsXG4gIGttc0tleUlkOiBLTVNfS0VZX0lELFxuICBldmVudEJ1c05hbWU6IEVWRU5UX0JVU19OQU1FLFxufSlcblxuY29uc3QgaWRlbXBvdGVuY3lIYW5kbGVyID0gbmV3IElkZW1wb3RlbmN5SGFuZGxlcihkb2NDbGllbnQsIHtcbiAgdGFibGVOYW1lOiBJREVNUE9URU5DWV9UQUJMRV9OQU1FLFxuICB0dGxTZWNvbmRzOiA4NjQwMCwgLy8gMjQgaG91cnNcbn0pXG5cbi8vIEluaXRpYWxpemUgY2lyY3VpdCBicmVha2VycyBmb3IgSW5zdGFncmFtIEFQSVxuY29uc3QgY2lyY3VpdEJyZWFrZXJGYWN0b3J5ID0gbmV3IENpcmN1aXRCcmVha2VyRmFjdG9yeSgpXG5jb25zdCBpbnN0YWdyYW1BcGlCcmVha2VyID0gY2lyY3VpdEJyZWFrZXJGYWN0b3J5LmdldEJyZWFrZXIoJ2luc3RhZ3JhbS1hcGknLCB7XG4gIGZhaWx1cmVUaHJlc2hvbGQ6IDUsXG4gIHJlc2V0VGltZW91dDogNjAwMDAsIC8vIDEgbWludXRlXG4gIG1vbml0b3JpbmdQZXJpb2Q6IDYwMDAwIC8vIDEgbWludXRlXG59KVxuXG4vLyBDb25maWd1cmUgYXhpb3Mgd2l0aCByZXRyeSBsb2dpY1xuY29uc3QgYXhpb3NJbnN0YW5jZTogQXhpb3NJbnN0YW5jZSA9IGF4aW9zLmNyZWF0ZSh7XG4gIHRpbWVvdXQ6IDI1MDAwLCAvLyAyNSBzZWNvbmRzIChsZXNzIHRoYW4gY2lyY3VpdCBicmVha2VyIHRpbWVvdXQpXG59KVxuXG5heGlvc1JldHJ5KGF4aW9zSW5zdGFuY2UsIHtcbiAgcmV0cmllczogMyxcbiAgcmV0cnlEZWxheTogYXhpb3NSZXRyeS5leHBvbmVudGlhbERlbGF5LFxuICByZXRyeUNvbmRpdGlvbjogKGVycm9yKSA9PiB7XG4gICAgcmV0dXJuIGF4aW9zUmV0cnkuaXNOZXR3b3JrT3JJZGVtcG90ZW50UmVxdWVzdEVycm9yKGVycm9yKSB8fFxuICAgICAgICAgICAoZXJyb3IucmVzcG9uc2U/LnN0YXR1cyA9PT0gNDI5KSAvLyBSYXRlIGxpbWl0XG4gIH0sXG4gIG9uUmV0cnk6IChyZXRyeUNvdW50LCBlcnJvcikgPT4ge1xuICAgIGxvZ2dlci53YXJuKCdSZXRyeWluZyBJbnN0YWdyYW0gQVBJIHJlcXVlc3QnLCB7XG4gICAgICByZXRyeUNvdW50LFxuICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXG4gICAgfSlcbiAgfSxcbn0pXG5cbmludGVyZmFjZSBJbnN0YWdyYW1NZWRpYVJlc3BvbnNlIHtcbiAgaWQ6IHN0cmluZ1xuICBwZXJtYWxpbms/OiBzdHJpbmdcbn1cblxuaW50ZXJmYWNlIFRva2VuRGF0YSB7XG4gIGFjY2Vzc1Rva2VuOiBzdHJpbmdcbiAgcmVmcmVzaFRva2VuPzogc3RyaW5nXG4gIGV4cGlyZXNBdDogbnVtYmVyXG4gIG5lZWRzUmVmcmVzaDogYm9vbGVhblxufVxuXG4vKipcbiAqIE1haW4gTGFtYmRhIGhhbmRsZXJcbiAqL1xuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoZXZlbnQ6IFNRU0V2ZW50KTogUHJvbWlzZTx2b2lkPiA9PiB7XG4gIGxvZ2dlci5pbmZvKCdJbnN0YWdyYW0gUHVibGlzaGVyIExhbWJkYSBpbnZva2VkJywge1xuICAgIHJlY29yZHM6IGV2ZW50LlJlY29yZHMubGVuZ3RoLFxuICB9KVxuICBcbiAgbWV0cmljcy5hZGRNZXRyaWMoJ0ludm9jYXRpb25zJywgTWV0cmljVW5pdC5Db3VudCwgMSlcbiAgXG4gIC8vIFByb2Nlc3MgbWVzc2FnZXMgaW4gcGFyYWxsZWwgd2l0aCBjb25jdXJyZW5jeSBsaW1pdFxuICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFxuICAgIGV2ZW50LlJlY29yZHMubWFwKChyZWNvcmQpID0+IHByb2Nlc3NNZXNzYWdlKHJlY29yZCkpXG4gIClcbiAgXG4gIC8vIENoZWNrIGZvciBmYWlsdXJlc1xuICBjb25zdCBmYWlsdXJlcyA9IHJlc3VsdHMuZmlsdGVyKHIgPT4gci5zdGF0dXMgPT09ICdyZWplY3RlZCcpXG4gIGlmIChmYWlsdXJlcy5sZW5ndGggPiAwKSB7XG4gICAgbWV0cmljcy5hZGRNZXRyaWMoJ0JhdGNoRmFpbHVyZXMnLCBNZXRyaWNVbml0LkNvdW50LCBmYWlsdXJlcy5sZW5ndGgpXG4gICAgXG4gICAgLy8gVGhyb3cgZXJyb3IgdG8gdHJpZ2dlciByZXRyeSBmb3IgZmFpbGVkIG1lc3NhZ2VzXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlcyA9IGZhaWx1cmVzLm1hcChmID0+IFxuICAgICAgKGYgYXMgUHJvbWlzZVJlamVjdGVkUmVzdWx0KS5yZWFzb24/Lm1lc3NhZ2UgfHwgJ1Vua25vd24gZXJyb3InXG4gICAgKS5qb2luKCc7ICcpXG4gICAgXG4gICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcHJvY2VzcyAke2ZhaWx1cmVzLmxlbmd0aH0gbWVzc2FnZXM6ICR7ZXJyb3JNZXNzYWdlc31gKVxuICB9XG4gIFxuICBtZXRyaWNzLnB1Ymxpc2hTdG9yZWRNZXRyaWNzKClcbn1cblxuLyoqXG4gKiBQcm9jZXNzIGluZGl2aWR1YWwgU1FTIG1lc3NhZ2Ugd2l0aCBmdWxsIGVycm9yIGhhbmRsaW5nXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHByb2Nlc3NNZXNzYWdlKHJlY29yZDogU1FTUmVjb3JkKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHNlZ21lbnQgPSB0cmFjZXIuZ2V0U2VnbWVudCgpXG4gIGNvbnN0IHN1YnNlZ21lbnQgPSBzZWdtZW50Py5hZGROZXdTdWJzZWdtZW50KCdwcm9jZXNzTWVzc2FnZScpXG4gIFxuICB0cnkge1xuICAgIC8vIFZhbGlkYXRlIGlucHV0XG4gICAgY29uc3QgcmVxdWVzdDogUHVibGlzaFJlcXVlc3QgPSB2YWxpZGF0ZUlucHV0KFxuICAgICAgUHVibGlzaFJlcXVlc3RTY2hlbWEsXG4gICAgICBKU09OLnBhcnNlKHJlY29yZC5ib2R5KVxuICAgIClcbiAgICBcbiAgICBsb2dnZXIuaW5mbygnUHJvY2Vzc2luZyBwdWJsaXNoIHJlcXVlc3QnLCB7XG4gICAgICBzY2hlZHVsZUlkOiByZXF1ZXN0LnNjaGVkdWxlSWQsXG4gICAgICBjb250ZW50SWQ6IHJlcXVlc3QuY29udGVudElkLFxuICAgICAgYnJhbmRJZDogcmVxdWVzdC5icmFuZElkLFxuICAgICAgcGxhdGZvcm06IHJlcXVlc3QucGxhdGZvcm0sXG4gICAgfSlcbiAgICBcbiAgICAvLyBHZW5lcmF0ZSBpZGVtcG90ZW5jeSBrZXlcbiAgICBjb25zdCBpZGVtcG90ZW5jeUtleSA9IHJlcXVlc3QuaWRlbXBvdGVuY3lLZXkgfHwgYCR7cmVxdWVzdC5jb250ZW50SWR9LSR7cmVxdWVzdC5wbGF0Zm9ybX0tJHtEYXRlLm5vdygpfWBcbiAgICBcbiAgICAvLyBDaGVjayBpZGVtcG90ZW5jeVxuICAgIGNvbnN0IHNob3VsZFByb2Nlc3MgPSBhd2FpdCBpZGVtcG90ZW5jeUhhbmRsZXIuY2hlY2tBbmRSZWNvcmQoXG4gICAgICBpZGVtcG90ZW5jeUtleSxcbiAgICAgIHtcbiAgICAgICAgY29udGVudElkOiByZXF1ZXN0LmNvbnRlbnRJZCxcbiAgICAgICAgcGxhdGZvcm06IHJlcXVlc3QucGxhdGZvcm0sXG4gICAgICAgIGJyYW5kSWQ6IHJlcXVlc3QuYnJhbmRJZCxcbiAgICAgICAgc2NoZWR1bGVkQXQ6IHJlcXVlc3Quc2NoZWR1bGVkQXQsXG4gICAgICB9XG4gICAgKVxuICAgIFxuICAgIGlmICghc2hvdWxkUHJvY2Vzcykge1xuICAgICAgbG9nZ2VyLmluZm8oJ0R1cGxpY2F0ZSByZXF1ZXN0IGRldGVjdGVkLCBza2lwcGluZycsIHtcbiAgICAgICAgaWRlbXBvdGVuY3lLZXksXG4gICAgICAgIGNvbnRlbnRJZDogcmVxdWVzdC5jb250ZW50SWQsXG4gICAgICB9KVxuICAgICAgbWV0cmljcy5hZGRNZXRyaWMoJ0R1cGxpY2F0ZU1lc3NhZ2VzJywgTWV0cmljVW5pdC5Db3VudCwgMSlcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBcbiAgICAvLyBQcm9jZXNzIHRoZSByZXF1ZXN0XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcHVibGlzaENvbnRlbnQocmVxdWVzdClcbiAgICBcbiAgICAvLyBNYXJrIGNvbXBsZXRlXG4gICAgYXdhaXQgaWRlbXBvdGVuY3lIYW5kbGVyLm1hcmtDb21wbGV0ZShpZGVtcG90ZW5jeUtleSwgcmVzdWx0KVxuICAgIFxuICAgIG1ldHJpY3MuYWRkTWV0cmljKCdTdWNjZXNzZnVsUHVibGlzaCcsIE1ldHJpY1VuaXQuQ291bnQsIDEpXG4gICAgXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgc3Vic2VnbWVudD8uYWRkRXJyb3IoZXJyb3IgYXMgRXJyb3IpXG4gICAgXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmFsaWRhdGlvbkVycm9yKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ1ZhbGlkYXRpb24gZmFpbGVkJywge1xuICAgICAgICBtZXNzYWdlSWQ6IHJlY29yZC5tZXNzYWdlSWQsXG4gICAgICAgIGVycm9yczogKGVycm9yIGFzIFZhbGlkYXRpb25FcnJvcikuZXJyb3JzLmlzc3VlcyxcbiAgICAgIH0pXG4gICAgICBtZXRyaWNzLmFkZE1ldHJpYygnVmFsaWRhdGlvbkVycm9ycycsIE1ldHJpY1VuaXQuQ291bnQsIDEpXG4gICAgICAvLyBEb24ndCByZXRyeSB2YWxpZGF0aW9uIGVycm9yc1xuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIFxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIElkZW1wb3RlbmN5RXJyb3IpIHtcbiAgICAgIGxvZ2dlci5pbmZvKCdEdXBsaWNhdGUgbWVzc2FnZSBkZXRlY3RlZCwgc2tpcHBpbmcnLCB7XG4gICAgICAgIG1lc3NhZ2VJZDogcmVjb3JkLm1lc3NhZ2VJZCxcbiAgICAgIH0pXG4gICAgICBtZXRyaWNzLmFkZE1ldHJpYygnRHVwbGljYXRlTWVzc2FnZXMnLCBNZXRyaWNVbml0LkNvdW50LCAxKVxuICAgICAgLy8gRG9uJ3QgcmV0cnkgZHVwbGljYXRlc1xuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIFxuICAgIGxvZ2dlci5lcnJvcignRmFpbGVkIHRvIHByb2Nlc3MgbWVzc2FnZScsIHtcbiAgICAgIG1lc3NhZ2VJZDogcmVjb3JkLm1lc3NhZ2VJZCxcbiAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcbiAgICB9KVxuICAgIFxuICAgIG1ldHJpY3MuYWRkTWV0cmljKCdQcm9jZXNzaW5nRXJyb3JzJywgTWV0cmljVW5pdC5Db3VudCwgMSlcbiAgICB0aHJvdyBlcnJvclxuICAgIFxuICB9IGZpbmFsbHkge1xuICAgIHN1YnNlZ21lbnQ/LmNsb3NlKClcbiAgfVxufVxuXG4vKipcbiAqIFB1Ymxpc2ggY29udGVudCB0byBJbnN0YWdyYW0gd2l0aCBhbGwgaW1wcm92ZW1lbnRzXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHB1Ymxpc2hDb250ZW50KHJlcXVlc3Q6IFB1Ymxpc2hSZXF1ZXN0KTogUHJvbWlzZTxJbnN0YWdyYW1NZWRpYVJlc3BvbnNlPiB7XG4gIC8vIENyZWF0ZSBqb2Igc3RhdGUgZW50cnlcbiAgY29uc3Qgam9iSWQgPSBgJHtyZXF1ZXN0LnNjaGVkdWxlSWR9LSR7RGF0ZS5ub3coKX1gXG4gIGF3YWl0IHVwZGF0ZUpvYlN0YXRlKGpvYklkLCAncHJvY2Vzc2luZycsIHJlcXVlc3QpXG4gIFxuICB0cnkge1xuICAgIC8vIEdldCBPQXV0aCB0b2tlblxuICAgIGNvbnN0IHRva2VuID0gYXdhaXQgZ2V0VG9rZW4ocmVxdWVzdC51c2VySWQsIHJlcXVlc3QuYnJhbmRJZCwgJ2luc3RhZ3JhbScpXG4gICAgaWYgKCF0b2tlbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnN0YWdyYW0gdG9rZW4gbm90IGZvdW5kJylcbiAgICB9XG4gICAgXG4gICAgLy8gUmVmcmVzaCB0b2tlbiBpZiBuZWVkZWQgKHdpdGhvdXQgbG9nZ2luZyB0aGUgdG9rZW4hKVxuICAgIGlmICh0b2tlbi5uZWVkc1JlZnJlc2ggJiYgdG9rZW4ucmVmcmVzaFRva2VuKSB7XG4gICAgICBhd2FpdCByZWZyZXNoQW5kU3RvcmVUb2tlbihyZXF1ZXN0LnVzZXJJZCwgcmVxdWVzdC5icmFuZElkLCB0b2tlbilcbiAgICB9XG4gICAgXG4gICAgLy8gVmFsaWRhdGUgSW5zdGFncmFtLXNwZWNpZmljIG1ldGFkYXRhXG4gICAgY29uc3QgaW5zdGFncmFtQWNjb3VudElkID0gcmVxdWVzdC5tZXRhZGF0YT8uaW5zdGFncmFtQWNjb3VudElkXG4gICAgaWYgKCFpbnN0YWdyYW1BY2NvdW50SWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW5zdGFncmFtIEJ1c2luZXNzIEFjY291bnQgSUQgbm90IGZvdW5kIGluIG1ldGFkYXRhJylcbiAgICB9XG4gICAgXG4gICAgLy8gUHVibGlzaCB0byBJbnN0YWdyYW0gdXNpbmcgY2lyY3VpdCBicmVha2VyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaW5zdGFncmFtQXBpQnJlYWtlci5leGVjdXRlKGFzeW5jICgpID0+IFxuICAgICAgYXdhaXQgcHVibGlzaFRvSW5zdGFncmFtKFxuICAgICAgICBpbnN0YWdyYW1BY2NvdW50SWQsXG4gICAgICAgIHRva2VuLmFjY2Vzc1Rva2VuLFxuICAgICAgICByZXF1ZXN0LmNvbnRlbnRcbiAgICAgIClcbiAgICApXG4gICAgXG4gICAgLy8gVXBkYXRlIGpvYiBzdGF0ZSB3aXRoIHN1Y2Nlc3NcbiAgICBhd2FpdCB1cGRhdGVKb2JTdGF0ZShqb2JJZCwgJ2NvbXBsZXRlZCcsIHtcbiAgICAgIHNjaGVkdWxlSWQ6IHJlcXVlc3Quc2NoZWR1bGVJZCxcbiAgICAgIGNvbnRlbnRJZDogcmVxdWVzdC5jb250ZW50SWQsXG4gICAgICByZXN1bHQsXG4gICAgfSlcbiAgICBcbiAgICAvLyBTZW5kIHN1Y2Nlc3MgZXZlbnRcbiAgICBjb25zdCBzdWNjZXNzRXZlbnQgPSBQb3N0UHVibGlzaGVkRXZlbnRTY2hlbWEucGFyc2Uoe1xuICAgICAgc2NoZWR1bGVJZDogcmVxdWVzdC5zY2hlZHVsZUlkLFxuICAgICAgY29udGVudElkOiByZXF1ZXN0LmNvbnRlbnRJZCxcbiAgICAgIGJyYW5kSWQ6IHJlcXVlc3QuYnJhbmRJZCxcbiAgICAgIHVzZXJJZDogcmVxdWVzdC51c2VySWQsXG4gICAgICBwbGF0Zm9ybTogJ2luc3RhZ3JhbScsXG4gICAgICBwb3N0SWQ6IHJlc3VsdC5pZCxcbiAgICAgIHBlcm1hbGluazogcmVzdWx0LnBlcm1hbGluayxcbiAgICAgIHB1Ymxpc2hlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgfSlcbiAgICBcbiAgICBhd2FpdCBzZW5kRXZlbnQoJ3Bvc3RvbGlvLnB1Ymxpc2hlci5pbnN0YWdyYW0nLCAncG9zdC5wdWJsaXNoZWQnLCBzdWNjZXNzRXZlbnQpXG4gICAgXG4gICAgcmV0dXJuIHJlc3VsdFxuICAgIFxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignUHVibGlzaGluZyBmYWlsZWQnLCB7XG4gICAgICBzY2hlZHVsZUlkOiByZXF1ZXN0LnNjaGVkdWxlSWQsXG4gICAgICBjb250ZW50SWQ6IHJlcXVlc3QuY29udGVudElkLFxuICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxuICAgIH0pXG4gICAgXG4gICAgLy8gVXBkYXRlIGpvYiBzdGF0ZSB3aXRoIGZhaWx1cmVcbiAgICBhd2FpdCB1cGRhdGVKb2JTdGF0ZShqb2JJZCwgJ2ZhaWxlZCcsIHtcbiAgICAgIHNjaGVkdWxlSWQ6IHJlcXVlc3Quc2NoZWR1bGVJZCxcbiAgICAgIGNvbnRlbnRJZDogcmVxdWVzdC5jb250ZW50SWQsXG4gICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgfSlcbiAgICBcbiAgICAvLyBTZW5kIGZhaWx1cmUgZXZlbnRcbiAgICBjb25zdCBmYWlsdXJlRXZlbnQgPSBQb3N0RmFpbGVkRXZlbnRTY2hlbWEucGFyc2Uoe1xuICAgICAgc2NoZWR1bGVJZDogcmVxdWVzdC5zY2hlZHVsZUlkLFxuICAgICAgY29udGVudElkOiByZXF1ZXN0LmNvbnRlbnRJZCxcbiAgICAgIGJyYW5kSWQ6IHJlcXVlc3QuYnJhbmRJZCxcbiAgICAgIHVzZXJJZDogcmVxdWVzdC51c2VySWQsXG4gICAgICBwbGF0Zm9ybTogJ2luc3RhZ3JhbScsXG4gICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgICBmYWlsZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIH0pXG4gICAgXG4gICAgYXdhaXQgc2VuZEV2ZW50KCdwb3N0b2xpby5wdWJsaXNoZXIuaW5zdGFncmFtJywgJ3Bvc3QuZmFpbGVkJywgZmFpbHVyZUV2ZW50KVxuICAgIFxuICAgIHRocm93IGVycm9yXG4gIH1cbn1cblxuLyoqXG4gKiBHZXQgYW5kIGRlY3J5cHQgT0F1dGggdG9rZW5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZ2V0VG9rZW4odXNlcklkOiBzdHJpbmcsIGJyYW5kSWQ6IHN0cmluZywgcGxhdGZvcm06IHN0cmluZyk6IFByb21pc2U8VG9rZW5EYXRhIHwgbnVsbD4ge1xuICBjb25zdCBzZWdtZW50ID0gdHJhY2VyLmdldFNlZ21lbnQoKVxuICBjb25zdCBzdWJzZWdtZW50ID0gc2VnbWVudD8uYWRkTmV3U3Vic2VnbWVudCgnZ2V0VG9rZW4nKVxuICBcbiAgdHJ5IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IFRPS0VOX1RBQkxFX05BTUUsXG4gICAgICBLZXk6IHtcbiAgICAgICAgcGs6IGAke3VzZXJJZH0jJHtwbGF0Zm9ybX1gLFxuICAgICAgICBzazogYnJhbmRJZCxcbiAgICAgIH0sXG4gICAgfSkpXG4gICAgXG4gICAgaWYgKCFyZXN1bHQuSXRlbSkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gICAgXG4gICAgLy8gRGVjcnlwdCB0b2tlbiAoTkVWRVIgbG9nIHRoZSBhY3R1YWwgdG9rZW4gdmFsdWUhKVxuICAgIGNvbnN0IGFjY2Vzc1Rva2VuID0gYXdhaXQgZGVjcnlwdERhdGEocmVzdWx0Lkl0ZW0uZW5jcnlwdGVkQWNjZXNzVG9rZW4pXG4gICAgY29uc3QgcmVmcmVzaFRva2VuID0gcmVzdWx0Lkl0ZW0uZW5jcnlwdGVkUmVmcmVzaFRva2VuXG4gICAgICA/IGF3YWl0IGRlY3J5cHREYXRhKHJlc3VsdC5JdGVtLmVuY3J5cHRlZFJlZnJlc2hUb2tlbilcbiAgICAgIDogdW5kZWZpbmVkXG4gICAgXG4gICAgLy8gQ2hlY2sgaWYgdG9rZW4gbmVlZHMgcmVmcmVzaFxuICAgIGNvbnN0IGV4cGlyeVRpbWUgPSByZXN1bHQuSXRlbS5leHBpcmVzQXRcbiAgICBjb25zdCByZWZyZXNoVGhyZXNob2xkID0gRGF0ZS5ub3coKSArICg3ICogMjQgKiA2MCAqIDYwICogMTAwMCkgLy8gNyBkYXlzXG4gICAgY29uc3QgbmVlZHNSZWZyZXNoID0gZXhwaXJ5VGltZSA8IHJlZnJlc2hUaHJlc2hvbGRcbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgYWNjZXNzVG9rZW4sXG4gICAgICByZWZyZXNoVG9rZW4sXG4gICAgICBleHBpcmVzQXQ6IHJlc3VsdC5JdGVtLmV4cGlyZXNBdCxcbiAgICAgIG5lZWRzUmVmcmVzaCxcbiAgICB9XG4gIH0gZmluYWxseSB7XG4gICAgc3Vic2VnbWVudD8uY2xvc2UoKVxuICB9XG59XG5cbi8qKlxuICogRGVjcnlwdCBkYXRhIHVzaW5nIEtNU1xuICovXG5hc3luYyBmdW5jdGlvbiBkZWNyeXB0RGF0YShlbmNyeXB0ZWREYXRhOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBrbXNDbGllbnQuc2VuZChuZXcgRGVjcnlwdENvbW1hbmQoe1xuICAgIENpcGhlcnRleHRCbG9iOiBCdWZmZXIuZnJvbShlbmNyeXB0ZWREYXRhLCAnYmFzZTY0JyksXG4gIH0pKVxuICBcbiAgcmV0dXJuIEJ1ZmZlci5mcm9tKHJlc3VsdC5QbGFpbnRleHQhKS50b1N0cmluZygpXG59XG5cbi8qKlxuICogUmVmcmVzaCBJbnN0YWdyYW0gdG9rZW4gYW5kIHN0b3JlIGl0IHNlY3VyZWx5XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hBbmRTdG9yZVRva2VuKFxuICB1c2VySWQ6IHN0cmluZyxcbiAgYnJhbmRJZDogc3RyaW5nLFxuICB0b2tlbjogVG9rZW5EYXRhXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zSW5zdGFuY2UuZ2V0KCdodHRwczovL2dyYXBoLmluc3RhZ3JhbS5jb20vcmVmcmVzaF9hY2Nlc3NfdG9rZW4nLCB7XG4gICAgICBwYXJhbXM6IHtcbiAgICAgICAgZ3JhbnRfdHlwZTogJ2lnX3JlZnJlc2hfdG9rZW4nLFxuICAgICAgICBhY2Nlc3NfdG9rZW46IHRva2VuLmFjY2Vzc1Rva2VuLFxuICAgICAgfSxcbiAgICB9KVxuICAgIFxuICAgIC8vIFN0b3JlIHJlZnJlc2hlZCB0b2tlbiBzZWN1cmVseSAobm8gbG9nZ2luZyEpXG4gICAgYXdhaXQgdG9rZW5SZWZyZXNoSGFuZGxlci5zdG9yZVRva2VuKFxuICAgICAgdXNlcklkLFxuICAgICAgYnJhbmRJZCxcbiAgICAgICdpbnN0YWdyYW0nLFxuICAgICAge1xuICAgICAgICBhY2Nlc3NUb2tlbjogcmVzcG9uc2UuZGF0YS5hY2Nlc3NfdG9rZW4sXG4gICAgICAgIHJlZnJlc2hUb2tlbjogdG9rZW4ucmVmcmVzaFRva2VuLCAvLyBLZWVwIGV4aXN0aW5nIHJlZnJlc2ggdG9rZW4gaWYgbm90IHByb3ZpZGVkXG4gICAgICAgIGV4cGlyZXNJbjogcmVzcG9uc2UuZGF0YS5leHBpcmVzX2luIHx8IDUxODQwMDAsIC8vIDYwIGRheXMgZGVmYXVsdFxuICAgICAgfVxuICAgIClcbiAgICBcbiAgICAvLyBVcGRhdGUgdGhlIHRva2VuIGluIG1lbW9yeSBmb3IgY3VycmVudCByZXF1ZXN0XG4gICAgdG9rZW4uYWNjZXNzVG9rZW4gPSByZXNwb25zZS5kYXRhLmFjY2Vzc190b2tlblxuICAgIFxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignVG9rZW4gcmVmcmVzaCBmYWlsZWQnLCB7XG4gICAgICB1c2VySWQsXG4gICAgICBicmFuZElkLFxuICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxuICAgIH0pXG4gICAgbWV0cmljcy5hZGRNZXRyaWMoJ1Rva2VuUmVmcmVzaEZhaWx1cmVzJywgTWV0cmljVW5pdC5Db3VudCwgMSlcbiAgICAvLyBDb250aW51ZSB3aXRoIGV4aXN0aW5nIHRva2VuXG4gIH1cbn1cblxuLyoqXG4gKiBQdWJsaXNoIGNvbnRlbnQgdG8gSW5zdGFncmFtIEdyYXBoIEFQSVxuICovXG5hc3luYyBmdW5jdGlvbiBwdWJsaXNoVG9JbnN0YWdyYW0oXG4gIGFjY291bnRJZDogc3RyaW5nLFxuICBhY2Nlc3NUb2tlbjogc3RyaW5nLFxuICBjb250ZW50OiBQdWJsaXNoUmVxdWVzdFsnY29udGVudCddXG4pOiBQcm9taXNlPEluc3RhZ3JhbU1lZGlhUmVzcG9uc2U+IHtcbiAgY29uc3Qgc2VnbWVudCA9IHRyYWNlci5nZXRTZWdtZW50KClcbiAgY29uc3Qgc3Vic2VnbWVudCA9IHNlZ21lbnQ/LmFkZE5ld1N1YnNlZ21lbnQoJ3B1Ymxpc2hUb0luc3RhZ3JhbScpXG4gIFxuICB0cnkge1xuICAgIGlmICghY29udGVudC5tZWRpYVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdNZWRpYSBVUkwgaXMgcmVxdWlyZWQgZm9yIEluc3RhZ3JhbSBwb3N0cycpXG4gICAgfVxuICAgIFxuICAgIGNvbnN0IGNhcHRpb24gPSBmb3JtYXRDYXB0aW9uKGNvbnRlbnQuY2FwdGlvbiwgY29udGVudC5oYXNodGFncyB8fCBbXSlcbiAgICBcbiAgICAvLyBTdGVwIDE6IENyZWF0ZSBtZWRpYSBjb250YWluZXJcbiAgICBsb2dnZXIuaW5mbygnQ3JlYXRpbmcgSW5zdGFncmFtIG1lZGlhIGNvbnRhaW5lcicsIHsgYWNjb3VudElkIH0pXG4gICAgXG4gICAgY29uc3QgY29udGFpbmVyUmVzcG9uc2UgPSBhd2FpdCBheGlvc0luc3RhbmNlLnBvc3QoXG4gICAgICBgaHR0cHM6Ly9ncmFwaC5mYWNlYm9vay5jb20vdjE4LjAvJHthY2NvdW50SWR9L21lZGlhYCxcbiAgICAgIG51bGwsXG4gICAgICB7XG4gICAgICAgIHBhcmFtczoge1xuICAgICAgICAgIGltYWdlX3VybDogY29udGVudC5tZWRpYVVybCxcbiAgICAgICAgICBjYXB0aW9uOiBjYXB0aW9uLFxuICAgICAgICAgIGFjY2Vzc190b2tlbjogYWNjZXNzVG9rZW4sXG4gICAgICAgIH0sXG4gICAgICB9XG4gICAgKVxuICAgIFxuICAgIGNvbnN0IG1lZGlhQ29udGFpbmVySWQgPSBjb250YWluZXJSZXNwb25zZS5kYXRhLmlkXG4gICAgXG4gICAgLy8gU3RlcCAyOiBQb2xsIGZvciBtZWRpYSBwcm9jZXNzaW5nIGNvbXBsZXRpb25cbiAgICBhd2FpdCB3YWl0Rm9yTWVkaWFQcm9jZXNzaW5nKG1lZGlhQ29udGFpbmVySWQsIGFjY2Vzc1Rva2VuKVxuICAgIFxuICAgIC8vIFN0ZXAgMzogUHVibGlzaCBtZWRpYVxuICAgIGxvZ2dlci5pbmZvKCdQdWJsaXNoaW5nIEluc3RhZ3JhbSBtZWRpYScsIHsgbWVkaWFDb250YWluZXJJZCB9KVxuICAgIFxuICAgIGNvbnN0IHB1Ymxpc2hSZXNwb25zZSA9IGF3YWl0IGF4aW9zSW5zdGFuY2UucG9zdChcbiAgICAgIGBodHRwczovL2dyYXBoLmZhY2Vib29rLmNvbS92MTguMC8ke2FjY291bnRJZH0vbWVkaWFfcHVibGlzaGAsXG4gICAgICBudWxsLFxuICAgICAge1xuICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICBjcmVhdGlvbl9pZDogbWVkaWFDb250YWluZXJJZCxcbiAgICAgICAgICBhY2Nlc3NfdG9rZW46IGFjY2Vzc1Rva2VuLFxuICAgICAgICB9LFxuICAgICAgfVxuICAgIClcbiAgICBcbiAgICBjb25zdCBtZWRpYUlkID0gcHVibGlzaFJlc3BvbnNlLmRhdGEuaWRcbiAgICBcbiAgICAvLyBTdGVwIDQ6IEdldCBwZXJtYWxpbmtcbiAgICBjb25zdCBwZXJtYWxpbmtSZXNwb25zZSA9IGF3YWl0IGF4aW9zSW5zdGFuY2UuZ2V0KFxuICAgICAgYGh0dHBzOi8vZ3JhcGguZmFjZWJvb2suY29tL3YxOC4wLyR7bWVkaWFJZH1gLFxuICAgICAge1xuICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICBmaWVsZHM6ICdwZXJtYWxpbmsnLFxuICAgICAgICAgIGFjY2Vzc190b2tlbjogYWNjZXNzVG9rZW4sXG4gICAgICAgIH0sXG4gICAgICB9XG4gICAgKVxuICAgIFxuICAgIG1ldHJpY3MuYWRkTWV0cmljKCdJbnN0YWdyYW1Qb3N0c1B1Ymxpc2hlZCcsIE1ldHJpY1VuaXQuQ291bnQsIDEpXG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIGlkOiBtZWRpYUlkLFxuICAgICAgcGVybWFsaW5rOiBwZXJtYWxpbmtSZXNwb25zZS5kYXRhLnBlcm1hbGluayxcbiAgICB9XG4gICAgXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgc3Vic2VnbWVudD8uYWRkRXJyb3IoZXJyb3IgYXMgRXJyb3IpXG4gICAgXG4gICAgaWYgKGF4aW9zLmlzQXhpb3NFcnJvcihlcnJvcikpIHtcbiAgICAgIGNvbnN0IGF4aW9zRXJyb3IgPSBlcnJvciBhcyBBeGlvc0Vycm9yXG4gICAgICBcbiAgICAgIC8vIEhhbmRsZSByYXRlIGxpbWl0aW5nXG4gICAgICBpZiAoYXhpb3NFcnJvci5yZXNwb25zZT8uc3RhdHVzID09PSA0MjkpIHtcbiAgICAgICAgbWV0cmljcy5hZGRNZXRyaWMoJ1JhdGVMaW1pdEVycm9ycycsIE1ldHJpY1VuaXQuQ291bnQsIDEpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignSW5zdGFncmFtIEFQSSByYXRlIGxpbWl0IGV4Y2VlZGVkJylcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gSGFuZGxlIG90aGVyIEFQSSBlcnJvcnMgKHdpdGhvdXQgZXhwb3NpbmcgaW50ZXJuYWwgZGV0YWlscylcbiAgICAgIGNvbnN0IHN0YXR1c0NvZGUgPSBheGlvc0Vycm9yLnJlc3BvbnNlPy5zdGF0dXMgfHwgMFxuICAgICAgbG9nZ2VyLmVycm9yKCdJbnN0YWdyYW0gQVBJIGVycm9yJywge1xuICAgICAgICBzdGF0dXM6IHN0YXR1c0NvZGUsXG4gICAgICAgIC8vIERvbid0IGxvZyBwb3RlbnRpYWxseSBzZW5zaXRpdmUgcmVzcG9uc2UgZGF0YVxuICAgICAgfSlcbiAgICAgIFxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnN0YWdyYW0gQVBJIGVycm9yICgke3N0YXR1c0NvZGV9KWApXG4gICAgfVxuICAgIFxuICAgIHRocm93IGVycm9yXG4gICAgXG4gIH0gZmluYWxseSB7XG4gICAgc3Vic2VnbWVudD8uY2xvc2UoKVxuICB9XG59XG5cbi8qKlxuICogV2FpdCBmb3IgSW5zdGFncmFtIHRvIHByb2Nlc3MgbWVkaWFcbiAqL1xuYXN5bmMgZnVuY3Rpb24gd2FpdEZvck1lZGlhUHJvY2Vzc2luZyhcbiAgbWVkaWFDb250YWluZXJJZDogc3RyaW5nLFxuICBhY2Nlc3NUb2tlbjogc3RyaW5nLFxuICBtYXhBdHRlbXB0cyA9IDEwXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgZm9yIChsZXQgYXR0ZW1wdCA9IDA7IGF0dGVtcHQgPCBtYXhBdHRlbXB0czsgYXR0ZW1wdCsrKSB7XG4gICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDMwMDApKSAvLyAzIHNlY29uZHMgYmV0d2VlbiBjaGVja3NcbiAgICBcbiAgICBjb25zdCBzdGF0dXNSZXNwb25zZSA9IGF3YWl0IGF4aW9zSW5zdGFuY2UuZ2V0KFxuICAgICAgYGh0dHBzOi8vZ3JhcGguZmFjZWJvb2suY29tL3YxOC4wLyR7bWVkaWFDb250YWluZXJJZH1gLFxuICAgICAge1xuICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICBmaWVsZHM6ICdzdGF0dXNfY29kZScsXG4gICAgICAgICAgYWNjZXNzX3Rva2VuOiBhY2Nlc3NUb2tlbixcbiAgICAgICAgfSxcbiAgICAgIH1cbiAgICApXG4gICAgXG4gICAgaWYgKHN0YXR1c1Jlc3BvbnNlLmRhdGEuc3RhdHVzX2NvZGUgPT09ICdGSU5JU0hFRCcpIHtcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBcbiAgICBpZiAoc3RhdHVzUmVzcG9uc2UuZGF0YS5zdGF0dXNfY29kZSA9PT0gJ0VSUk9SJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnN0YWdyYW0gbWVkaWEgcHJvY2Vzc2luZyBmYWlsZWQnKVxuICAgIH1cbiAgfVxuICBcbiAgdGhyb3cgbmV3IEVycm9yKCdJbnN0YWdyYW0gbWVkaWEgcHJvY2Vzc2luZyB0aW1lb3V0Jylcbn1cblxuLyoqXG4gKiBGb3JtYXQgY2FwdGlvbiB3aXRoIGhhc2h0YWdzXG4gKi9cbmZ1bmN0aW9uIGZvcm1hdENhcHRpb24oY2FwdGlvbjogc3RyaW5nLCBoYXNodGFnczogc3RyaW5nW10pOiBzdHJpbmcge1xuICBjb25zdCBoYXNodGFnU3RyaW5nID0gaGFzaHRhZ3NcbiAgICAuc2xpY2UoMCwgMzApIC8vIEluc3RhZ3JhbSBsaW1pdFxuICAgIC5tYXAodGFnID0+IHRhZy5zdGFydHNXaXRoKCcjJykgPyB0YWcgOiBgIyR7dGFnfWApXG4gICAgLmpvaW4oJyAnKVxuICBcbiAgY29uc3QgZnVsbENhcHRpb24gPSBgJHtjYXB0aW9ufVxcblxcbiR7aGFzaHRhZ1N0cmluZ31gXG4gIFxuICAvLyBUcnVuY2F0ZSBpZiB0b28gbG9uZ1xuICBpZiAoZnVsbENhcHRpb24ubGVuZ3RoID4gMjIwMCkge1xuICAgIGNvbnN0IHRydW5jYXRlZENhcHRpb24gPSBjYXB0aW9uLnN1YnN0cmluZygwLCAyMjAwIC0gaGFzaHRhZ1N0cmluZy5sZW5ndGggLSA0KSArICcuLi4nXG4gICAgcmV0dXJuIGAke3RydW5jYXRlZENhcHRpb259XFxuXFxuJHtoYXNodGFnU3RyaW5nfWBcbiAgfVxuICBcbiAgcmV0dXJuIGZ1bGxDYXB0aW9uXG59XG5cbi8qKlxuICogVXBkYXRlIGpvYiBzdGF0ZSBpbiBEeW5hbW9EQlxuICovXG5hc3luYyBmdW5jdGlvbiB1cGRhdGVKb2JTdGF0ZShcbiAgam9iSWQ6IHN0cmluZyxcbiAgc3RhdHVzOiBzdHJpbmcsXG4gIGRhdGE6IGFueVxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcbiAgICBUYWJsZU5hbWU6IEpPQl9TVEFURV9UQUJMRV9OQU1FLFxuICAgIEl0ZW06IHtcbiAgICAgIGpvYklkLFxuICAgICAgc3RhdHVzLFxuICAgICAgLy8gRG9uJ3Qgc3RvcmUgc2Vuc2l0aXZlIGRhdGEgaW4gam9iIHN0YXRlXG4gICAgICBkYXRhOiB7XG4gICAgICAgIHNjaGVkdWxlSWQ6IGRhdGEuc2NoZWR1bGVJZCxcbiAgICAgICAgY29udGVudElkOiBkYXRhLmNvbnRlbnRJZCxcbiAgICAgICAgcmVzdWx0OiBkYXRhLnJlc3VsdCxcbiAgICAgICAgZXJyb3I6IGRhdGEuZXJyb3IsXG4gICAgICB9LFxuICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB0dGw6IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDcgKiAyNCAqIDYwICogNjApLCAvLyA3IGRheXMgVFRMXG4gICAgfSxcbiAgfSkpXG59XG5cbi8qKlxuICogU2VuZCBldmVudCB0byBFdmVudEJyaWRnZVxuICovXG5hc3luYyBmdW5jdGlvbiBzZW5kRXZlbnQoc291cmNlOiBzdHJpbmcsIGRldGFpbFR5cGU6IHN0cmluZywgZGV0YWlsOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgZXZlbnRCcmlkZ2VDbGllbnQuc2VuZChuZXcgUHV0RXZlbnRzQ29tbWFuZCh7XG4gICAgRW50cmllczogW3tcbiAgICAgIFNvdXJjZTogc291cmNlLFxuICAgICAgRGV0YWlsVHlwZTogZGV0YWlsVHlwZSxcbiAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoZGV0YWlsKSxcbiAgICAgIEV2ZW50QnVzTmFtZTogRVZFTlRfQlVTX05BTUUsXG4gICAgfV0sXG4gIH0pKVxufSJdfQ==