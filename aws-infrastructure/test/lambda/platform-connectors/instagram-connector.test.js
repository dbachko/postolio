"use strict";
/**
 * Instagram Connector Unit Tests
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instagram_connector_1 = require("../../../lib/lambda/platform-connectors/instagram-connector");
const axios_1 = __importDefault(require("axios"));
const client_secrets_manager_1 = require("@aws-sdk/client-secrets-manager");
const aws_sdk_client_mock_1 = require("aws-sdk-client-mock");
// Mock AWS SDK
const secretsManagerMock = (0, aws_sdk_client_mock_1.mockClient)(client_secrets_manager_1.SecretsManagerClient);
// Mock axios
jest.mock('axios');
const mockedAxios = axios_1.default;
// Mock logger
jest.mock('@aws-lambda-powertools/logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        addPersistentLogAttributes: jest.fn(),
    })),
}));
// Mock metrics
jest.mock('@aws-lambda-powertools/metrics', () => ({
    Metrics: jest.fn().mockImplementation(() => ({
        addMetric: jest.fn(),
        publishStoredMetrics: jest.fn(),
    })),
    MetricUnit: {
        Count: 'Count',
        Milliseconds: 'Milliseconds',
    },
}));
// Mock tracer
jest.mock('@aws-lambda-powertools/tracer', () => ({
    Tracer: jest.fn().mockImplementation(() => ({
        captureAWSv3Client: jest.fn((client) => client),
    })),
}));
describe('InstagramConnector', () => {
    let connector;
    beforeEach(() => {
        jest.clearAllMocks();
        secretsManagerMock.reset();
        connector = new instagram_connector_1.InstagramConnector();
    });
    describe('authenticate', () => {
        it('should authenticate successfully with valid credentials', async () => {
            // Mock Secrets Manager
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'test-access-token',
                    accountId: 'test-account-id',
                    clientId: 'test-client-id',
                    clientSecret: 'test-client-secret',
                }),
            });
            // Mock API client
            const mockApiClient = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        id: 'test-account-id',
                        username: 'test_user',
                        account_type: 'BUSINESS',
                        media_count: 100,
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            await connector.authenticate();
            expect(mockedAxios.create).toHaveBeenCalledWith({
                baseURL: 'https://graph.facebook.com/v18.0',
                headers: {
                    'Content-Type': 'application/json',
                },
                params: {
                    access_token: 'test-access-token',
                },
            });
            expect(mockApiClient.get).toHaveBeenCalledWith('/test-account-id', {
                params: {
                    fields: 'id,username,account_type,media_count',
                },
            });
        });
        it('should throw error when authentication fails', async () => {
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'invalid-token',
                    accountId: 'test-account-id',
                }),
            });
            const mockApiClient = {
                get: jest.fn().mockRejectedValue(new Error('Invalid OAuth 2.0 Access Token')),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            await expect(connector.authenticate()).rejects.toThrow('Failed to authenticate with Instagram');
        });
    });
    describe('publishContent', () => {
        beforeEach(async () => {
            // Setup authenticated connector
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'test-access-token',
                    accountId: 'test-account-id',
                }),
            });
        });
        it('should publish image content successfully', async () => {
            const mockApiClient = {
                get: jest.fn()
                    .mockResolvedValueOnce({
                    data: { id: 'test-account-id', username: 'test_user', account_type: 'BUSINESS' },
                })
                    .mockResolvedValueOnce({
                    data: { status_code: 'FINISHED' },
                })
                    .mockResolvedValueOnce({
                    data: {
                        id: 'published-media-id',
                        permalink: 'https://www.instagram.com/p/test123/',
                        media_url: 'https://example.com/image.jpg',
                        caption: 'Test caption',
                    },
                }),
                post: jest.fn()
                    .mockResolvedValueOnce({
                    data: { id: 'container-id' },
                })
                    .mockResolvedValueOnce({
                    data: { id: 'published-media-id' },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            const content = {
                contentId: 'test-content-1',
                caption: 'Test caption',
                hashtags: ['test', 'instagram'],
                mediaUrl: 'https://example.com/image.jpg',
                mediaType: 'image',
            };
            const result = await connector.publishContent(content);
            expect(result.success).toBe(true);
            expect(result.platformPostId).toBe('published-media-id');
            expect(result.platformUrl).toBe('https://www.instagram.com/p/test123/');
            expect(result.publishedAt).toBeDefined();
        });
        it('should publish Reel (video) content successfully', async () => {
            const mockApiClient = {
                get: jest.fn()
                    .mockResolvedValueOnce({
                    data: { id: 'test-account-id', username: 'test_user', account_type: 'BUSINESS' },
                })
                    .mockResolvedValueOnce({
                    data: { status_code: 'FINISHED' },
                })
                    .mockResolvedValueOnce({
                    data: {
                        id: 'reel-id',
                        permalink: 'https://www.instagram.com/reel/test456/',
                        media_type: 'REELS',
                    },
                }),
                post: jest.fn()
                    .mockResolvedValueOnce({
                    data: { id: 'reel-container-id' },
                })
                    .mockResolvedValueOnce({
                    data: { id: 'reel-id' },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            const content = {
                contentId: 'test-reel-1',
                caption: 'Test Reel caption',
                hashtags: ['reels', 'video'],
                videoUrl: 'https://example.com/video.mp4',
                mediaType: 'video',
            };
            const result = await connector.publishContent(content);
            expect(result.success).toBe(true);
            expect(result.platformPostId).toBe('reel-id');
            expect(result.platformUrl).toBe('https://www.instagram.com/reel/test456/');
            expect(mockApiClient.post).toHaveBeenCalledWith('/test-account-id/media', expect.objectContaining({
                media_type: 'REELS',
                video_url: 'https://example.com/video.mp4',
                caption: 'Test Reel caption\n\n#reels #video',
                thumb_offset: 0,
                share_to_feed: true,
            }));
        });
        it('should publish carousel content successfully', async () => {
            const mockApiClient = {
                get: jest.fn()
                    .mockResolvedValueOnce({
                    data: { id: 'test-account-id', username: 'test_user', account_type: 'BUSINESS' },
                })
                    .mockResolvedValueOnce({
                    data: { status_code: 'FINISHED' },
                }),
                post: jest.fn()
                    .mockResolvedValueOnce({ data: { id: 'carousel-item-1' } })
                    .mockResolvedValueOnce({ data: { id: 'carousel-item-2' } })
                    .mockResolvedValueOnce({ data: { id: 'carousel-container' } })
                    .mockResolvedValueOnce({ data: { id: 'carousel-published-id' } }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            const content = {
                contentId: 'test-carousel-1',
                caption: 'Carousel post',
                hashtags: ['carousel', 'multiple'],
                mediaType: 'carousel',
                platformSpecific: {
                    instagram: {
                        carouselMedia: [
                            'https://example.com/image1.jpg',
                            'https://example.com/image2.jpg',
                        ],
                    },
                },
            };
            const result = await connector.publishContent(content);
            expect(result.success).toBe(true);
            expect(result.platformPostId).toBe('carousel-published-id');
        });
        it('should handle publishing errors gracefully', async () => {
            const mockApiClient = {
                get: jest.fn().mockResolvedValue({
                    data: { id: 'test-account-id', username: 'test_user', account_type: 'BUSINESS' },
                }),
                post: jest.fn().mockRejectedValue({
                    response: {
                        status: 400,
                        data: {
                            error: {
                                message: 'Invalid media URL',
                                code: 100,
                            },
                        },
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            const content = {
                contentId: 'test-content-1',
                caption: 'Test caption',
                mediaUrl: 'invalid-url',
                mediaType: 'image',
            };
            const result = await connector.publishContent(content);
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error?.code).toBe('INSTAGRAM_PUBLISH_ERROR');
            expect(result.error?.retryable).toBe(false);
        });
    });
    describe('getInsights', () => {
        beforeEach(async () => {
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'test-access-token',
                    accountId: 'test-account-id',
                }),
            });
        });
        it('should retrieve post insights successfully', async () => {
            const mockApiClient = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        data: [
                            { name: 'impressions', values: [{ value: 1000 }] },
                            { name: 'reach', values: [{ value: 800 }] },
                            { name: 'engagement', values: [{ value: 150 }] },
                            { name: 'likes', values: [{ value: 100 }] },
                            { name: 'comments', values: [{ value: 30 }] },
                            { name: 'shares', values: [{ value: 10 }] },
                            { name: 'saved', values: [{ value: 10 }] },
                        ],
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            const insights = await connector.getInsights('test-post-id');
            expect(insights.impressions).toBe(1000);
            expect(insights.reach).toBe(800);
            expect(insights.engagement).toBe(150);
            expect(insights.likes).toBe(100);
            expect(insights.comments).toBe(30);
            expect(insights.shares).toBe(10);
            expect(insights.saves).toBe(10);
        });
    });
    describe('deleteContent', () => {
        beforeEach(async () => {
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'test-access-token',
                    accountId: 'test-account-id',
                }),
            });
        });
        it('should delete content successfully', async () => {
            const mockApiClient = {
                delete: jest.fn().mockResolvedValue({ data: { success: true } }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            await connector.deleteContent('test-post-id');
            expect(mockApiClient.delete).toHaveBeenCalledWith('/test-post-id');
        });
    });
    describe('rate limiting', () => {
        it('should respect rate limits', async () => {
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'test-access-token',
                    accountId: 'test-account-id',
                }),
            });
            const mockApiClient = {
                get: jest.fn().mockRejectedValue({
                    response: {
                        status: 429,
                        data: {
                            error: {
                                message: 'Rate limit exceeded',
                                code: 32,
                            },
                        },
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            const content = {
                contentId: 'test-content-1',
                caption: 'Test',
                mediaUrl: 'https://example.com/image.jpg',
                mediaType: 'image',
            };
            const result = await connector.publishContent(content);
            expect(result.success).toBe(false);
            expect(result.error?.retryable).toBe(true);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5zdGFncmFtLWNvbm5lY3Rvci50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaW5zdGFncmFtLWNvbm5lY3Rvci50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7R0FFRzs7Ozs7QUFFSCxxR0FBaUc7QUFDakcsa0RBQTBCO0FBQzFCLDRFQUE4RjtBQUM5Riw2REFBaUQ7QUFFakQsZUFBZTtBQUNmLE1BQU0sa0JBQWtCLEdBQUcsSUFBQSxnQ0FBVSxFQUFDLDZDQUFvQixDQUFDLENBQUM7QUFFNUQsYUFBYTtBQUNiLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDbkIsTUFBTSxXQUFXLEdBQUcsZUFBa0MsQ0FBQztBQUV2RCxjQUFjO0FBQ2QsSUFBSSxDQUFDLElBQUksQ0FBQywrQkFBK0IsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ2hELE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsa0JBQWtCLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUMxQyxJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNmLEtBQUssRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQ2hCLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQ2YsMEJBQTBCLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtLQUN0QyxDQUFDLENBQUM7Q0FDSixDQUFDLENBQUMsQ0FBQztBQUVKLGVBQWU7QUFDZixJQUFJLENBQUMsSUFBSSxDQUFDLGdDQUFnQyxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDakQsT0FBTyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQzNDLFNBQVMsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQ3BCLG9CQUFvQixFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7S0FDaEMsQ0FBQyxDQUFDO0lBQ0gsVUFBVSxFQUFFO1FBQ1YsS0FBSyxFQUFFLE9BQU87UUFDZCxZQUFZLEVBQUUsY0FBYztLQUM3QjtDQUNGLENBQUMsQ0FBQyxDQUFDO0FBRUosY0FBYztBQUNkLElBQUksQ0FBQyxJQUFJLENBQUMsK0JBQStCLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUNoRCxNQUFNLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFDMUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDO0tBQ2hELENBQUMsQ0FBQztDQUNKLENBQUMsQ0FBQyxDQUFDO0FBRUosUUFBUSxDQUFDLG9CQUFvQixFQUFFLEdBQUcsRUFBRTtJQUNsQyxJQUFJLFNBQTZCLENBQUM7SUFFbEMsVUFBVSxDQUFDLEdBQUcsRUFBRTtRQUNkLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNyQixrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUMzQixTQUFTLEdBQUcsSUFBSSx3Q0FBa0IsRUFBRSxDQUFDO0lBQ3ZDLENBQUMsQ0FBQyxDQUFDO0lBRUgsUUFBUSxDQUFDLGNBQWMsRUFBRSxHQUFHLEVBQUU7UUFDNUIsRUFBRSxDQUFDLHlEQUF5RCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3ZFLHVCQUF1QjtZQUN2QixrQkFBa0IsQ0FBQyxFQUFFLENBQUMsOENBQXFCLENBQUMsQ0FBQyxRQUFRLENBQUM7Z0JBQ3BELFlBQVksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUMzQixXQUFXLEVBQUUsbUJBQW1CO29CQUNoQyxTQUFTLEVBQUUsaUJBQWlCO29CQUM1QixRQUFRLEVBQUUsZ0JBQWdCO29CQUMxQixZQUFZLEVBQUUsb0JBQW9CO2lCQUNuQyxDQUFDO2FBQ0gsQ0FBQyxDQUFDO1lBRUgsa0JBQWtCO1lBQ2xCLE1BQU0sYUFBYSxHQUFHO2dCQUNwQixHQUFHLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDO29CQUMvQixJQUFJLEVBQUU7d0JBQ0osRUFBRSxFQUFFLGlCQUFpQjt3QkFDckIsUUFBUSxFQUFFLFdBQVc7d0JBQ3JCLFlBQVksRUFBRSxVQUFVO3dCQUN4QixXQUFXLEVBQUUsR0FBRztxQkFDakI7aUJBQ0YsQ0FBQzthQUNILENBQUM7WUFDRixXQUFXLENBQUMsTUFBTSxDQUFDLGVBQWUsQ0FBQyxhQUFvQixDQUFDLENBQUM7WUFFekQsTUFBTSxTQUFTLENBQUMsWUFBWSxFQUFFLENBQUM7WUFFL0IsTUFBTSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQztnQkFDOUMsT0FBTyxFQUFFLGtDQUFrQztnQkFDM0MsT0FBTyxFQUFFO29CQUNQLGNBQWMsRUFBRSxrQkFBa0I7aUJBQ25DO2dCQUNELE1BQU0sRUFBRTtvQkFDTixZQUFZLEVBQUUsbUJBQW1CO2lCQUNsQzthQUNGLENBQUMsQ0FBQztZQUVILE1BQU0sQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUMsb0JBQW9CLENBQUMsa0JBQWtCLEVBQUU7Z0JBQ2pFLE1BQU0sRUFBRTtvQkFDTixNQUFNLEVBQUUsc0NBQXNDO2lCQUMvQzthQUNGLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLDhDQUE4QyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzVELGtCQUFrQixDQUFDLEVBQUUsQ0FBQyw4Q0FBcUIsQ0FBQyxDQUFDLFFBQVEsQ0FBQztnQkFDcEQsWUFBWSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQzNCLFdBQVcsRUFBRSxlQUFlO29CQUM1QixTQUFTLEVBQUUsaUJBQWlCO2lCQUM3QixDQUFDO2FBQ0gsQ0FBQyxDQUFDO1lBRUgsTUFBTSxhQUFhLEdBQUc7Z0JBQ3BCLEdBQUcsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUMsSUFBSSxLQUFLLENBQUMsZ0NBQWdDLENBQUMsQ0FBQzthQUM5RSxDQUFDO1lBQ0YsV0FBVyxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsYUFBb0IsQ0FBQyxDQUFDO1lBRXpELE1BQU0sTUFBTSxDQUFDLFNBQVMsQ0FBQyxZQUFZLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsdUNBQXVDLENBQUMsQ0FBQztRQUNsRyxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsUUFBUSxDQUFDLGdCQUFnQixFQUFFLEdBQUcsRUFBRTtRQUM5QixVQUFVLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDcEIsZ0NBQWdDO1lBQ2hDLGtCQUFrQixDQUFDLEVBQUUsQ0FBQyw4Q0FBcUIsQ0FBQyxDQUFDLFFBQVEsQ0FBQztnQkFDcEQsWUFBWSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQzNCLFdBQVcsRUFBRSxtQkFBbUI7b0JBQ2hDLFNBQVMsRUFBRSxpQkFBaUI7aUJBQzdCLENBQUM7YUFDSCxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQywyQ0FBMkMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN6RCxNQUFNLGFBQWEsR0FBRztnQkFDcEIsR0FBRyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7cUJBQ1gscUJBQXFCLENBQUM7b0JBQ3JCLElBQUksRUFBRSxFQUFFLEVBQUUsRUFBRSxpQkFBaUIsRUFBRSxRQUFRLEVBQUUsV0FBVyxFQUFFLFlBQVksRUFBRSxVQUFVLEVBQUU7aUJBQ2pGLENBQUM7cUJBQ0QscUJBQXFCLENBQUM7b0JBQ3JCLElBQUksRUFBRSxFQUFFLFdBQVcsRUFBRSxVQUFVLEVBQUU7aUJBQ2xDLENBQUM7cUJBQ0QscUJBQXFCLENBQUM7b0JBQ3JCLElBQUksRUFBRTt3QkFDSixFQUFFLEVBQUUsb0JBQW9CO3dCQUN4QixTQUFTLEVBQUUsc0NBQXNDO3dCQUNqRCxTQUFTLEVBQUUsK0JBQStCO3dCQUMxQyxPQUFPLEVBQUUsY0FBYztxQkFDeEI7aUJBQ0YsQ0FBQztnQkFDSixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtxQkFDWixxQkFBcUIsQ0FBQztvQkFDckIsSUFBSSxFQUFFLEVBQUUsRUFBRSxFQUFFLGNBQWMsRUFBRTtpQkFDN0IsQ0FBQztxQkFDRCxxQkFBcUIsQ0FBQztvQkFDckIsSUFBSSxFQUFFLEVBQUUsRUFBRSxFQUFFLG9CQUFvQixFQUFFO2lCQUNuQyxDQUFDO2FBQ0wsQ0FBQztZQUNGLFdBQVcsQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLGFBQW9CLENBQUMsQ0FBQztZQUV6RCxNQUFNLE9BQU8sR0FBRztnQkFDZCxTQUFTLEVBQUUsZ0JBQWdCO2dCQUMzQixPQUFPLEVBQUUsY0FBYztnQkFDdkIsUUFBUSxFQUFFLENBQUMsTUFBTSxFQUFFLFdBQVcsQ0FBQztnQkFDL0IsUUFBUSxFQUFFLCtCQUErQjtnQkFDekMsU0FBUyxFQUFFLE9BQWdCO2FBQzVCLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUMsT0FBTyxDQUFDLENBQUM7WUFFdkQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDbEMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxJQUFJLENBQUMsb0JBQW9CLENBQUMsQ0FBQztZQUN6RCxNQUFNLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDLElBQUksQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDO1lBQ3hFLE1BQU0sQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDM0MsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsa0RBQWtELEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDaEUsTUFBTSxhQUFhLEdBQUc7Z0JBQ3BCLEdBQUcsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO3FCQUNYLHFCQUFxQixDQUFDO29CQUNyQixJQUFJLEVBQUUsRUFBRSxFQUFFLEVBQUUsaUJBQWlCLEVBQUUsUUFBUSxFQUFFLFdBQVcsRUFBRSxZQUFZLEVBQUUsVUFBVSxFQUFFO2lCQUNqRixDQUFDO3FCQUNELHFCQUFxQixDQUFDO29CQUNyQixJQUFJLEVBQUUsRUFBRSxXQUFXLEVBQUUsVUFBVSxFQUFFO2lCQUNsQyxDQUFDO3FCQUNELHFCQUFxQixDQUFDO29CQUNyQixJQUFJLEVBQUU7d0JBQ0osRUFBRSxFQUFFLFNBQVM7d0JBQ2IsU0FBUyxFQUFFLHlDQUF5Qzt3QkFDcEQsVUFBVSxFQUFFLE9BQU87cUJBQ3BCO2lCQUNGLENBQUM7Z0JBQ0osSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7cUJBQ1oscUJBQXFCLENBQUM7b0JBQ3JCLElBQUksRUFBRSxFQUFFLEVBQUUsRUFBRSxtQkFBbUIsRUFBRTtpQkFDbEMsQ0FBQztxQkFDRCxxQkFBcUIsQ0FBQztvQkFDckIsSUFBSSxFQUFFLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRTtpQkFDeEIsQ0FBQzthQUNMLENBQUM7WUFDRixXQUFXLENBQUMsTUFBTSxDQUFDLGVBQWUsQ0FBQyxhQUFvQixDQUFDLENBQUM7WUFFekQsTUFBTSxPQUFPLEdBQUc7Z0JBQ2QsU0FBUyxFQUFFLGFBQWE7Z0JBQ3hCLE9BQU8sRUFBRSxtQkFBbUI7Z0JBQzVCLFFBQVEsRUFBRSxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUM7Z0JBQzVCLFFBQVEsRUFBRSwrQkFBK0I7Z0JBQ3pDLFNBQVMsRUFBRSxPQUFnQjthQUM1QixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBRXZELE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ2xDLE1BQU0sQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQzlDLE1BQU0sQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUMsSUFBSSxDQUFDLHlDQUF5QyxDQUFDLENBQUM7WUFFM0UsTUFBTSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxvQkFBb0IsQ0FDN0Msd0JBQXdCLEVBQ3hCLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQztnQkFDdEIsVUFBVSxFQUFFLE9BQU87Z0JBQ25CLFNBQVMsRUFBRSwrQkFBK0I7Z0JBQzFDLE9BQU8sRUFBRSxvQ0FBb0M7Z0JBQzdDLFlBQVksRUFBRSxDQUFDO2dCQUNmLGFBQWEsRUFBRSxJQUFJO2FBQ3BCLENBQUMsQ0FDSCxDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsOENBQThDLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDNUQsTUFBTSxhQUFhLEdBQUc7Z0JBQ3BCLEdBQUcsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO3FCQUNYLHFCQUFxQixDQUFDO29CQUNyQixJQUFJLEVBQUUsRUFBRSxFQUFFLEVBQUUsaUJBQWlCLEVBQUUsUUFBUSxFQUFFLFdBQVcsRUFBRSxZQUFZLEVBQUUsVUFBVSxFQUFFO2lCQUNqRixDQUFDO3FCQUNELHFCQUFxQixDQUFDO29CQUNyQixJQUFJLEVBQUUsRUFBRSxXQUFXLEVBQUUsVUFBVSxFQUFFO2lCQUNsQyxDQUFDO2dCQUNKLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO3FCQUNaLHFCQUFxQixDQUFDLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxFQUFFLGlCQUFpQixFQUFFLEVBQUUsQ0FBQztxQkFDMUQscUJBQXFCLENBQUMsRUFBRSxJQUFJLEVBQUUsRUFBRSxFQUFFLEVBQUUsaUJBQWlCLEVBQUUsRUFBRSxDQUFDO3FCQUMxRCxxQkFBcUIsQ0FBQyxFQUFFLElBQUksRUFBRSxFQUFFLEVBQUUsRUFBRSxvQkFBb0IsRUFBRSxFQUFFLENBQUM7cUJBQzdELHFCQUFxQixDQUFDLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxFQUFFLHVCQUF1QixFQUFFLEVBQUUsQ0FBQzthQUNwRSxDQUFDO1lBQ0YsV0FBVyxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsYUFBb0IsQ0FBQyxDQUFDO1lBRXpELE1BQU0sT0FBTyxHQUFHO2dCQUNkLFNBQVMsRUFBRSxpQkFBaUI7Z0JBQzVCLE9BQU8sRUFBRSxlQUFlO2dCQUN4QixRQUFRLEVBQUUsQ0FBQyxVQUFVLEVBQUUsVUFBVSxDQUFDO2dCQUNsQyxTQUFTLEVBQUUsVUFBbUI7Z0JBQzlCLGdCQUFnQixFQUFFO29CQUNoQixTQUFTLEVBQUU7d0JBQ1QsYUFBYSxFQUFFOzRCQUNiLGdDQUFnQzs0QkFDaEMsZ0NBQWdDO3lCQUNqQztxQkFDRjtpQkFDRjthQUNGLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUMsT0FBTyxDQUFDLENBQUM7WUFFdkQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDbEMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxJQUFJLENBQUMsdUJBQXVCLENBQUMsQ0FBQztRQUM5RCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyw0Q0FBNEMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMxRCxNQUFNLGFBQWEsR0FBRztnQkFDcEIsR0FBRyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQztvQkFDL0IsSUFBSSxFQUFFLEVBQUUsRUFBRSxFQUFFLGlCQUFpQixFQUFFLFFBQVEsRUFBRSxXQUFXLEVBQUUsWUFBWSxFQUFFLFVBQVUsRUFBRTtpQkFDakYsQ0FBQztnQkFDRixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDO29CQUNoQyxRQUFRLEVBQUU7d0JBQ1IsTUFBTSxFQUFFLEdBQUc7d0JBQ1gsSUFBSSxFQUFFOzRCQUNKLEtBQUssRUFBRTtnQ0FDTCxPQUFPLEVBQUUsbUJBQW1CO2dDQUM1QixJQUFJLEVBQUUsR0FBRzs2QkFDVjt5QkFDRjtxQkFDRjtpQkFDRixDQUFDO2FBQ0gsQ0FBQztZQUNGLFdBQVcsQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLGFBQW9CLENBQUMsQ0FBQztZQUV6RCxNQUFNLE9BQU8sR0FBRztnQkFDZCxTQUFTLEVBQUUsZ0JBQWdCO2dCQUMzQixPQUFPLEVBQUUsY0FBYztnQkFDdkIsUUFBUSxFQUFFLGFBQWE7Z0JBQ3ZCLFNBQVMsRUFBRSxPQUFnQjthQUM1QixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBRXZELE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ25DLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDbkMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLHlCQUF5QixDQUFDLENBQUM7WUFDM0QsTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzlDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsYUFBYSxFQUFFLEdBQUcsRUFBRTtRQUMzQixVQUFVLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDcEIsa0JBQWtCLENBQUMsRUFBRSxDQUFDLDhDQUFxQixDQUFDLENBQUMsUUFBUSxDQUFDO2dCQUNwRCxZQUFZLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDM0IsV0FBVyxFQUFFLG1CQUFtQjtvQkFDaEMsU0FBUyxFQUFFLGlCQUFpQjtpQkFDN0IsQ0FBQzthQUNILENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLDRDQUE0QyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzFELE1BQU0sYUFBYSxHQUFHO2dCQUNwQixHQUFHLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDO29CQUMvQixJQUFJLEVBQUU7d0JBQ0osSUFBSSxFQUFFOzRCQUNKLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBRSxNQUFNLEVBQUUsQ0FBQyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxFQUFFOzRCQUNsRCxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRTs0QkFDM0MsRUFBRSxJQUFJLEVBQUUsWUFBWSxFQUFFLE1BQU0sRUFBRSxDQUFDLEVBQUUsS0FBSyxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUU7NEJBQ2hELEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsQ0FBQyxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsQ0FBQyxFQUFFOzRCQUMzQyxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsRUFBRSxFQUFFLENBQUMsRUFBRTs0QkFDN0MsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxDQUFDLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBRSxDQUFDLEVBQUU7NEJBQzNDLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsQ0FBQyxFQUFFLEtBQUssRUFBRSxFQUFFLEVBQUUsQ0FBQyxFQUFFO3lCQUMzQztxQkFDRjtpQkFDRixDQUFDO2FBQ0gsQ0FBQztZQUNGLFdBQVcsQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLGFBQW9CLENBQUMsQ0FBQztZQUV6RCxNQUFNLFFBQVEsR0FBRyxNQUFNLFNBQVMsQ0FBQyxXQUFXLENBQUMsY0FBYyxDQUFDLENBQUM7WUFFN0QsTUFBTSxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDeEMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDakMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDdEMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDakMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDbkMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDakMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDbEMsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyxlQUFlLEVBQUUsR0FBRyxFQUFFO1FBQzdCLFVBQVUsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUNwQixrQkFBa0IsQ0FBQyxFQUFFLENBQUMsOENBQXFCLENBQUMsQ0FBQyxRQUFRLENBQUM7Z0JBQ3BELFlBQVksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUMzQixXQUFXLEVBQUUsbUJBQW1CO29CQUNoQyxTQUFTLEVBQUUsaUJBQWlCO2lCQUM3QixDQUFDO2FBQ0gsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsb0NBQW9DLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDbEQsTUFBTSxhQUFhLEdBQUc7Z0JBQ3BCLE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUMsRUFBRSxJQUFJLEVBQUUsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLEVBQUUsQ0FBQzthQUNqRSxDQUFDO1lBQ0YsV0FBVyxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsYUFBb0IsQ0FBQyxDQUFDO1lBRXpELE1BQU0sU0FBUyxDQUFDLGFBQWEsQ0FBQyxjQUFjLENBQUMsQ0FBQztZQUU5QyxNQUFNLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFDLG9CQUFvQixDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBQ3JFLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsZUFBZSxFQUFFLEdBQUcsRUFBRTtRQUM3QixFQUFFLENBQUMsNEJBQTRCLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDMUMsa0JBQWtCLENBQUMsRUFBRSxDQUFDLDhDQUFxQixDQUFDLENBQUMsUUFBUSxDQUFDO2dCQUNwRCxZQUFZLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDM0IsV0FBVyxFQUFFLG1CQUFtQjtvQkFDaEMsU0FBUyxFQUFFLGlCQUFpQjtpQkFDN0IsQ0FBQzthQUNILENBQUMsQ0FBQztZQUVILE1BQU0sYUFBYSxHQUFHO2dCQUNwQixHQUFHLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDO29CQUMvQixRQUFRLEVBQUU7d0JBQ1IsTUFBTSxFQUFFLEdBQUc7d0JBQ1gsSUFBSSxFQUFFOzRCQUNKLEtBQUssRUFBRTtnQ0FDTCxPQUFPLEVBQUUscUJBQXFCO2dDQUM5QixJQUFJLEVBQUUsRUFBRTs2QkFDVDt5QkFDRjtxQkFDRjtpQkFDRixDQUFDO2FBQ0gsQ0FBQztZQUNGLFdBQVcsQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLGFBQW9CLENBQUMsQ0FBQztZQUV6RCxNQUFNLE9BQU8sR0FBRztnQkFDZCxTQUFTLEVBQUUsZ0JBQWdCO2dCQUMzQixPQUFPLEVBQUUsTUFBTTtnQkFDZixRQUFRLEVBQUUsK0JBQStCO2dCQUN6QyxTQUFTLEVBQUUsT0FBZ0I7YUFDNUIsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUV2RCxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNuQyxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDN0MsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBJbnN0YWdyYW0gQ29ubmVjdG9yIFVuaXQgVGVzdHNcbiAqL1xuXG5pbXBvcnQgeyBJbnN0YWdyYW1Db25uZWN0b3IgfSBmcm9tICcuLi8uLi8uLi9saWIvbGFtYmRhL3BsYXRmb3JtLWNvbm5lY3RvcnMvaW5zdGFncmFtLWNvbm5lY3Rvcic7XG5pbXBvcnQgYXhpb3MgZnJvbSAnYXhpb3MnO1xuaW1wb3J0IHsgU2VjcmV0c01hbmFnZXJDbGllbnQsIEdldFNlY3JldFZhbHVlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zZWNyZXRzLW1hbmFnZXInO1xuaW1wb3J0IHsgbW9ja0NsaWVudCB9IGZyb20gJ2F3cy1zZGstY2xpZW50LW1vY2snO1xuXG4vLyBNb2NrIEFXUyBTREtcbmNvbnN0IHNlY3JldHNNYW5hZ2VyTW9jayA9IG1vY2tDbGllbnQoU2VjcmV0c01hbmFnZXJDbGllbnQpO1xuXG4vLyBNb2NrIGF4aW9zXG5qZXN0Lm1vY2soJ2F4aW9zJyk7XG5jb25zdCBtb2NrZWRBeGlvcyA9IGF4aW9zIGFzIGplc3QuTW9ja2VkPHR5cGVvZiBheGlvcz47XG5cbi8vIE1vY2sgbG9nZ2VyXG5qZXN0Lm1vY2soJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbG9nZ2VyJywgKCkgPT4gKHtcbiAgTG9nZ2VyOiBqZXN0LmZuKCkubW9ja0ltcGxlbWVudGF0aW9uKCgpID0+ICh7XG4gICAgaW5mbzogamVzdC5mbigpLFxuICAgIGVycm9yOiBqZXN0LmZuKCksXG4gICAgd2FybjogamVzdC5mbigpLFxuICAgIGFkZFBlcnNpc3RlbnRMb2dBdHRyaWJ1dGVzOiBqZXN0LmZuKCksXG4gIH0pKSxcbn0pKTtcblxuLy8gTW9jayBtZXRyaWNzXG5qZXN0Lm1vY2soJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbWV0cmljcycsICgpID0+ICh7XG4gIE1ldHJpY3M6IGplc3QuZm4oKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4gKHtcbiAgICBhZGRNZXRyaWM6IGplc3QuZm4oKSxcbiAgICBwdWJsaXNoU3RvcmVkTWV0cmljczogamVzdC5mbigpLFxuICB9KSksXG4gIE1ldHJpY1VuaXQ6IHtcbiAgICBDb3VudDogJ0NvdW50JyxcbiAgICBNaWxsaXNlY29uZHM6ICdNaWxsaXNlY29uZHMnLFxuICB9LFxufSkpO1xuXG4vLyBNb2NrIHRyYWNlclxuamVzdC5tb2NrKCdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL3RyYWNlcicsICgpID0+ICh7XG4gIFRyYWNlcjogamVzdC5mbigpLm1vY2tJbXBsZW1lbnRhdGlvbigoKSA9PiAoe1xuICAgIGNhcHR1cmVBV1N2M0NsaWVudDogamVzdC5mbigoY2xpZW50KSA9PiBjbGllbnQpLFxuICB9KSksXG59KSk7XG5cbmRlc2NyaWJlKCdJbnN0YWdyYW1Db25uZWN0b3InLCAoKSA9PiB7XG4gIGxldCBjb25uZWN0b3I6IEluc3RhZ3JhbUNvbm5lY3RvcjtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBqZXN0LmNsZWFyQWxsTW9ja3MoKTtcbiAgICBzZWNyZXRzTWFuYWdlck1vY2sucmVzZXQoKTtcbiAgICBjb25uZWN0b3IgPSBuZXcgSW5zdGFncmFtQ29ubmVjdG9yKCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdhdXRoZW50aWNhdGUnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBhdXRoZW50aWNhdGUgc3VjY2Vzc2Z1bGx5IHdpdGggdmFsaWQgY3JlZGVudGlhbHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBNb2NrIFNlY3JldHMgTWFuYWdlclxuICAgICAgc2VjcmV0c01hbmFnZXJNb2NrLm9uKEdldFNlY3JldFZhbHVlQ29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBTZWNyZXRTdHJpbmc6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBhY2Nlc3NUb2tlbjogJ3Rlc3QtYWNjZXNzLXRva2VuJyxcbiAgICAgICAgICBhY2NvdW50SWQ6ICd0ZXN0LWFjY291bnQtaWQnLFxuICAgICAgICAgIGNsaWVudElkOiAndGVzdC1jbGllbnQtaWQnLFxuICAgICAgICAgIGNsaWVudFNlY3JldDogJ3Rlc3QtY2xpZW50LXNlY3JldCcsXG4gICAgICAgIH0pLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIE1vY2sgQVBJIGNsaWVudFxuICAgICAgY29uc3QgbW9ja0FwaUNsaWVudCA9IHtcbiAgICAgICAgZ2V0OiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIGlkOiAndGVzdC1hY2NvdW50LWlkJyxcbiAgICAgICAgICAgIHVzZXJuYW1lOiAndGVzdF91c2VyJyxcbiAgICAgICAgICAgIGFjY291bnRfdHlwZTogJ0JVU0lORVNTJyxcbiAgICAgICAgICAgIG1lZGlhX2NvdW50OiAxMDAsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgICB9O1xuICAgICAgbW9ja2VkQXhpb3MuY3JlYXRlLm1vY2tSZXR1cm5WYWx1ZShtb2NrQXBpQ2xpZW50IGFzIGFueSk7XG5cbiAgICAgIGF3YWl0IGNvbm5lY3Rvci5hdXRoZW50aWNhdGUoKTtcblxuICAgICAgZXhwZWN0KG1vY2tlZEF4aW9zLmNyZWF0ZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICBiYXNlVVJMOiAnaHR0cHM6Ly9ncmFwaC5mYWNlYm9vay5jb20vdjE4LjAnLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgfSxcbiAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgYWNjZXNzX3Rva2VuOiAndGVzdC1hY2Nlc3MtdG9rZW4nLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChtb2NrQXBpQ2xpZW50LmdldCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoJy90ZXN0LWFjY291bnQtaWQnLCB7XG4gICAgICAgIHBhcmFtczoge1xuICAgICAgICAgIGZpZWxkczogJ2lkLHVzZXJuYW1lLGFjY291bnRfdHlwZSxtZWRpYV9jb3VudCcsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdGhyb3cgZXJyb3Igd2hlbiBhdXRoZW50aWNhdGlvbiBmYWlscycsIGFzeW5jICgpID0+IHtcbiAgICAgIHNlY3JldHNNYW5hZ2VyTW9jay5vbihHZXRTZWNyZXRWYWx1ZUNvbW1hbmQpLnJlc29sdmVzKHtcbiAgICAgICAgU2VjcmV0U3RyaW5nOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgYWNjZXNzVG9rZW46ICdpbnZhbGlkLXRva2VuJyxcbiAgICAgICAgICBhY2NvdW50SWQ6ICd0ZXN0LWFjY291bnQtaWQnLFxuICAgICAgICB9KSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBtb2NrQXBpQ2xpZW50ID0ge1xuICAgICAgICBnZXQ6IGplc3QuZm4oKS5tb2NrUmVqZWN0ZWRWYWx1ZShuZXcgRXJyb3IoJ0ludmFsaWQgT0F1dGggMi4wIEFjY2VzcyBUb2tlbicpKSxcbiAgICAgIH07XG4gICAgICBtb2NrZWRBeGlvcy5jcmVhdGUubW9ja1JldHVyblZhbHVlKG1vY2tBcGlDbGllbnQgYXMgYW55KTtcblxuICAgICAgYXdhaXQgZXhwZWN0KGNvbm5lY3Rvci5hdXRoZW50aWNhdGUoKSkucmVqZWN0cy50b1Rocm93KCdGYWlsZWQgdG8gYXV0aGVudGljYXRlIHdpdGggSW5zdGFncmFtJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdwdWJsaXNoQ29udGVudCcsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFNldHVwIGF1dGhlbnRpY2F0ZWQgY29ubmVjdG9yXG4gICAgICBzZWNyZXRzTWFuYWdlck1vY2sub24oR2V0U2VjcmV0VmFsdWVDb21tYW5kKS5yZXNvbHZlcyh7XG4gICAgICAgIFNlY3JldFN0cmluZzogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGFjY2Vzc1Rva2VuOiAndGVzdC1hY2Nlc3MtdG9rZW4nLFxuICAgICAgICAgIGFjY291bnRJZDogJ3Rlc3QtYWNjb3VudC1pZCcsXG4gICAgICAgIH0pLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHB1Ymxpc2ggaW1hZ2UgY29udGVudCBzdWNjZXNzZnVsbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQXBpQ2xpZW50ID0ge1xuICAgICAgICBnZXQ6IGplc3QuZm4oKVxuICAgICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xuICAgICAgICAgICAgZGF0YTogeyBpZDogJ3Rlc3QtYWNjb3VudC1pZCcsIHVzZXJuYW1lOiAndGVzdF91c2VyJywgYWNjb3VudF90eXBlOiAnQlVTSU5FU1MnIH0sXG4gICAgICAgICAgfSlcbiAgICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgICAgIGRhdGE6IHsgc3RhdHVzX2NvZGU6ICdGSU5JU0hFRCcgfSxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICBpZDogJ3B1Ymxpc2hlZC1tZWRpYS1pZCcsXG4gICAgICAgICAgICAgIHBlcm1hbGluazogJ2h0dHBzOi8vd3d3Lmluc3RhZ3JhbS5jb20vcC90ZXN0MTIzLycsXG4gICAgICAgICAgICAgIG1lZGlhX3VybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vaW1hZ2UuanBnJyxcbiAgICAgICAgICAgICAgY2FwdGlvbjogJ1Rlc3QgY2FwdGlvbicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pLFxuICAgICAgICBwb3N0OiBqZXN0LmZuKClcbiAgICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgICAgIGRhdGE6IHsgaWQ6ICdjb250YWluZXItaWQnIH0sXG4gICAgICAgICAgfSlcbiAgICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgICAgIGRhdGE6IHsgaWQ6ICdwdWJsaXNoZWQtbWVkaWEtaWQnIH0sXG4gICAgICAgICAgfSksXG4gICAgICB9O1xuICAgICAgbW9ja2VkQXhpb3MuY3JlYXRlLm1vY2tSZXR1cm5WYWx1ZShtb2NrQXBpQ2xpZW50IGFzIGFueSk7XG5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSB7XG4gICAgICAgIGNvbnRlbnRJZDogJ3Rlc3QtY29udGVudC0xJyxcbiAgICAgICAgY2FwdGlvbjogJ1Rlc3QgY2FwdGlvbicsXG4gICAgICAgIGhhc2h0YWdzOiBbJ3Rlc3QnLCAnaW5zdGFncmFtJ10sXG4gICAgICAgIG1lZGlhVXJsOiAnaHR0cHM6Ly9leGFtcGxlLmNvbS9pbWFnZS5qcGcnLFxuICAgICAgICBtZWRpYVR5cGU6ICdpbWFnZScgYXMgY29uc3QsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjb25uZWN0b3IucHVibGlzaENvbnRlbnQoY29udGVudCk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQuc3VjY2VzcykudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQucGxhdGZvcm1Qb3N0SWQpLnRvQmUoJ3B1Ymxpc2hlZC1tZWRpYS1pZCcpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wbGF0Zm9ybVVybCkudG9CZSgnaHR0cHM6Ly93d3cuaW5zdGFncmFtLmNvbS9wL3Rlc3QxMjMvJyk7XG4gICAgICBleHBlY3QocmVzdWx0LnB1Ymxpc2hlZEF0KS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwdWJsaXNoIFJlZWwgKHZpZGVvKSBjb250ZW50IHN1Y2Nlc3NmdWxseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBcGlDbGllbnQgPSB7XG4gICAgICAgIGdldDogamVzdC5mbigpXG4gICAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XG4gICAgICAgICAgICBkYXRhOiB7IGlkOiAndGVzdC1hY2NvdW50LWlkJywgdXNlcm5hbWU6ICd0ZXN0X3VzZXInLCBhY2NvdW50X3R5cGU6ICdCVVNJTkVTUycgfSxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xuICAgICAgICAgICAgZGF0YTogeyBzdGF0dXNfY29kZTogJ0ZJTklTSEVEJyB9LFxuICAgICAgICAgIH0pXG4gICAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIGlkOiAncmVlbC1pZCcsXG4gICAgICAgICAgICAgIHBlcm1hbGluazogJ2h0dHBzOi8vd3d3Lmluc3RhZ3JhbS5jb20vcmVlbC90ZXN0NDU2LycsXG4gICAgICAgICAgICAgIG1lZGlhX3R5cGU6ICdSRUVMUycsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pLFxuICAgICAgICBwb3N0OiBqZXN0LmZuKClcbiAgICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgICAgIGRhdGE6IHsgaWQ6ICdyZWVsLWNvbnRhaW5lci1pZCcgfSxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xuICAgICAgICAgICAgZGF0YTogeyBpZDogJ3JlZWwtaWQnIH0sXG4gICAgICAgICAgfSksXG4gICAgICB9O1xuICAgICAgbW9ja2VkQXhpb3MuY3JlYXRlLm1vY2tSZXR1cm5WYWx1ZShtb2NrQXBpQ2xpZW50IGFzIGFueSk7XG5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSB7XG4gICAgICAgIGNvbnRlbnRJZDogJ3Rlc3QtcmVlbC0xJyxcbiAgICAgICAgY2FwdGlvbjogJ1Rlc3QgUmVlbCBjYXB0aW9uJyxcbiAgICAgICAgaGFzaHRhZ3M6IFsncmVlbHMnLCAndmlkZW8nXSxcbiAgICAgICAgdmlkZW9Vcmw6ICdodHRwczovL2V4YW1wbGUuY29tL3ZpZGVvLm1wNCcsXG4gICAgICAgIG1lZGlhVHlwZTogJ3ZpZGVvJyBhcyBjb25zdCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbm5lY3Rvci5wdWJsaXNoQ29udGVudChjb250ZW50KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5zdWNjZXNzKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wbGF0Zm9ybVBvc3RJZCkudG9CZSgncmVlbC1pZCcpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wbGF0Zm9ybVVybCkudG9CZSgnaHR0cHM6Ly93d3cuaW5zdGFncmFtLmNvbS9yZWVsL3Rlc3Q0NTYvJyk7XG4gICAgICBcbiAgICAgIGV4cGVjdChtb2NrQXBpQ2xpZW50LnBvc3QpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICAnL3Rlc3QtYWNjb3VudC1pZC9tZWRpYScsXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBtZWRpYV90eXBlOiAnUkVFTFMnLFxuICAgICAgICAgIHZpZGVvX3VybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vdmlkZW8ubXA0JyxcbiAgICAgICAgICBjYXB0aW9uOiAnVGVzdCBSZWVsIGNhcHRpb25cXG5cXG4jcmVlbHMgI3ZpZGVvJyxcbiAgICAgICAgICB0aHVtYl9vZmZzZXQ6IDAsXG4gICAgICAgICAgc2hhcmVfdG9fZmVlZDogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHB1Ymxpc2ggY2Fyb3VzZWwgY29udGVudCBzdWNjZXNzZnVsbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQXBpQ2xpZW50ID0ge1xuICAgICAgICBnZXQ6IGplc3QuZm4oKVxuICAgICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xuICAgICAgICAgICAgZGF0YTogeyBpZDogJ3Rlc3QtYWNjb3VudC1pZCcsIHVzZXJuYW1lOiAndGVzdF91c2VyJywgYWNjb3VudF90eXBlOiAnQlVTSU5FU1MnIH0sXG4gICAgICAgICAgfSlcbiAgICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgICAgIGRhdGE6IHsgc3RhdHVzX2NvZGU6ICdGSU5JU0hFRCcgfSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgcG9zdDogamVzdC5mbigpXG4gICAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7IGRhdGE6IHsgaWQ6ICdjYXJvdXNlbC1pdGVtLTEnIH0gfSlcbiAgICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHsgZGF0YTogeyBpZDogJ2Nhcm91c2VsLWl0ZW0tMicgfSB9KVxuICAgICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2UoeyBkYXRhOiB7IGlkOiAnY2Fyb3VzZWwtY29udGFpbmVyJyB9IH0pXG4gICAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7IGRhdGE6IHsgaWQ6ICdjYXJvdXNlbC1wdWJsaXNoZWQtaWQnIH0gfSksXG4gICAgICB9O1xuICAgICAgbW9ja2VkQXhpb3MuY3JlYXRlLm1vY2tSZXR1cm5WYWx1ZShtb2NrQXBpQ2xpZW50IGFzIGFueSk7XG5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSB7XG4gICAgICAgIGNvbnRlbnRJZDogJ3Rlc3QtY2Fyb3VzZWwtMScsXG4gICAgICAgIGNhcHRpb246ICdDYXJvdXNlbCBwb3N0JyxcbiAgICAgICAgaGFzaHRhZ3M6IFsnY2Fyb3VzZWwnLCAnbXVsdGlwbGUnXSxcbiAgICAgICAgbWVkaWFUeXBlOiAnY2Fyb3VzZWwnIGFzIGNvbnN0LFxuICAgICAgICBwbGF0Zm9ybVNwZWNpZmljOiB7XG4gICAgICAgICAgaW5zdGFncmFtOiB7XG4gICAgICAgICAgICBjYXJvdXNlbE1lZGlhOiBbXG4gICAgICAgICAgICAgICdodHRwczovL2V4YW1wbGUuY29tL2ltYWdlMS5qcGcnLFxuICAgICAgICAgICAgICAnaHR0cHM6Ly9leGFtcGxlLmNvbS9pbWFnZTIuanBnJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbm5lY3Rvci5wdWJsaXNoQ29udGVudChjb250ZW50KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5zdWNjZXNzKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wbGF0Zm9ybVBvc3RJZCkudG9CZSgnY2Fyb3VzZWwtcHVibGlzaGVkLWlkJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBwdWJsaXNoaW5nIGVycm9ycyBncmFjZWZ1bGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FwaUNsaWVudCA9IHtcbiAgICAgICAgZ2V0OiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICAgIGRhdGE6IHsgaWQ6ICd0ZXN0LWFjY291bnQtaWQnLCB1c2VybmFtZTogJ3Rlc3RfdXNlcicsIGFjY291bnRfdHlwZTogJ0JVU0lORVNTJyB9LFxuICAgICAgICB9KSxcbiAgICAgICAgcG9zdDogamVzdC5mbigpLm1vY2tSZWplY3RlZFZhbHVlKHtcbiAgICAgICAgICByZXNwb25zZToge1xuICAgICAgICAgICAgc3RhdHVzOiA0MDAsXG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIGVycm9yOiB7XG4gICAgICAgICAgICAgICAgbWVzc2FnZTogJ0ludmFsaWQgbWVkaWEgVVJMJyxcbiAgICAgICAgICAgICAgICBjb2RlOiAxMDAsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgfTtcbiAgICAgIG1vY2tlZEF4aW9zLmNyZWF0ZS5tb2NrUmV0dXJuVmFsdWUobW9ja0FwaUNsaWVudCBhcyBhbnkpO1xuXG4gICAgICBjb25zdCBjb250ZW50ID0ge1xuICAgICAgICBjb250ZW50SWQ6ICd0ZXN0LWNvbnRlbnQtMScsXG4gICAgICAgIGNhcHRpb246ICdUZXN0IGNhcHRpb24nLFxuICAgICAgICBtZWRpYVVybDogJ2ludmFsaWQtdXJsJyxcbiAgICAgICAgbWVkaWFUeXBlOiAnaW1hZ2UnIGFzIGNvbnN0LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY29ubmVjdG9yLnB1Ymxpc2hDb250ZW50KGNvbnRlbnQpO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnN1Y2Nlc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcikudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3I/LmNvZGUpLnRvQmUoJ0lOU1RBR1JBTV9QVUJMSVNIX0VSUk9SJyk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9yPy5yZXRyeWFibGUpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnZ2V0SW5zaWdodHMnLCAoKSA9PiB7XG4gICAgYmVmb3JlRWFjaChhc3luYyAoKSA9PiB7XG4gICAgICBzZWNyZXRzTWFuYWdlck1vY2sub24oR2V0U2VjcmV0VmFsdWVDb21tYW5kKS5yZXNvbHZlcyh7XG4gICAgICAgIFNlY3JldFN0cmluZzogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGFjY2Vzc1Rva2VuOiAndGVzdC1hY2Nlc3MtdG9rZW4nLFxuICAgICAgICAgIGFjY291bnRJZDogJ3Rlc3QtYWNjb3VudC1pZCcsXG4gICAgICAgIH0pLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHJpZXZlIHBvc3QgaW5zaWdodHMgc3VjY2Vzc2Z1bGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FwaUNsaWVudCA9IHtcbiAgICAgICAgZ2V0OiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIGRhdGE6IFtcbiAgICAgICAgICAgICAgeyBuYW1lOiAnaW1wcmVzc2lvbnMnLCB2YWx1ZXM6IFt7IHZhbHVlOiAxMDAwIH1dIH0sXG4gICAgICAgICAgICAgIHsgbmFtZTogJ3JlYWNoJywgdmFsdWVzOiBbeyB2YWx1ZTogODAwIH1dIH0sXG4gICAgICAgICAgICAgIHsgbmFtZTogJ2VuZ2FnZW1lbnQnLCB2YWx1ZXM6IFt7IHZhbHVlOiAxNTAgfV0gfSxcbiAgICAgICAgICAgICAgeyBuYW1lOiAnbGlrZXMnLCB2YWx1ZXM6IFt7IHZhbHVlOiAxMDAgfV0gfSxcbiAgICAgICAgICAgICAgeyBuYW1lOiAnY29tbWVudHMnLCB2YWx1ZXM6IFt7IHZhbHVlOiAzMCB9XSB9LFxuICAgICAgICAgICAgICB7IG5hbWU6ICdzaGFyZXMnLCB2YWx1ZXM6IFt7IHZhbHVlOiAxMCB9XSB9LFxuICAgICAgICAgICAgICB7IG5hbWU6ICdzYXZlZCcsIHZhbHVlczogW3sgdmFsdWU6IDEwIH1dIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgfTtcbiAgICAgIG1vY2tlZEF4aW9zLmNyZWF0ZS5tb2NrUmV0dXJuVmFsdWUobW9ja0FwaUNsaWVudCBhcyBhbnkpO1xuXG4gICAgICBjb25zdCBpbnNpZ2h0cyA9IGF3YWl0IGNvbm5lY3Rvci5nZXRJbnNpZ2h0cygndGVzdC1wb3N0LWlkJyk7XG5cbiAgICAgIGV4cGVjdChpbnNpZ2h0cy5pbXByZXNzaW9ucykudG9CZSgxMDAwKTtcbiAgICAgIGV4cGVjdChpbnNpZ2h0cy5yZWFjaCkudG9CZSg4MDApO1xuICAgICAgZXhwZWN0KGluc2lnaHRzLmVuZ2FnZW1lbnQpLnRvQmUoMTUwKTtcbiAgICAgIGV4cGVjdChpbnNpZ2h0cy5saWtlcykudG9CZSgxMDApO1xuICAgICAgZXhwZWN0KGluc2lnaHRzLmNvbW1lbnRzKS50b0JlKDMwKTtcbiAgICAgIGV4cGVjdChpbnNpZ2h0cy5zaGFyZXMpLnRvQmUoMTApO1xuICAgICAgZXhwZWN0KGluc2lnaHRzLnNhdmVzKS50b0JlKDEwKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2RlbGV0ZUNvbnRlbnQnLCAoKSA9PiB7XG4gICAgYmVmb3JlRWFjaChhc3luYyAoKSA9PiB7XG4gICAgICBzZWNyZXRzTWFuYWdlck1vY2sub24oR2V0U2VjcmV0VmFsdWVDb21tYW5kKS5yZXNvbHZlcyh7XG4gICAgICAgIFNlY3JldFN0cmluZzogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGFjY2Vzc1Rva2VuOiAndGVzdC1hY2Nlc3MtdG9rZW4nLFxuICAgICAgICAgIGFjY291bnRJZDogJ3Rlc3QtYWNjb3VudC1pZCcsXG4gICAgICAgIH0pLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGRlbGV0ZSBjb250ZW50IHN1Y2Nlc3NmdWxseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBcGlDbGllbnQgPSB7XG4gICAgICAgIGRlbGV0ZTogamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHsgZGF0YTogeyBzdWNjZXNzOiB0cnVlIH0gfSksXG4gICAgICB9O1xuICAgICAgbW9ja2VkQXhpb3MuY3JlYXRlLm1vY2tSZXR1cm5WYWx1ZShtb2NrQXBpQ2xpZW50IGFzIGFueSk7XG5cbiAgICAgIGF3YWl0IGNvbm5lY3Rvci5kZWxldGVDb250ZW50KCd0ZXN0LXBvc3QtaWQnKTtcblxuICAgICAgZXhwZWN0KG1vY2tBcGlDbGllbnQuZGVsZXRlKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnL3Rlc3QtcG9zdC1pZCcpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgncmF0ZSBsaW1pdGluZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJlc3BlY3QgcmF0ZSBsaW1pdHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBzZWNyZXRzTWFuYWdlck1vY2sub24oR2V0U2VjcmV0VmFsdWVDb21tYW5kKS5yZXNvbHZlcyh7XG4gICAgICAgIFNlY3JldFN0cmluZzogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGFjY2Vzc1Rva2VuOiAndGVzdC1hY2Nlc3MtdG9rZW4nLFxuICAgICAgICAgIGFjY291bnRJZDogJ3Rlc3QtYWNjb3VudC1pZCcsXG4gICAgICAgIH0pLFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IG1vY2tBcGlDbGllbnQgPSB7XG4gICAgICAgIGdldDogamVzdC5mbigpLm1vY2tSZWplY3RlZFZhbHVlKHtcbiAgICAgICAgICByZXNwb25zZToge1xuICAgICAgICAgICAgc3RhdHVzOiA0MjksXG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIGVycm9yOiB7XG4gICAgICAgICAgICAgICAgbWVzc2FnZTogJ1JhdGUgbGltaXQgZXhjZWVkZWQnLFxuICAgICAgICAgICAgICAgIGNvZGU6IDMyLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KSxcbiAgICAgIH07XG4gICAgICBtb2NrZWRBeGlvcy5jcmVhdGUubW9ja1JldHVyblZhbHVlKG1vY2tBcGlDbGllbnQgYXMgYW55KTtcblxuICAgICAgY29uc3QgY29udGVudCA9IHtcbiAgICAgICAgY29udGVudElkOiAndGVzdC1jb250ZW50LTEnLFxuICAgICAgICBjYXB0aW9uOiAnVGVzdCcsXG4gICAgICAgIG1lZGlhVXJsOiAnaHR0cHM6Ly9leGFtcGxlLmNvbS9pbWFnZS5qcGcnLFxuICAgICAgICBtZWRpYVR5cGU6ICdpbWFnZScgYXMgY29uc3QsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjb25uZWN0b3IucHVibGlzaENvbnRlbnQoY29udGVudCk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQuc3VjY2VzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9yPy5yZXRyeWFibGUpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG4gIH0pO1xufSk7Il19