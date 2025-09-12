"use strict";
/**
 * Content Publishing Saga
 * Manages the distributed transaction for publishing content across platforms
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentPublishingSaga = void 0;
const saga_orchestrator_1 = require("../patterns/saga-orchestrator");
const event_bus_service_1 = require("../services/event-bus-service");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const axios_1 = __importDefault(require("axios"));
const service_discovery_runtime_1 = require("../lambda/shared/service-discovery-runtime");
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const eventBus = event_bus_service_1.EventBusService.getInstance();
const SCHEDULE_TABLE = process.env.SCHEDULE_TABLE_NAME || 'schedules';
const MAIN_APP_URL = process.env.MAIN_APP_URL || 'http://localhost:3000';
class ContentPublishingSaga {
    saga;
    constructor() {
        this.saga = new saga_orchestrator_1.SagaOrchestrator('content-publishing');
        this.configureSaga();
    }
    configureSaga() {
        // Step 1: Update content status to processing
        this.saga.addStep({
            name: 'updateContentStatus',
            service: 'content-service',
            forward: async (ctx) => {
                console.log(`Updating content ${ctx.contentId} status to processing`);
                // Update in main app via API
                const response = await axios_1.default.patch(`${MAIN_APP_URL}/api/content/${ctx.contentId}/status`, { status: 'processing' }, {
                    headers: {
                        'x-correlation-id': ctx.correlationId,
                        'x-user-id': ctx.userId,
                    },
                });
                return response.data;
            },
            compensate: async (ctx) => {
                console.log(`Reverting content ${ctx.contentId} status to scheduled`);
                await axios_1.default.patch(`${MAIN_APP_URL}/api/content/${ctx.contentId}/status`, { status: 'scheduled' }, {
                    headers: {
                        'x-correlation-id': ctx.correlationId,
                        'x-user-id': ctx.userId,
                    },
                });
            },
            retryable: true,
            maxRetries: 3,
            timeout: 10000,
        });
        // Step 2: Get fresh token from token service
        this.saga.addStep({
            name: 'getToken',
            service: 'token-service',
            forward: async (ctx) => {
                console.log(`Getting token for brand ${ctx.brandId} on ${ctx.platform}`);
                // Discover token service endpoint
                const tokenServiceUrl = await (0, service_discovery_runtime_1.discoverService)('token-service');
                // Fetch token from token service (Lambda or API)
                const response = await axios_1.default.get(`${tokenServiceUrl}/tokens/${ctx.userId}/${ctx.brandId}/${ctx.platform}`, {
                    headers: {
                        'x-correlation-id': ctx.correlationId,
                    },
                });
                if (!response.data.token) {
                    throw new Error(`No valid token for ${ctx.platform}`);
                }
                return response.data.token;
            },
            compensate: async () => {
                // No compensation needed for token fetch
            },
            retryable: true,
            maxRetries: 2,
            timeout: 5000,
        });
        // Step 3: Publish to platform
        this.saga.addStep({
            name: 'publishToPlatform',
            service: 'publisher-service',
            forward: async (ctx) => {
                console.log(`Publishing to ${ctx.platform}`);
                const token = ctx['getTokenResult'];
                // Call platform-specific publisher Lambda
                const publisherUrl = `${process.env.PUBLISHER_SERVICE_URL}/${ctx.platform}/publish`;
                const response = await axios_1.default.post(publisherUrl, {
                    content: ctx.content,
                    token: token,
                    brandId: ctx.brandId,
                }, {
                    headers: {
                        'x-correlation-id': ctx.correlationId,
                    },
                });
                // Store platform post ID for potential rollback
                ctx.platformPostId = response.data.postId;
                ctx.permalink = response.data.permalink;
                return response.data;
            },
            compensate: async (ctx, result) => {
                if (result?.postId) {
                    console.log(`Deleting post ${result.postId} from ${ctx.platform}`);
                    try {
                        await axios_1.default.delete(`${process.env.PUBLISHER_SERVICE_URL}/${ctx.platform}/posts/${result.postId}`, {
                            headers: {
                                'x-correlation-id': ctx.correlationId,
                            },
                        });
                    }
                    catch (error) {
                        console.error('Failed to delete post from platform', error);
                        // Continue with compensation even if deletion fails
                    }
                }
            },
            retryable: true,
            maxRetries: 3,
            timeout: 30000,
        });
        // Step 4: Update schedule status
        this.saga.addStep({
            name: 'updateScheduleStatus',
            service: 'scheduler-service',
            forward: async (ctx) => {
                console.log(`Updating schedule ${ctx.scheduleId} to published`);
                await docClient.send(new lib_dynamodb_1.UpdateCommand({
                    TableName: SCHEDULE_TABLE,
                    Key: { scheduleId: ctx.scheduleId },
                    UpdateExpression: 'SET #status = :status, publishedAt = :publishedAt, platformPostId = :postId, permalink = :permalink',
                    ExpressionAttributeNames: {
                        '#status': 'status',
                    },
                    ExpressionAttributeValues: {
                        ':status': 'published',
                        ':publishedAt': new Date().toISOString(),
                        ':postId': ctx.platformPostId,
                        ':permalink': ctx.permalink,
                    },
                }));
                return { status: 'published' };
            },
            compensate: async (ctx) => {
                console.log(`Reverting schedule ${ctx.scheduleId} to scheduled`);
                await docClient.send(new lib_dynamodb_1.UpdateCommand({
                    TableName: SCHEDULE_TABLE,
                    Key: { scheduleId: ctx.scheduleId },
                    UpdateExpression: 'SET #status = :status, REMOVE publishedAt, platformPostId, permalink',
                    ExpressionAttributeNames: {
                        '#status': 'status',
                    },
                    ExpressionAttributeValues: {
                        ':status': 'scheduled',
                    },
                }));
            },
            retryable: true,
            maxRetries: 3,
        });
        // Step 5: Update content with platform data
        this.saga.addStep({
            name: 'updateContentWithPlatformData',
            service: 'content-service',
            forward: async (ctx) => {
                console.log(`Updating content ${ctx.contentId} with platform data`);
                await axios_1.default.patch(`${MAIN_APP_URL}/api/content/${ctx.contentId}`, {
                    status: 'published',
                    platformPostId: ctx.platformPostId,
                    permalink: ctx.permalink,
                    publishedAt: new Date().toISOString(),
                }, {
                    headers: {
                        'x-correlation-id': ctx.correlationId,
                        'x-user-id': ctx.userId,
                    },
                });
                return { updated: true };
            },
            compensate: async (ctx) => {
                console.log(`Removing platform data from content ${ctx.contentId}`);
                await axios_1.default.patch(`${MAIN_APP_URL}/api/content/${ctx.contentId}`, {
                    status: 'scheduled',
                    platformPostId: null,
                    permalink: null,
                    publishedAt: null,
                }, {
                    headers: {
                        'x-correlation-id': ctx.correlationId,
                        'x-user-id': ctx.userId,
                    },
                });
            },
            retryable: true,
            maxRetries: 3,
        });
        // Step 6: Publish success event
        this.saga.addStep({
            name: 'publishSuccessEvent',
            service: 'event-bus',
            forward: async (ctx) => {
                console.log(`Publishing post.published event`);
                await eventBus.publish('post.published', {
                    scheduleId: ctx.scheduleId,
                    contentId: ctx.contentId,
                    brandId: ctx.brandId,
                    platform: ctx.platform,
                    platformPostId: ctx.platformPostId,
                    permalink: ctx.permalink,
                    publishedAt: new Date().toISOString(),
                }, {
                    correlationId: ctx.correlationId,
                    userId: ctx.userId,
                    brandId: ctx.brandId,
                });
                return { eventPublished: true };
            },
            compensate: async (ctx) => {
                // Publish failure event
                await eventBus.publish('post.unpublished', {
                    scheduleId: ctx.scheduleId,
                    contentId: ctx.contentId,
                    brandId: ctx.brandId,
                    platform: ctx.platform,
                    reason: 'Saga compensation',
                }, {
                    correlationId: ctx.correlationId,
                    userId: ctx.userId,
                    brandId: ctx.brandId,
                });
            },
            retryable: true,
            maxRetries: 2,
        });
    }
    /**
     * Execute the content publishing saga
     */
    async execute(context) {
        console.log(`Starting content publishing saga for content ${context.contentId}`);
        try {
            const result = await this.saga.execute(context);
            console.log(`Content publishing saga completed successfully`, {
                contentId: context.contentId,
                platformPostId: result.platformPostId,
                permalink: result.permalink,
            });
            return result;
        }
        catch (error) {
            console.error(`Content publishing saga failed`, error);
            // Publish failure event
            await eventBus.publish('post.failed', {
                scheduleId: context.scheduleId,
                contentId: context.contentId,
                brandId: context.brandId,
                platform: context.platform,
                error: {
                    code: 'SAGA_FAILED',
                    message: error instanceof Error ? error.message : 'Unknown error',
                    retryable: false,
                },
                attemptNumber: 1,
            }, {
                correlationId: context.correlationId,
                userId: context.userId,
                brandId: context.brandId,
            });
            throw error;
        }
    }
}
exports.ContentPublishingSaga = ContentPublishingSaga;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC1wdWJsaXNoaW5nLXNhZ2EuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb250ZW50LXB1Ymxpc2hpbmctc2FnYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztHQUdHOzs7Ozs7QUFFSCxxRUFBNkU7QUFDN0UscUVBQStEO0FBQy9ELDhEQUF5RDtBQUN6RCx3REFBNkU7QUFDN0Usa0RBQXlCO0FBQ3pCLDBGQUE0RTtBQUU1RSxNQUFNLFlBQVksR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxDQUFDLENBQUE7QUFDM0MsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFBO0FBQzNELE1BQU0sUUFBUSxHQUFHLG1DQUFlLENBQUMsV0FBVyxFQUFFLENBQUE7QUFFOUMsTUFBTSxjQUFjLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsSUFBSSxXQUFXLENBQUE7QUFDckUsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZLElBQUksdUJBQXVCLENBQUE7QUFleEUsTUFBYSxxQkFBcUI7SUFDeEIsSUFBSSxDQUE0QztJQUV4RDtRQUNFLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxvQ0FBZ0IsQ0FBMkIsb0JBQW9CLENBQUMsQ0FBQTtRQUNoRixJQUFJLENBQUMsYUFBYSxFQUFFLENBQUE7SUFDdEIsQ0FBQztJQUVPLGFBQWE7UUFDbkIsOENBQThDO1FBQzlDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDO1lBQ2hCLElBQUksRUFBRSxxQkFBcUI7WUFDM0IsT0FBTyxFQUFFLGlCQUFpQjtZQUMxQixPQUFPLEVBQUUsS0FBSyxFQUFFLEdBQUcsRUFBRSxFQUFFO2dCQUNyQixPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFvQixHQUFHLENBQUMsU0FBUyx1QkFBdUIsQ0FBQyxDQUFBO2dCQUVyRSw2QkFBNkI7Z0JBQzdCLE1BQU0sUUFBUSxHQUFHLE1B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TyxNQUFNLENBQUE7UUFDZixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsZ0NBQWdDLEVBQUUsS0FBSyxDQUFDLENBQUE7WUFFdEQsd0JBQXdCO1lBQ3hCLE1BQU0sUUFBUSxDQUFDLE9BQU8sQ0FBQyxhQUFhLEVBQUU7Z0JBQ3BDLFVBQVUsRUFBRSxPQUFPLENBQUMsVUFBVTtnQkFDOUIsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTO2dCQUM1QixPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87Z0JBQ3hCLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUTtnQkFDMUIsS0FBSyxFQUFFO29CQUNMLElBQUksRUFBRSxhQUFhO29CQUNuQixPQUFPLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTtvQkFDakUsU0FBUyxFQUFFLEtBQUs7aUJBQ2pCO2dCQUNELGFBQWEsRUFBRSxDQUFDO2FBQ2pCLEVBQUU7Z0JBQ0QsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhO2dCQUNwQyxNQUFNLEVBQUUsT0FBTyxDQUFDLE1BQU07Z0JBQ3RCLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTzthQUN6QixDQUFDLENBQUE7WUFFRixNQUFNLEtBQUssQ0FBQTtRQUNiLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUF2VEQsc0RBdVRDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBDb250ZW50IFB1Ymxpc2hpbmcgU2FnYVxuICogTWFuYWdlcyB0aGUgZGlzdHJpYnV0ZWQgdHJhbnNhY3Rpb24gZm9yIHB1Ymxpc2hpbmcgY29udGVudCBhY3Jvc3MgcGxhdGZvcm1zXG4gKi9cblxuaW1wb3J0IHsgU2FnYU9yY2hlc3RyYXRvciwgU2FnYUNvbnRleHQgfSBmcm9tICcuLi9wYXR0ZXJucy9zYWdhLW9yY2hlc3RyYXRvcidcbmltcG9ydCB7IEV2ZW50QnVzU2VydmljZSB9IGZyb20gJy4uL3NlcnZpY2VzL2V2ZW50LWJ1cy1zZXJ2aWNlJ1xuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBVcGRhdGVDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJ1xuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJ1xuaW1wb3J0IHsgZGlzY292ZXJTZXJ2aWNlIH0gZnJvbSAnLi4vbGFtYmRhL3NoYXJlZC9zZXJ2aWNlLWRpc2NvdmVyeS1ydW50aW1lJ1xuXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KVxuY29uc3QgZXZlbnRCdXMgPSBFdmVudEJ1c1NlcnZpY2UuZ2V0SW5zdGFuY2UoKVxuXG5jb25zdCBTQ0hFRFVMRV9UQUJMRSA9IHByb2Nlc3MuZW52LlNDSEVEVUxFX1RBQkxFX05BTUUgfHwgJ3NjaGVkdWxlcydcbmNvbnN0IE1BSU5fQVBQX1VSTCA9IHByb2Nlc3MuZW52Lk1BSU5fQVBQX1VSTCB8fCAnaHR0cDovL2xvY2FsaG9zdDozMDAwJ1xuXG5leHBvcnQgaW50ZXJmYWNlIENvbnRlbnRQdWJsaXNoaW5nQ29udGV4dCBleHRlbmRzIFNhZ2FDb250ZXh0IHtcbiAgY29udGVudElkOiBzdHJpbmdcbiAgc2NoZWR1bGVJZDogc3RyaW5nXG4gIHBsYXRmb3JtOiAnaW5zdGFncmFtJyB8ICdmYWNlYm9vaycgfCAnbGlua2VkaW4nIHwgJ3Rpa3RvaydcbiAgY29udGVudDoge1xuICAgIGNhcHRpb246IHN0cmluZ1xuICAgIGhhc2h0YWdzOiBzdHJpbmdbXVxuICAgIG1lZGlhVXJsPzogc3RyaW5nXG4gIH1cbiAgcGxhdGZvcm1Qb3N0SWQ/OiBzdHJpbmdcbiAgcGVybWFsaW5rPzogc3RyaW5nXG59XG5cbmV4cG9ydCBjbGFzcyBDb250ZW50UHVibGlzaGluZ1NhZ2Ege1xuICBwcml2YXRlIHNhZ2E6IFNhZ2FPcmNoZXN0cmF0b3I8Q29udGVudFB1Ymxpc2hpbmdDb250ZXh0PlxuICBcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5zYWdhID0gbmV3IFNhZ2FPcmNoZXN0cmF0b3I8Q29udGVudFB1Ymxpc2hpbmdDb250ZXh0PignY29udGVudC1wdWJsaXNoaW5nJylcbiAgICB0aGlzLmNvbmZpZ3VyZVNhZ2EoKVxuICB9XG4gIFxuICBwcml2YXRlIGNvbmZpZ3VyZVNhZ2EoKSB7XG4gICAgLy8gU3RlcCAxOiBVcGRhdGUgY29udGVudCBzdGF0dXMgdG8gcHJvY2Vzc2luZ1xuICAgIHRoaXMuc2FnYS5hZGRTdGVwKHtcbiAgICAgIG5hbWU6ICd1cGRhdGVDb250ZW50U3RhdHVzJyxcbiAgICAgIHNlcnZpY2U6ICdjb250ZW50LXNlcnZpY2UnLFxuICAgICAgZm9yd2FyZDogYXN5bmMgKGN0eCkgPT4ge1xuICAgICAgICBjb25zb2xlLmxvZyhgVXBkYXRpbmcgY29udGVudCAke2N0eC5jb250ZW50SWR9IHN0YXR1cyB0byBwcm9jZXNzaW5nYClcbiAgICAgICAgXG4gICAgICAgIC8vIFVwZGF0ZSBpbiBtYWluIGFwcCB2aWEgQVBJXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MucGF0Y2goXG4gICAgICAgICAgYCR7TUFJTl9BUFBfVVJMfS9hcGkvY29udGVudC8ke2N0eC5jb250ZW50SWR9L3N0YXR1c2AsXG4gICAgICAgICAgeyBzdGF0dXM6ICdwcm9jZXNzaW5nJyB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgJ3gtY29ycmVsYXRpb24taWQnOiBjdHguY29ycmVsYXRpb25JZCxcbiAgICAgICAgICAgICAgJ3gtdXNlci1pZCc6IGN0eC51c2VySWQsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH1cbiAgICAgICAgKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHJlc3BvbnNlLmRhdGFcbiAgICAgIH0sXG4gICAgICBjb21wZW5zYXRlOiBhc3luYyAoY3R4KSA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBSZXZlcnRpbmcgY29udGVudCAke2N0eC5jb250ZW50SWR9IHN0YXR1cyB0byBzY2hlZHVsZWRgKVxuICAgICAgICBcbiAgICAgICAgYXdhaXQgYXhpb3MucGF0Y2goXG4gICAgICAgICAgYCR7TUFJTl9BUFBfVVJMfS9hcGkvY29udGVudC8ke2N0eC5jb250ZW50SWR9L3N0YXR1c2AsXG4gICAgICAgICAgeyBzdGF0dXM6ICdzY2hlZHVsZWQnIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAneC1jb3JyZWxhdGlvbi1pZCc6IGN0eC5jb3JyZWxhdGlvbklkLFxuICAgICAgICAgICAgICAneC11c2VyLWlkJzogY3R4LnVzZXJJZCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfVxuICAgICAgICApXG4gICAgICB9LFxuICAgICAgcmV0cnlhYmxlOiB0cnVlLFxuICAgICAgbWF4UmV0cmllczogMyxcbiAgICAgIHRpbWVvdXQ6IDEwMDAwLFxuICAgIH0pXG4gICAgXG4gICAgLy8gU3RlcCAyOiBHZXQgZnJlc2ggdG9rZW4gZnJvbSB0b2tlbiBzZXJ2aWNlXG4gICAgdGhpcy5zYWdhLmFkZFN0ZXAoe1xuICAgICAgbmFtZTogJ2dldFRva2VuJyxcbiAgICAgIHNlcnZpY2U6ICd0b2tlbi1zZXJ2aWNlJyxcbiAgICAgIGZvcndhcmQ6IGFzeW5jIChjdHgpID0+IHtcbiAgICAgICAgY29uc29sZS5sb2coYEdldHRpbmcgdG9rZW4gZm9yIGJyYW5kICR7Y3R4LmJyYW5kSWR9IG9uICR7Y3R4LnBsYXRmb3JtfWApXG4gICAgICAgIFxuICAgICAgICAvLyBEaXNjb3ZlciB0b2tlbiBzZXJ2aWNlIGVuZHBvaW50XG4gICAgICAgIGNvbnN0IHRva2VuU2VydmljZVVybCA9IGF3YWl0IGRpc2NvdmVyU2VydmljZSgndG9rZW4tc2VydmljZScpXG4gICAgICAgIFxuICAgICAgICAvLyBGZXRjaCB0b2tlbiBmcm9tIHRva2VuIHNlcnZpY2UgKExhbWJkYSBvciBBUEkpXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0KFxuICAgICAgICAgIGAke3Rva2VuU2VydmljZVVybH0vdG9rZW5zLyR7Y3R4LnVzZXJJZH0vJHtjdHguYnJhbmRJZH0vJHtjdHgucGxhdGZvcm19YCxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICd4LWNvcnJlbGF0aW9uLWlkJzogY3R4LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH1cbiAgICAgICAgKVxuICAgICAgICBcbiAgICAgICAgaWYgKCFyZXNwb25zZS5kYXRhLnRva2VuKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB2YWxpZCB0b2tlbiBmb3IgJHtjdHgucGxhdGZvcm19YClcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHJlc3BvbnNlLmRhdGEudG9rZW5cbiAgICAgIH0sXG4gICAgICBjb21wZW5zYXRlOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIE5vIGNvbXBlbnNhdGlvbiBuZWVkZWQgZm9yIHRva2VuIGZldGNoXG4gICAgICB9LFxuICAgICAgcmV0cnlhYmxlOiB0cnVlLFxuICAgICAgbWF4UmV0cmllczogMixcbiAgICAgIHRpbWVvdXQ6IDUwMDAsXG4gICAgfSlcbiAgICBcbiAgICAvLyBTdGVwIDM6IFB1Ymxpc2ggdG8gcGxhdGZvcm1cbiAgICB0aGlzLnNhZ2EuYWRkU3RlcCh7XG4gICAgICBuYW1lOiAncHVibGlzaFRvUGxhdGZvcm0nLFxuICAgICAgc2VydmljZTogJ3B1Ymxpc2hlci1zZXJ2aWNlJyxcbiAgICAgIGZvcndhcmQ6IGFzeW5jIChjdHgpID0+IHtcbiAgICAgICAgY29uc29sZS5sb2coYFB1Ymxpc2hpbmcgdG8gJHtjdHgucGxhdGZvcm19YClcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IHRva2VuID0gY3R4WydnZXRUb2tlblJlc3VsdCddXG4gICAgICAgIFxuICAgICAgICAvLyBDYWxsIHBsYXRmb3JtLXNwZWNpZmljIHB1Ymxpc2hlciBMYW1iZGFcbiAgICAgICAgY29uc3QgcHVibGlzaGVyVXJsID0gYCR7cHJvY2Vzcy5lbnYuUFVCTElTSEVSX1NFUlZJQ0VfVVJMfS8ke2N0eC5wbGF0Zm9ybX0vcHVibGlzaGBcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5wb3N0KFxuICAgICAgICAgIHB1Ymxpc2hlclVybCxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBjb250ZW50OiBjdHguY29udGVudCxcbiAgICAgICAgICAgIHRva2VuOiB0b2tlbixcbiAgICAgICAgICAgIGJyYW5kSWQ6IGN0eC5icmFuZElkLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAneC1jb3JyZWxhdGlvbi1pZCc6IGN0eC5jb3JyZWxhdGlvbklkLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9XG4gICAgICAgIClcbiAgICAgICAgXG4gICAgICAgIC8vIFN0b3JlIHBsYXRmb3JtIHBvc3QgSUQgZm9yIHBvdGVudGlhbCByb2xsYmFja1xuICAgICAgICBjdHgucGxhdGZvcm1Qb3N0SWQgPSByZXNwb25zZS5kYXRhLnBvc3RJZFxuICAgICAgICBjdHgucGVybWFsaW5rID0gcmVzcG9uc2UuZGF0YS5wZXJtYWxpbmtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiByZXNwb25zZS5kYXRhXG4gICAgICB9LFxuICAgICAgY29tcGVuc2F0ZTogYXN5bmMgKGN0eCwgcmVzdWx0KSA9PiB7XG4gICAgICAgIGlmIChyZXN1bHQ/LnBvc3RJZCkge1xuICAgICAgICAgIGNvbnNvbGUubG9nKGBEZWxldGluZyBwb3N0ICR7cmVzdWx0LnBvc3RJZH0gZnJvbSAke2N0eC5wbGF0Zm9ybX1gKVxuICAgICAgICAgIFxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCBheGlvcy5kZWxldGUoXG4gICAgICAgICAgICAgIGAke3Byb2Nlc3MuZW52LlBVQkxJU0hFUl9TRVJWSUNFX1VSTH0vJHtjdHgucGxhdGZvcm19L3Bvc3RzLyR7cmVzdWx0LnBvc3RJZH1gLFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICAgJ3gtY29ycmVsYXRpb24taWQnOiBjdHguY29ycmVsYXRpb25JZCxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICApXG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBkZWxldGUgcG9zdCBmcm9tIHBsYXRmb3JtJywgZXJyb3IpXG4gICAgICAgICAgICAvLyBDb250aW51ZSB3aXRoIGNvbXBlbnNhdGlvbiBldmVuIGlmIGRlbGV0aW9uIGZhaWxzXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgcmV0cnlhYmxlOiB0cnVlLFxuICAgICAgbWF4UmV0cmllczogMyxcbiAgICAgIHRpbWVvdXQ6IDMwMDAwLFxuICAgIH0pXG4gICAgXG4gICAgLy8gU3RlcCA0OiBVcGRhdGUgc2NoZWR1bGUgc3RhdHVzXG4gICAgdGhpcy5zYWdhLmFkZFN0ZXAoe1xuICAgICAgbmFtZTogJ3VwZGF0ZVNjaGVkdWxlU3RhdHVzJyxcbiAgICAgIHNlcnZpY2U6ICdzY2hlZHVsZXItc2VydmljZScsXG4gICAgICBmb3J3YXJkOiBhc3luYyAoY3R4KSA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBVcGRhdGluZyBzY2hlZHVsZSAke2N0eC5zY2hlZHVsZUlkfSB0byBwdWJsaXNoZWRgKVxuICAgICAgICBcbiAgICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFVwZGF0ZUNvbW1hbmQoe1xuICAgICAgICAgIFRhYmxlTmFtZTogU0NIRURVTEVfVEFCTEUsXG4gICAgICAgICAgS2V5OiB7IHNjaGVkdWxlSWQ6IGN0eC5zY2hlZHVsZUlkIH0sXG4gICAgICAgICAgVXBkYXRlRXhwcmVzc2lvbjogJ1NFVCAjc3RhdHVzID0gOnN0YXR1cywgcHVibGlzaGVkQXQgPSA6cHVibGlzaGVkQXQsIHBsYXRmb3JtUG9zdElkID0gOnBvc3RJZCwgcGVybWFsaW5rID0gOnBlcm1hbGluaycsXG4gICAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XG4gICAgICAgICAgICAnI3N0YXR1cyc6ICdzdGF0dXMnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xuICAgICAgICAgICAgJzpzdGF0dXMnOiAncHVibGlzaGVkJyxcbiAgICAgICAgICAgICc6cHVibGlzaGVkQXQnOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICAnOnBvc3RJZCc6IGN0eC5wbGF0Zm9ybVBvc3RJZCxcbiAgICAgICAgICAgICc6cGVybWFsaW5rJzogY3R4LnBlcm1hbGluayxcbiAgICAgICAgICB9LFxuICAgICAgICB9KSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7IHN0YXR1czogJ3B1Ymxpc2hlZCcgfVxuICAgICAgfSxcbiAgICAgIGNvbXBlbnNhdGU6IGFzeW5jIChjdHgpID0+IHtcbiAgICAgICAgY29uc29sZS5sb2coYFJldmVydGluZyBzY2hlZHVsZSAke2N0eC5zY2hlZHVsZUlkfSB0byBzY2hlZHVsZWRgKVxuICAgICAgICBcbiAgICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFVwZGF0ZUNvbW1hbmQoe1xuICAgICAgICAgIFRhYmxlTmFtZTogU0NIRURVTEVfVEFCTEUsXG4gICAgICAgICAgS2V5OiB7IHNjaGVkdWxlSWQ6IGN0eC5zY2hlZHVsZUlkIH0sXG4gICAgICAgICAgVXBkYXRlRXhwcmVzc2lvbjogJ1NFVCAjc3RhdHVzID0gOnN0YXR1cywgUkVNT1ZFIHB1Ymxpc2hlZEF0LCBwbGF0Zm9ybVBvc3RJZCwgcGVybWFsaW5rJyxcbiAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcbiAgICAgICAgICAgICcjc3RhdHVzJzogJ3N0YXR1cycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XG4gICAgICAgICAgICAnOnN0YXR1cyc6ICdzY2hlZHVsZWQnLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pKVxuICAgICAgfSxcbiAgICAgIHJldHJ5YWJsZTogdHJ1ZSxcbiAgICAgIG1heFJldHJpZXM6IDMsXG4gICAgfSlcbiAgICBcbiAgICAvLyBTdGVwIDU6IFVwZGF0ZSBjb250ZW50IHdpdGggcGxhdGZvcm0gZGF0YVxuICAgIHRoaXMuc2FnYS5hZGRTdGVwKHtcbiAgICAgIG5hbWU6ICd1cGRhdGVDb250ZW50V2l0aFBsYXRmb3JtRGF0YScsXG4gICAgICBzZXJ2aWNlOiAnY29udGVudC1zZXJ2aWNlJyxcbiAgICAgIGZvcndhcmQ6IGFzeW5jIChjdHgpID0+IHtcbiAgICAgICAgY29uc29sZS5sb2coYFVwZGF0aW5nIGNvbnRlbnQgJHtjdHguY29udGVudElkfSB3aXRoIHBsYXRmb3JtIGRhdGFgKVxuICAgICAgICBcbiAgICAgICAgYXdhaXQgYXhpb3MucGF0Y2goXG4gICAgICAgICAgYCR7TUFJTl9BUFBfVVJMfS9hcGkvY29udGVudC8ke2N0eC5jb250ZW50SWR9YCxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzdGF0dXM6ICdwdWJsaXNoZWQnLFxuICAgICAgICAgICAgcGxhdGZvcm1Qb3N0SWQ6IGN0eC5wbGF0Zm9ybVBvc3RJZCxcbiAgICAgICAgICAgIHBlcm1hbGluazogY3R4LnBlcm1hbGluayxcbiAgICAgICAgICAgIHB1Ymxpc2hlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICd4LWNvcnJlbGF0aW9uLWlkJzogY3R4LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgICAgICd4LXVzZXItaWQnOiBjdHgudXNlcklkLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9XG4gICAgICAgIClcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7IHVwZGF0ZWQ6IHRydWUgfVxuICAgICAgfSxcbiAgICAgIGNvbXBlbnNhdGU6IGFzeW5jIChjdHgpID0+IHtcbiAgICAgICAgY29uc29sZS5sb2coYFJlbW92aW5nIHBsYXRmb3JtIGRhdGEgZnJvbSBjb250ZW50ICR7Y3R4LmNvbnRlbnRJZH1gKVxuICAgICAgICBcbiAgICAgICAgYXdhaXQgYXhpb3MucGF0Y2goXG4gICAgICAgICAgYCR7TUFJTl9BUFBfVVJMfS9hcGkvY29udGVudC8ke2N0eC5jb250ZW50SWR9YCxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzdGF0dXM6ICdzY2hlZHVsZWQnLFxuICAgICAgICAgICAgcGxhdGZvcm1Qb3N0SWQ6IG51bGwsXG4gICAgICAgICAgICBwZXJtYWxpbms6IG51bGwsXG4gICAgICAgICAgICBwdWJsaXNoZWRBdDogbnVsbCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgJ3gtY29ycmVsYXRpb24taWQnOiBjdHguY29ycmVsYXRpb25JZCxcbiAgICAgICAgICAgICAgJ3gtdXNlci1pZCc6IGN0eC51c2VySWQsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH1cbiAgICAgICAgKVxuICAgICAgfSxcbiAgICAgIHJldHJ5YWJsZTogdHJ1ZSxcbiAgICAgIG1heFJldHJpZXM6IDMsXG4gICAgfSlcbiAgICBcbiAgICAvLyBTdGVwIDY6IFB1Ymxpc2ggc3VjY2VzcyBldmVudFxuICAgIHRoaXMuc2FnYS5hZGRTdGVwKHtcbiAgICAgIG5hbWU6ICdwdWJsaXNoU3VjY2Vzc0V2ZW50JyxcbiAgICAgIHNlcnZpY2U6ICdldmVudC1idXMnLFxuICAgICAgZm9yd2FyZDogYXN5bmMgKGN0eCkgPT4ge1xuICAgICAgICBjb25zb2xlLmxvZyhgUHVibGlzaGluZyBwb3N0LnB1Ymxpc2hlZCBldmVudGApXG4gICAgICAgIFxuICAgICAgICBhd2FpdCBldmVudEJ1cy5wdWJsaXNoKCdwb3N0LnB1Ymxpc2hlZCcsIHtcbiAgICAgICAgICBzY2hlZHVsZUlkOiBjdHguc2NoZWR1bGVJZCxcbiAgICAgICAgICBjb250ZW50SWQ6IGN0eC5jb250ZW50SWQsXG4gICAgICAgICAgYnJhbmRJZDogY3R4LmJyYW5kSWQsXG4gICAgICAgICAgcGxhdGZvcm06IGN0eC5wbGF0Zm9ybSxcbiAgICAgICAgICBwbGF0Zm9ybVBvc3RJZDogY3R4LnBsYXRmb3JtUG9zdElkISxcbiAgICAgICAgICBwZXJtYWxpbms6IGN0eC5wZXJtYWxpbmshLFxuICAgICAgICAgIHB1Ymxpc2hlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0sIHtcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiBjdHguY29ycmVsYXRpb25JZCxcbiAgICAgICAgICB1c2VySWQ6IGN0eC51c2VySWQsXG4gICAgICAgICAgYnJhbmRJZDogY3R4LmJyYW5kSWQsXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4geyBldmVudFB1Ymxpc2hlZDogdHJ1ZSB9XG4gICAgICB9LFxuICAgICAgY29tcGVuc2F0ZTogYXN5bmMgKGN0eCkgPT4ge1xuICAgICAgICAvLyBQdWJsaXNoIGZhaWx1cmUgZXZlbnRcbiAgICAgICAgYXdhaXQgZXZlbnRCdXMucHVibGlzaCgncG9zdC51bnB1Ymxpc2hlZCcsIHtcbiAgICAgICAgICBzY2hlZHVsZUlkOiBjdHguc2NoZWR1bGVJZCxcbiAgICAgICAgICBjb250ZW50SWQ6IGN0eC5jb250ZW50SWQsXG4gICAgICAgICAgYnJhbmRJZDogY3R4LmJyYW5kSWQsXG4gICAgICAgICAgcGxhdGZvcm06IGN0eC5wbGF0Zm9ybSxcbiAgICAgICAgICByZWFzb246ICdTYWdhIGNvbXBlbnNhdGlvbicsXG4gICAgICAgIH0sIHtcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiBjdHguY29ycmVsYXRpb25JZCxcbiAgICAgICAgICB1c2VySWQ6IGN0eC51c2VySWQsXG4gICAgICAgICAgYnJhbmRJZDogY3R4LmJyYW5kSWQsXG4gICAgICAgIH0pXG4gICAgICB9LFxuICAgICAgcmV0cnlhYmxlOiB0cnVlLFxuICAgICAgbWF4UmV0cmllczogMixcbiAgICB9KVxuICB9XG4gIFxuICAvKipcbiAgICogRXhlY3V0ZSB0aGUgY29udGVudCBwdWJsaXNoaW5nIHNhZ2FcbiAgICovXG4gIGFzeW5jIGV4ZWN1dGUoY29udGV4dDogQ29udGVudFB1Ymxpc2hpbmdDb250ZXh0KTogUHJvbWlzZTxDb250ZW50UHVibGlzaGluZ0NvbnRleHQ+IHtcbiAgICBjb25zb2xlLmxvZyhgU3RhcnRpbmcgY29udGVudCBwdWJsaXNoaW5nIHNhZ2EgZm9yIGNvbnRlbnQgJHtjb250ZXh0LmNvbnRlbnRJZH1gKVxuICAgIFxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnNhZ2EuZXhlY3V0ZShjb250ZXh0KVxuICAgICAgXG4gICAgICBjb25zb2xlLmxvZyhgQ29udGVudCBwdWJsaXNoaW5nIHNhZ2EgY29tcGxldGVkIHN1Y2Nlc3NmdWxseWAsIHtcbiAgICAgICAgY29udGVudElkOiBjb250ZXh0LmNvbnRlbnRJZCxcbiAgICAgICAgcGxhdGZvcm1Qb3N0SWQ6IHJlc3VsdC5wbGF0Zm9ybVBvc3RJZCxcbiAgICAgICAgcGVybWFsaW5rOiByZXN1bHQucGVybWFsaW5rLFxuICAgICAgfSlcbiAgICAgIFxuICAgICAgcmV0dXJuIHJlc3VsdFxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGBDb250ZW50IHB1Ymxpc2hpbmcgc2FnYSBmYWlsZWRgLCBlcnJvcilcbiAgICAgIFxuICAgICAgLy8gUHVibGlzaCBmYWlsdXJlIGV2ZW50XG4gICAgICBhd2FpdCBldmVudEJ1cy5wdWJsaXNoKCdwb3N0LmZhaWxlZCcsIHtcbiAgICAgICAgc2NoZWR1bGVJZDogY29udGV4dC5zY2hlZHVsZUlkLFxuICAgICAgICBjb250ZW50SWQ6IGNvbnRleHQuY29udGVudElkLFxuICAgICAgICBicmFuZElkOiBjb250ZXh0LmJyYW5kSWQsXG4gICAgICAgIHBsYXRmb3JtOiBjb250ZXh0LnBsYXRmb3JtLFxuICAgICAgICBlcnJvcjoge1xuICAgICAgICAgIGNvZGU6ICdTQUdBX0ZBSUxFRCcsXG4gICAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgICAgICAgcmV0cnlhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgYXR0ZW1wdE51bWJlcjogMSxcbiAgICAgIH0sIHtcbiAgICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dC5jb3JyZWxhdGlvbklkLFxuICAgICAgICB1c2VySWQ6IGNvbnRleHQudXNlcklkLFxuICAgICAgICBicmFuZElkOiBjb250ZXh0LmJyYW5kSWQsXG4gICAgICB9KVxuICAgICAgXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxufVxuIl19