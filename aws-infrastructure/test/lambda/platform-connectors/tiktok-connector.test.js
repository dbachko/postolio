"use strict";
/**
 * TikTok Connector Unit Tests
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const tiktok_connector_1 = require("../../../lib/lambda/platform-connectors/tiktok-connector");
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
describe('TikTokConnector', () => {
    let connector;
    beforeEach(() => {
        jest.clearAllMocks();
        secretsManagerMock.reset();
        connector = new tiktok_connector_1.TikTokConnector();
    });
    describe('authenticate', () => {
        it('should authenticate successfully with valid credentials', async () => {
            // Mock Secrets Manager
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'test-access-token',
                    clientId: 'test-client-id',
                    clientSecret: 'test-client-secret',
                }),
            });
            // Mock API client
            const mockApiClient = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        data: {
                            user: {
                                open_id: 'test-open-id',
                                display_name: 'Test User',
                                follower_count: 10000,
                            },
                        },
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            await connector.authenticate();
            expect(mockedAxios.create).toHaveBeenCalledWith({
                baseURL: 'https://open.tiktokapis.com/v2',
                headers: {
                    'Authorization': 'Bearer test-access-token',
                    'Content-Type': 'application/json',
                },
            });
            expect(mockApiClient.get).toHaveBeenCalledWith('/user/info/', {
                params: {
                    fields: 'open_id,union_id,display_name,follower_count',
                },
            });
        });
        it('should throw error when authentication fails', async () => {
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'invalid-token',
                }),
            });
            const mockApiClient = {
                get: jest.fn().mockRejectedValue(new Error('Invalid access token')),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            await expect(connector.authenticate()).rejects.toThrow('Failed to authenticate with TikTok');
        });
    });
    describe('publishContent', () => {
        beforeEach(async () => {
            // Setup authenticated connector
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'test-access-token',
                    clientId: 'test-client-id',
                    clientSecret: 'test-client-secret',
                }),
            });
            const mockApiClient = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        data: {
                            user: {
                                open_id: 'test-open-id',
                                display_name: 'Test User',
                                follower_count: 10000,
                            },
                        },
                    },
                }),
                post: jest.fn(),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
        });
        it('should publish video content successfully', async () => {
            const mockApiClient = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        data: {
                            user: {
                                open_id: 'test-open-id',
                                display_name: 'Test User',
                            },
                        },
                    },
                }),
                post: jest.fn()
                    .mockResolvedValueOnce({
                    data: {
                        data: {
                            upload_url: 'https://upload.tiktok.com/video/upload',
                            upload_id: 'upload-123',
                        },
                    },
                })
                    .mockResolvedValueOnce({
                    data: {
                        data: {
                            post_id: 'tiktok-post-123',
                            share_url: 'https://www.tiktok.com/@testuser/video/123456',
                        },
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            // Mock video download and upload
            mockedAxios.get.mockResolvedValue({
                data: Buffer.from('video-content'),
            });
            mockedAxios.put.mockResolvedValue({ data: { success: true } });
            const content = {
                contentId: 'test-video-1',
                caption: 'Test TikTok video',
                hashtags: ['tiktok', 'test'],
                videoUrl: 'https://example.com/video.mp4',
                mediaType: 'video',
            };
            const result = await connector.publishContent(content);
            expect(result.success).toBe(true);
            expect(result.platformPostId).toBe('tiktok-post-123');
            expect(result.platformUrl).toBe('https://www.tiktok.com/@testuser/video/123456');
            expect(result.publishedAt).toBeDefined();
            // Verify video upload initialization
            expect(mockApiClient.post).toHaveBeenCalledWith('/video/init/', expect.objectContaining({
                source_info: expect.objectContaining({
                    source: 'FILE_UPLOAD',
                    video_size: 10000000,
                    chunk_size: 5242880,
                }),
            }));
            // Verify video publish
            expect(mockApiClient.post).toHaveBeenCalledWith('/video/publish/', expect.objectContaining({
                upload_id: 'upload-123',
                post_info: expect.objectContaining({
                    title: expect.stringContaining('Test TikTok video'),
                    description: expect.stringContaining('#tiktok #test'),
                    privacy_level: 'PUBLIC',
                }),
            }));
        });
        it('should reject non-video content', async () => {
            const content = {
                contentId: 'test-image-1',
                caption: 'Test image',
                mediaUrl: 'https://example.com/image.jpg',
                mediaType: 'image',
            };
            const result = await connector.publishContent(content);
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('TikTok only supports video content');
        });
        it('should handle video with music', async () => {
            const mockApiClient = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        data: {
                            user: {
                                open_id: 'test-open-id',
                                display_name: 'Test User',
                            },
                        },
                    },
                }),
                post: jest.fn()
                    .mockResolvedValueOnce({
                    data: {
                        data: {
                            upload_url: 'https://upload.tiktok.com/video/upload',
                            upload_id: 'upload-456',
                        },
                    },
                })
                    .mockResolvedValueOnce({
                    data: {
                        data: {
                            post_id: 'tiktok-music-post',
                            share_url: 'https://www.tiktok.com/@testuser/video/789',
                        },
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            mockedAxios.get.mockResolvedValue({
                data: Buffer.from('video-content'),
            });
            mockedAxios.put.mockResolvedValue({ data: { success: true } });
            const content = {
                contentId: 'test-video-2',
                caption: 'Video with music',
                hashtags: ['music', 'dance'],
                videoUrl: 'https://example.com/video.mp4',
                mediaType: 'video',
                platformSpecific: {
                    tiktok: {
                        musicId: 'music-track-123',
                        videoSize: 5000000,
                    },
                },
            };
            const result = await connector.publishContent(content);
            expect(result.success).toBe(true);
            // Verify music ID was included
            expect(mockApiClient.post).toHaveBeenCalledWith('/video/publish/', expect.objectContaining({
                upload_id: 'upload-456',
                post_info: expect.objectContaining({
                    music_id: 'music-track-123',
                }),
            }));
        });
        it('should handle publishing errors gracefully', async () => {
            const mockApiClient = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        data: {
                            user: {
                                open_id: 'test-open-id',
                                display_name: 'Test User',
                            },
                        },
                    },
                }),
                post: jest.fn().mockResolvedValue({
                    data: {
                        error: {
                            code: 'invalid_video',
                            message: 'Video format not supported',
                        },
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            const content = {
                contentId: 'test-video-1',
                caption: 'Test video',
                videoUrl: 'https://example.com/video.mp4',
                mediaType: 'video',
            };
            const result = await connector.publishContent(content);
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error?.code).toBe('TIKTOK_PUBLISH_ERROR');
        });
    });
    describe('getInsights', () => {
        beforeEach(async () => {
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'test-access-token',
                }),
            });
        });
        it('should retrieve video insights successfully', async () => {
            const mockApiClient = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        data: {
                            videos: [{
                                    video_id: 'test-video-id',
                                    metrics: {
                                        view_count: 5000,
                                        like_count: 500,
                                        comment_count: 50,
                                        share_count: 25,
                                        save_count: 100,
                                        completion_rate: 0.75,
                                    },
                                }],
                        },
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            const insights = await connector.getInsights('test-video-id');
            expect(insights.views).toBe(5000);
            expect(insights.likes).toBe(500);
            expect(insights.comments).toBe(50);
            expect(insights.shares).toBe(25);
            expect(insights.saves).toBe(100);
            expect(insights.completionRate).toBe(0.75);
            expect(insights.engagement).toBe(675); // sum of likes, comments, shares, saves
        });
    });
    describe('deleteContent', () => {
        beforeEach(async () => {
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'test-access-token',
                }),
            });
        });
        it('should indicate that deletion is not supported', async () => {
            const mockApiClient = {
                get: jest.fn(),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            await expect(connector.deleteContent('test-post-id')).rejects.toThrow('TikTok API does not support content deletion');
        });
    });
    describe('token refresh', () => {
        it('should refresh access token when expired', async () => {
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'expired-token',
                    refreshToken: 'refresh-token',
                    clientId: 'test-client-id',
                    clientSecret: 'test-client-secret',
                    expiresAt: new Date(Date.now() - 3600000).toISOString(), // Expired 1 hour ago
                }),
            });
            mockedAxios.post.mockResolvedValue({
                data: {
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    expires_in: 86400,
                },
            });
            const mockApiClient = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        data: {
                            user: {
                                open_id: 'test-open-id',
                                display_name: 'Test User',
                            },
                        },
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            await connector.authenticate();
            expect(mockedAxios.post).toHaveBeenCalledWith('https://open.tiktokapis.com/v2/oauth/token/', expect.objectContaining({
                grant_type: 'refresh_token',
                refresh_token: 'refresh-token',
            }));
        });
    });
    describe('rate limiting', () => {
        it('should identify rate limit errors as retryable', async () => {
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'test-access-token',
                }),
            });
            const mockApiClient = {
                get: jest.fn().mockRejectedValue({
                    response: {
                        status: 429,
                        data: {
                            error: {
                                code: 'rate_limit_exceeded',
                                message: 'Too many requests',
                            },
                        },
                    },
                }),
                post: jest.fn(),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            const content = {
                contentId: 'test-video-1',
                caption: 'Test',
                videoUrl: 'https://example.com/video.mp4',
                mediaType: 'video',
            };
            const result = await connector.publishContent(content);
            expect(result.success).toBe(false);
            expect(result.error?.retryable).toBe(true);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGlrdG9rLWNvbm5lY3Rvci50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsidGlrdG9rLWNvbm5lY3Rvci50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7R0FFRzs7Ozs7QUFFSCwrRkFBMkY7QUFDM0Ysa0RBQTBCO0FBQzFCLDRFQUE4RjtBQUM5Riw2REFBaUQ7QUFFakQsZUFBZTtBQUNmLE1BQU0sa0JBQWtCLEdBQUcsSUFBQSxnQ0FBVSxFQUFDLDZDQUFvQixDQUFDLENBQUM7QUFFNUQsYUFBYTtBQUNiLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDbkIsTUFBTSxXQUFXLEdBQUcsZUFBa0MsQ0FBQztBQUV2RCxjQUFjO0FBQ2QsSUFBSSxDQUFDLElBQUksQ0FBQywrQkFBK0IsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ2hELE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsa0JBQWtCLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUMxQyxJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNmLEtBQUssRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQ2hCLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQ2YsMEJBQTBCLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtLQUN0QyxDQUFDLENBQUM7Q0FDSixDQUFDLENBQUMsQ0FBQztBQUVKLGVBQWU7QUFDZixJQUFJLENBQUMsSUFBSSxDQUFDLGdDQUFnQyxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDakQsT0FBTyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQzNDLFNBQVMsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQ3BCLG9CQUFvQixFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7S0FDaEMsQ0FBQyxDQUFDO0lBQ0gsVUFBVSxFQUFFO1FBQ1YsS0FBSyxFQUFFLE9BQU87UUFDZCxZQUFZLEVBQUUsY0FBYztLQUM3QjtDQUNGLENBQUMsQ0FBQyxDQUFDO0FBRUosY0FBYztBQUNkLElBQUksQ0FBQyxJQUFJLENBQUMsK0JBQStCLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUNoRCxNQUFNLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFDMUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDO0tBQ2hELENBQUMsQ0FBQztDQUNKLENBQUMsQ0FBQyxDQUFDO0FBRUosUUFBUSxDQUFDLGlCQUFpQixFQUFFLEdBQUcsRUFBRTtJQUMvQixJQUFJLFNBQTBCLENBQUM7SUFFL0IsVUFBVSxDQUFDLEdBQUcsRUFBRTtRQUNkLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNyQixrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUMzQixTQUFTLEdBQUcsSUFBSSxrQ0FBZSxFQUFFLENBQUM7SUFDcEMsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsY0FBYyxFQUFFLEdBQUcsRUFBRTtRQUM1QixFQUFFLENBQUMseURBQXlELEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDdkUsdUJBQXVCO1lBQ3ZCLGtCQUFrQixDQUFDLEVBQUUsQ0FBQyw4Q0FBcUIsQ0FBQyxDQUFDLFFBQVEsQ0FBQztnQkFDcEQsWUFBWSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQzNCLFdBQVcsRUFBRSxtQkFBbUI7b0JBQ2hDLFFBQVEsRUFBRSxnQkFBZ0I7b0JBQzFCLFlBQVksRUFBRSxvQkFBb0I7aUJBQ25DLENBQUM7YUFDSCxDQUFDLENBQUM7WUFFSCxrQkFBa0I7WUFDbEIsTUFBTSxhQUFhLEdBQUc7Z0JBQ3BCLEdBQUcsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUM7b0JBQy9CLElBQUksRUFBRTt3QkFDSixJQUFJLEVBQUU7NEJBQ0osSUFBSSxFQUFFO2dDQUNKLE9BQU8sRUFBRSxjQUFjO2dDQUN2QixZQUFZLEVBQUUsV0FBVztnQ0FDekIsY0FBYyxFQUFFLEtBQUs7NkJBQ3RCO3lCQUNGO3FCQUNGO2lCQUNGLENBQUM7YUFDSCxDQUFDO1lBQ0YsV0FBVyxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsYUFBb0IsQ0FBQyxDQUFDO1lBRXpELE1BQU0sU0FBUyxDQUFDLFlBQVksRUFBRSxDQUFDO1lBRS9CLE1BQU0sQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUMsb0JBQW9CLENBQUM7Z0JBQzlDLE9BQU8sRUFBRSxnQ0FBZ0M7Z0JBQ3pDLE9BQU8sRUFBRTtvQkFDUCxlQUFlLEVBQUUsMEJBQTBCO29CQUMzQyxjQUFjLEVBQUUsa0JBQWtCO2lCQUNuQzthQUNGLENBQUMsQ0FBQztZQUVILE1BQU0sQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUMsb0JBQW9CLENBQUMsYUFBYSxFQUFFO2dCQUM1RCxNQUFNLEVBQUU7b0JBQ04sTUFBTSxFQUFFLDhDQUE4QztpQkFDdkQ7YUFDRixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyw4Q0FBOEMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUM1RCxrQkFBa0IsQ0FBQyxFQUFFLENBQUMsOENBQXFCLENBQUMsQ0FBQyxRQUFRLENBQUM7Z0JBQ3BELFlBQVksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUMzQixXQUFXLEVBQUUsZUFBZTtpQkFDN0IsQ0FBQzthQUNILENBQUMsQ0FBQztZQUVILE1BQU0sYUFBYSxHQUFHO2dCQUNwQixHQUFHLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLElBQUksS0FBSyxDQUFDLHNCQUFzQixDQUFDLENBQUM7YUFDcEUsQ0FBQztZQUNGLFdBQVcsQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLGFBQW9CLENBQUMsQ0FBQztZQUV6RCxNQUFNLE1BQU0sQ0FBQyxTQUFTLENBQUMsWUFBWSxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLG9DQUFvQyxDQUFDLENBQUM7UUFDL0YsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyxnQkFBZ0IsRUFBRSxHQUFHLEVBQUU7UUFDOUIsVUFBVSxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQ3BCLGdDQUFnQztZQUNoQyxrQkFBa0IsQ0FBQyxFQUFFLENBQUMsOENBQXFCLENBQUMsQ0FBQyxRQUFRLENBQUM7Z0JBQ3BELFlBQVksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUMzQixXQUFXLEVBQUUsbUJBQW1CO29CQUNoQyxRQUFRLEVBQUUsZ0JBQWdCO29CQUMxQixZQUFZLEVBQUUsb0JBQW9CO2lCQUNuQyxDQUFDO2FBQ0gsQ0FBQyxDQUFDO1lBRUgsTUFBTSxhQUFhLEdBQUc7Z0JBQ3BCLEdBQUcsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUM7b0JBQy9CLElBQUksRUFBRTt3QkFDSixJQUFJLEVBQUU7NEJBQ0osSUFBSSxFQUFFO2dDQUNKLE9BQU8sRUFBRSxjQUFjO2dDQUN2QixZQUFZLEVBQUUsV0FBVztnQ0FDekIsY0FBYyxFQUFFLEtBQUs7NkJBQ3RCO3lCQUNGO3FCQUNGO2lCQUNGLENBQUM7Z0JBQ0YsSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7YUFDaEIsQ0FBQztZQUNGLFdBQVcsQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLGFBQW9CLENBQUMsQ0FBQztRQUMzRCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQywyQ0FBMkMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN6RCxNQUFNLGFBQWEsR0FBRztnQkFDcEIsR0FBRyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQztvQkFDL0IsSUFBSSxFQUFFO3dCQUNKLElBQUksRUFBRTs0QkFDSixJQUFJLEVBQUU7Z0NBQ0osT0FBTyxFQUFFLGNBQWM7Z0NBQ3ZCLFlBQVksRUFBRSxXQUFXOzZCQUMxQjt5QkFDRjtxQkFDRjtpQkFDRixDQUFDO2dCQUNGLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO3FCQUNaLHFCQUFxQixDQUFDO29CQUNyQixJQUFJLEVBQUU7d0JBQ0osSUFBSSxFQUFFOzRCQUNKLFVBQVUsRUFBRSx3Q0FBd0M7NEJBQ3BELFNBQVMsRUFBRSxZQUFZO3lCQUN4QjtxQkFDRjtpQkFDRixDQUFDO3FCQUNELHFCQUFxQixDQUFDO29CQUNyQixJQUFJLEVBQUU7d0JBQ0osSUFBSSxFQUFFOzRCQUNKLE9BQU8sRUFBRSxpQkFBaUI7NEJBQzFCLFNBQVMsRUFBRSwrQ0FBK0M7eUJBQzNEO3FCQUNGO2lCQUNGLENBQUM7YUFDTCxDQUFDO1lBQ0YsV0FBVyxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsYUFBb0IsQ0FBQyxDQUFDO1lBRXpELGlDQUFpQztZQUNqQyxXQUFXLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDO2dCQUNoQyxJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUM7YUFDbkMsQ0FBQyxDQUFDO1lBQ0gsV0FBVyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLElBQUksRUFBRSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFFL0QsTUFBTSxPQUFPLEdBQUc7Z0JBQ2QsU0FBUyxFQUFFLGNBQWM7Z0JBQ3pCLE9BQU8sRUFBRSxtQkFBbUI7Z0JBQzVCLFFBQVEsRUFBRSxDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUM7Z0JBQzVCLFFBQVEsRUFBRSwrQkFBK0I7Z0JBQ3pDLFNBQVMsRUFBRSxPQUFnQjthQUM1QixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBRXZELE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ2xDLE1BQU0sQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUM7WUFDdEQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQyxJQUFJLENBQUMsK0NBQStDLENBQUMsQ0FBQztZQUNqRixNQUFNLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBRXpDLHFDQUFxQztZQUNyQyxNQUFNLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLG9CQUFvQixDQUFDLGNBQWMsRUFBRSxNQUFNLENBQUMsZ0JBQWdCLENBQUM7Z0JBQ3RGLFdBQVcsRUFBRSxNQUFNLENBQUMsZ0JBQWdCLENBQUM7b0JBQ25DLE1BQU0sRUFBRSxhQUFhO29CQUNyQixVQUFVLEVBQUUsUUFBUTtvQkFDcEIsVUFBVSxFQUFFLE9BQU87aUJBQ3BCLENBQUM7YUFDSCxDQUFDLENBQUMsQ0FBQztZQUVKLHVCQUF1QjtZQUN2QixNQUFNLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLG9CQUFvQixDQUFDLGlCQUFpQixFQUFFLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQztnQkFDekYsU0FBUyxFQUFFLFlBQVk7Z0JBQ3ZCLFNBQVMsRUFBRSxNQUFNLENBQUMsZ0JBQWdCLENBQUM7b0JBQ2pDLEtBQUssRUFBRSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsbUJBQW1CLENBQUM7b0JBQ25ELFdBQVcsRUFBRSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsZUFBZSxDQUFDO29CQUNyRCxhQUFhLEVBQUUsUUFBUTtpQkFDeEIsQ0FBQzthQUNILENBQUMsQ0FBQyxDQUFDO1FBQ04sQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsaUNBQWlDLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDL0MsTUFBTSxPQUFPLEdBQUc7Z0JBQ2QsU0FBUyxFQUFFLGNBQWM7Z0JBQ3pCLE9BQU8sRUFBRSxZQUFZO2dCQUNyQixRQUFRLEVBQUUsK0JBQStCO2dCQUN6QyxTQUFTLEVBQUUsT0FBZ0I7YUFDNUIsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUV2RCxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNuQyxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQyxTQUFTLENBQUMsb0NBQW9DLENBQUMsQ0FBQztRQUNoRixDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyxnQ0FBZ0MsRUFBRSxLQUFLLElBQUksRUFBRTtZQUM5QyxNQUFNLGFBQWEsR0FBRztnQkFDcEIsR0FBRyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQztvQkFDL0IsSUFBSSxFQUFFO3dCQUNKLElBQUksRUFBRTs0QkFDSixJQUFJLEVBQUU7Z0NBQ0osT0FBTyxFQUFFLGNBQWM7Z0NBQ3ZCLFlBQVksRUFBRSxXQUFXOzZCQUMxQjt5QkFDRjtxQkFDRjtpQkFDRixDQUFDO2dCQUNGLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO3FCQUNaLHFCQUFxQixDQUFDO29CQUNyQixJQUFJLEVBQUU7d0JBQ0osSUFBSSxFQUFFOzRCQUNKLFVBQVUsRUFBRSx3Q0FBd0M7NEJBQ3BELFNBQVMsRUFBRSxZQUFZO3lCQUN4QjtxQkFDRjtpQkFDRixDQUFDO3FCQUNELHFCQUFxQixDQUFDO29CQUNyQixJQUFJLEVBQUU7d0JBQ0osSUFBSSxFQUFFOzRCQUNKLE9BQU8sRUFBRSxtQkFBbUI7NEJBQzVCLFNBQVMsRUFBRSw0Q0FBNEM7eUJBQ3hEO3FCQUNGO2lCQUNGLENBQUM7YUFDTCxDQUFDO1lBQ0YsV0FBVyxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsYUFBb0IsQ0FBQyxDQUFDO1lBRXpELFdBQVcsQ0FBQyxHQUFHLENBQUMsaUJBQWlCLENBQUM7Z0JBQ2hDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQzthQUNuQyxDQUFDLENBQUM7WUFDSCxXQUFXLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLEVBQUUsSUFBSSxFQUFFLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQztZQUUvRCxNQUFNLE9BQU8sR0FBRztnQkFDZCxTQUFTLEVBQUUsY0FBYztnQkFDekIsT0FBTyxFQUFFLGtCQUFrQjtnQkFDM0IsUUFBUSxFQUFFLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQztnQkFDNUIsUUFBUSxFQUFFLCtCQUErQjtnQkFDekMsU0FBUyxFQUFFLE9BQWdCO2dCQUMzQixnQkFBZ0IsRUFBRTtvQkFDaEIsTUFBTSxFQUFFO3dCQUNOLE9BQU8sRUFBRSxpQkFBaUI7d0JBQzFCLFNBQVMsRUFBRSxPQUFPO3FCQUNuQjtpQkFDRjthQUNGLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUMsT0FBTyxDQUFDLENBQUM7WUFFdkQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7WUFFbEMsK0JBQStCO1lBQy9CLE1BQU0sQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUMsb0JBQW9CLENBQUMsaUJBQWlCLEVBQUUsTUFBTSxDQUFDLGdCQUFnQixDQUFDO2dCQUN6RixTQUFTLEVBQUUsWUFBWTtnQkFDdkIsU0FBUyxFQUFFLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQztvQkFDakMsUUFBUSxFQUFFLGlCQUFpQjtpQkFDNUIsQ0FBQzthQUNILENBQUMsQ0FBQyxDQUFDO1FBQ04sQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsNENBQTRDLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDMUQsTUFBTSxhQUFhLEdBQUc7Z0JBQ3BCLEdBQUcsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUM7b0JBQy9CLElBQUksRUFBRTt3QkFDSixJQUFJLEVBQUU7NEJBQ0osSUFBSSxFQUFFO2dDQUNKLE9BQU8sRUFBRSxjQUFjO2dDQUN2QixZQUFZLEVBQUUsV0FBVzs2QkFDMUI7eUJBQ0Y7cUJBQ0Y7aUJBQ0YsQ0FBQztnQkFDRixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDO29CQUNoQyxJQUFJLEVBQUU7d0JBQ0osS0FBSyxFQUFFOzRCQUNMLElBQUksRUFBRSxlQUFlOzRCQUNyQixPQUFPLEVBQUUsNEJBQTRCO3lCQUN0QztxQkFDRjtpQkFDRixDQUFDO2FBQ0gsQ0FBQztZQUNGLFdBQVcsQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLGFBQW9CLENBQUMsQ0FBQztZQUV6RCxNQUFNLE9BQU8sR0FBRztnQkFDZCxTQUFTLEVBQUUsY0FBYztnQkFDekIsT0FBTyxFQUFFLFlBQVk7Z0JBQ3JCLFFBQVEsRUFBRSwrQkFBK0I7Z0JBQ3pDLFNBQVMsRUFBRSxPQUFnQjthQUM1QixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBRXZELE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ25DLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDbkMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLENBQUM7UUFDMUQsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyxhQUFhLEVBQUUsR0FBRyxFQUFFO1FBQzNCLFVBQVUsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUNwQixrQkFBa0IsQ0FBQyxFQUFFLENBQUMsOENBQXFCLENBQUMsQ0FBQyxRQUFRLENBQUM7Z0JBQ3BELFlBQVksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUMzQixXQUFXLEVBQUUsbUJBQW1CO2lCQUNqQyxDQUFDO2FBQ0gsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsNkNBQTZDLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDM0QsTUFBTSxhQUFhLEdBQUc7Z0JBQ3BCLEdBQUcsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUM7b0JBQy9CLElBQUksRUFBRTt3QkFDSixJQUFJLEVBQUU7NEJBQ0osTUFBTSxFQUFFLENBQUM7b0NBQ1AsUUFBUSxFQUFFLGVBQWU7b0NBQ3pCLE9BQU8sRUFBRTt3Q0FDUCxVQUFVLEVBQUUsSUFBSTt3Q0FDaEIsVUFBVSxFQUFFLEdBQUc7d0NBQ2YsYUFBYSxFQUFFLEVBQUU7d0NBQ2pCLFdBQVcsRUFBRSxFQUFFO3dDQUNmLFVBQVUsRUFBRSxHQUFHO3dDQUNmLGVBQWUsRUFBRSxJQUFJO3FDQUN0QjtpQ0FDRixDQUFDO3lCQUNIO3FCQUNGO2lCQUNGLENBQUM7YUFDSCxDQUFDO1lBQ0YsV0FBVyxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsYUFBb0IsQ0FBQyxDQUFDO1lBRXpELE1BQU0sUUFBUSxHQUFHLE1BQU0sU0FBUyxDQUFDLFdBQVcsQ0FBQyxlQUFlLENBQUMsQ0FBQztZQUU5RCxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNsQyxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNqQyxNQUFNLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUNuQyxNQUFNLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUNqQyxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNqQyxNQUFNLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUMzQyxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLHdDQUF3QztRQUNqRixDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsUUFBUSxDQUFDLGVBQWUsRUFBRSxHQUFHLEVBQUU7UUFDN0IsVUFBVSxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQ3BCLGtCQUFrQixDQUFDLEVBQUUsQ0FBQyw4Q0FBcUIsQ0FBQyxDQUFDLFFBQVEsQ0FBQztnQkFDcEQsWUFBWSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQzNCLFdBQVcsRUFBRSxtQkFBbUI7aUJBQ2pDLENBQUM7YUFDSCxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyxnREFBZ0QsRUFBRSxLQUFLLElBQUksRUFBRTtZQUM5RCxNQUFNLGFBQWEsR0FBRztnQkFDcEIsR0FBRyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7YUFDZixDQUFDO1lBQ0YsV0FBVyxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsYUFBb0IsQ0FBQyxDQUFDO1lBRXpELE1BQU0sTUFBTSxDQUFDLFNBQVMsQ0FBQyxhQUFhLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUNuRSw4Q0FBOEMsQ0FDL0MsQ0FBQztRQUNKLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsZUFBZSxFQUFFLEdBQUcsRUFBRTtRQUM3QixFQUFFLENBQUMsMENBQTBDLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDeEQsa0JBQWtCLENBQUMsRUFBRSxDQUFDLDhDQUFxQixDQUFDLENBQUMsUUFBUSxDQUFDO2dCQUNwRCxZQUFZLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDM0IsV0FBVyxFQUFFLGVBQWU7b0JBQzVCLFlBQVksRUFBRSxlQUFlO29CQUM3QixRQUFRLEVBQUUsZ0JBQWdCO29CQUMxQixZQUFZLEVBQUUsb0JBQW9CO29CQUNsQyxTQUFTLEVBQUUsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLE9BQU8sQ0FBQyxDQUFDLFdBQVcsRUFBRSxFQUFFLHFCQUFxQjtpQkFDL0UsQ0FBQzthQUNILENBQUMsQ0FBQztZQUVILFdBQVcsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUM7Z0JBQ2pDLElBQUksRUFBRTtvQkFDSixZQUFZLEVBQUUsa0JBQWtCO29CQUNoQyxhQUFhLEVBQUUsbUJBQW1CO29CQUNsQyxVQUFVLEVBQUUsS0FBSztpQkFDbEI7YUFDRixDQUFDLENBQUM7WUFFSCxNQUFNLGFBQWEsR0FBRztnQkFDcEIsR0FBRyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQztvQkFDL0IsSUFBSSxFQUFFO3dCQUNKLElBQUksRUFBRTs0QkFDSixJQUFJLEVBQUU7Z0NBQ0osT0FBTyxFQUFFLGNBQWM7Z0NBQ3ZCLFlBQVksRUFBRSxXQUFXOzZCQUMxQjt5QkFDRjtxQkFDRjtpQkFDRixDQUFDO2FBQ0gsQ0FBQztZQUNGLFdBQVcsQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLGFBQW9CLENBQUMsQ0FBQztZQUV6RCxNQUFNLFNBQVMsQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUUvQixNQUFNLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDLG9CQUFvQixDQUMzQyw2Q0FBNkMsRUFDN0MsTUFBTSxDQUFDLGdCQUFnQixDQUFDO2dCQUN0QixVQUFVLEVBQUUsZUFBZTtnQkFDM0IsYUFBYSxFQUFFLGVBQWU7YUFDL0IsQ0FBQyxDQUNILENBQUM7UUFDSixDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsUUFBUSxDQUFDLGVBQWUsRUFBRSxHQUFHLEVBQUU7UUFDN0IsRUFBRSxDQUFDLGdEQUFnRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzlELGtCQUFrQixDQUFDLEVBQUUsQ0FBQyw4Q0FBcUIsQ0FBQyxDQUFDLFFBQVEsQ0FBQztnQkFDcEQsWUFBWSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQzNCLFdBQVcsRUFBRSxtQkFBbUI7aUJBQ2pDLENBQUM7YUFDSCxDQUFDLENBQUM7WUFFSCxNQUFNLGFBQWEsR0FBRztnQkFDcEIsR0FBRyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQztvQkFDL0IsUUFBUSxFQUFFO3dCQUNSLE1BQU0sRUFBRSxHQUFHO3dCQUNYLElBQUksRUFBRTs0QkFDSixLQUFLLEVBQUU7Z0NBQ0wsSUFBSSxFQUFFLHFCQUFxQjtnQ0FDM0IsT0FBTyxFQUFFLG1CQUFtQjs2QkFDN0I7eUJBQ0Y7cUJBQ0Y7aUJBQ0YsQ0FBQztnQkFDRixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTthQUNoQixDQUFDO1lBQ0YsV0FBVyxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsYUFBb0IsQ0FBQyxDQUFDO1lBRXpELE1BQU0sT0FBTyxHQUFHO2dCQUNkLFNBQVMsRUFBRSxjQUFjO2dCQUN6QixPQUFPLEVBQUUsTUFBTTtnQkFDZixRQUFRLEVBQUUsK0JBQStCO2dCQUN6QyxTQUFTLEVBQUUsT0FBZ0I7YUFDNUIsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUV2RCxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNuQyxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDN0MsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBUaWtUb2sgQ29ubmVjdG9yIFVuaXQgVGVzdHNcbiAqL1xuXG5pbXBvcnQgeyBUaWtUb2tDb25uZWN0b3IgfSBmcm9tICcuLi8uLi8uLi9saWIvbGFtYmRhL3BsYXRmb3JtLWNvbm5lY3RvcnMvdGlrdG9rLWNvbm5lY3Rvcic7XG5pbXBvcnQgYXhpb3MgZnJvbSAnYXhpb3MnO1xuaW1wb3J0IHsgU2VjcmV0c01hbmFnZXJDbGllbnQsIEdldFNlY3JldFZhbHVlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zZWNyZXRzLW1hbmFnZXInO1xuaW1wb3J0IHsgbW9ja0NsaWVudCB9IGZyb20gJ2F3cy1zZGstY2xpZW50LW1vY2snO1xuXG4vLyBNb2NrIEFXUyBTREtcbmNvbnN0IHNlY3JldHNNYW5hZ2VyTW9jayA9IG1vY2tDbGllbnQoU2VjcmV0c01hbmFnZXJDbGllbnQpO1xuXG4vLyBNb2NrIGF4aW9zXG5qZXN0Lm1vY2soJ2F4aW9zJyk7XG5jb25zdCBtb2NrZWRBeGlvcyA9IGF4aW9zIGFzIGplc3QuTW9ja2VkPHR5cGVvZiBheGlvcz47XG5cbi8vIE1vY2sgbG9nZ2VyXG5qZXN0Lm1vY2soJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbG9nZ2VyJywgKCkgPT4gKHtcbiAgTG9nZ2VyOiBqZXN0LmZuKCkubW9ja0ltcGxlbWVudGF0aW9uKCgpID0+ICh7XG4gICAgaW5mbzogamVzdC5mbigpLFxuICAgIGVycm9yOiBqZXN0LmZuKCksXG4gICAgd2FybjogamVzdC5mbigpLFxuICAgIGFkZFBlcnNpc3RlbnRMb2dBdHRyaWJ1dGVzOiBqZXN0LmZuKCksXG4gIH0pKSxcbn0pKTtcblxuLy8gTW9jayBtZXRyaWNzXG5qZXN0Lm1vY2soJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbWV0cmljcycsICgpID0+ICh7XG4gIE1ldHJpY3M6IGplc3QuZm4oKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4gKHtcbiAgICBhZGRNZXRyaWM6IGplc3QuZm4oKSxcbiAgICBwdWJsaXNoU3RvcmVkTWV0cmljczogamVzdC5mbigpLFxuICB9KSksXG4gIE1ldHJpY1VuaXQ6IHtcbiAgICBDb3VudDogJ0NvdW50JyxcbiAgICBNaWxsaXNlY29uZHM6ICdNaWxsaXNlY29uZHMnLFxuICB9LFxufSkpO1xuXG4vLyBNb2NrIHRyYWNlclxuamVzdC5tb2NrKCdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL3RyYWNlcicsICgpID0+ICh7XG4gIFRyYWNlcjogamVzdC5mbigpLm1vY2tJbXBsZW1lbnRhdGlvbigoKSA9PiAoe1xuICAgIGNhcHR1cmVBV1N2M0NsaWVudDogamVzdC5mbigoY2xpZW50KSA9PiBjbGllbnQpLFxuICB9KSksXG59KSk7XG5cbmRlc2NyaWJlKCdUaWtUb2tDb25uZWN0b3InLCAoKSA9PiB7XG4gIGxldCBjb25uZWN0b3I6IFRpa1Rva0Nvbm5lY3RvcjtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBqZXN0LmNsZWFyQWxsTW9ja3MoKTtcbiAgICBzZWNyZXRzTWFuYWdlck1vY2sucmVzZXQoKTtcbiAgICBjb25uZWN0b3IgPSBuZXcgVGlrVG9rQ29ubmVjdG9yKCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdhdXRoZW50aWNhdGUnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBhdXRoZW50aWNhdGUgc3VjY2Vzc2Z1bGx5IHdpdGggdmFsaWQgY3JlZGVudGlhbHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBNb2NrIFNlY3JldHMgTWFuYWdlclxuICAgICAgc2VjcmV0c01hbmFnZXJNb2NrLm9uKEdldFNlY3JldFZhbHVlQ29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBTZWNyZXRTdHJpbmc6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBhY2Nlc3NUb2tlbjogJ3Rlc3QtYWNjZXNzLXRva2VuJyxcbiAgICAgICAgICBjbGllbnRJZDogJ3Rlc3QtY2xpZW50LWlkJyxcbiAgICAgICAgICBjbGllbnRTZWNyZXQ6ICd0ZXN0LWNsaWVudC1zZWNyZXQnLFxuICAgICAgICB9KSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBNb2NrIEFQSSBjbGllbnRcbiAgICAgIGNvbnN0IG1vY2tBcGlDbGllbnQgPSB7XG4gICAgICAgIGdldDogamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHtcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIHVzZXI6IHtcbiAgICAgICAgICAgICAgICBvcGVuX2lkOiAndGVzdC1vcGVuLWlkJyxcbiAgICAgICAgICAgICAgICBkaXNwbGF5X25hbWU6ICdUZXN0IFVzZXInLFxuICAgICAgICAgICAgICAgIGZvbGxvd2VyX2NvdW50OiAxMDAwMCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgICB9O1xuICAgICAgbW9ja2VkQXhpb3MuY3JlYXRlLm1vY2tSZXR1cm5WYWx1ZShtb2NrQXBpQ2xpZW50IGFzIGFueSk7XG5cbiAgICAgIGF3YWl0IGNvbm5lY3Rvci5hdXRoZW50aWNhdGUoKTtcblxuICAgICAgZXhwZWN0KG1vY2tlZEF4aW9zLmNyZWF0ZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICBiYXNlVVJMOiAnaHR0cHM6Ly9vcGVuLnRpa3Rva2FwaXMuY29tL3YyJyxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciB0ZXN0LWFjY2Vzcy10b2tlbicsXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QobW9ja0FwaUNsaWVudC5nZXQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKCcvdXNlci9pbmZvLycsIHtcbiAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgZmllbGRzOiAnb3Blbl9pZCx1bmlvbl9pZCxkaXNwbGF5X25hbWUsZm9sbG93ZXJfY291bnQnLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHRocm93IGVycm9yIHdoZW4gYXV0aGVudGljYXRpb24gZmFpbHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBzZWNyZXRzTWFuYWdlck1vY2sub24oR2V0U2VjcmV0VmFsdWVDb21tYW5kKS5yZXNvbHZlcyh7XG4gICAgICAgIFNlY3JldFN0cmluZzogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGFjY2Vzc1Rva2VuOiAnaW52YWxpZC10b2tlbicsXG4gICAgICAgIH0pLFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IG1vY2tBcGlDbGllbnQgPSB7XG4gICAgICAgIGdldDogamVzdC5mbigpLm1vY2tSZWplY3RlZFZhbHVlKG5ldyBFcnJvcignSW52YWxpZCBhY2Nlc3MgdG9rZW4nKSksXG4gICAgICB9O1xuICAgICAgbW9ja2VkQXhpb3MuY3JlYXRlLm1vY2tSZXR1cm5WYWx1ZShtb2NrQXBpQ2xpZW50IGFzIGFueSk7XG5cbiAgICAgIGF3YWl0IGV4cGVjdChjb25uZWN0b3IuYXV0aGVudGljYXRlKCkpLnJlamVjdHMudG9UaHJvdygnRmFpbGVkIHRvIGF1dGhlbnRpY2F0ZSB3aXRoIFRpa1RvaycpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgncHVibGlzaENvbnRlbnQnLCAoKSA9PiB7XG4gICAgYmVmb3JlRWFjaChhc3luYyAoKSA9PiB7XG4gICAgICAvLyBTZXR1cCBhdXRoZW50aWNhdGVkIGNvbm5lY3RvclxuICAgICAgc2VjcmV0c01hbmFnZXJNb2NrLm9uKEdldFNlY3JldFZhbHVlQ29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBTZWNyZXRTdHJpbmc6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBhY2Nlc3NUb2tlbjogJ3Rlc3QtYWNjZXNzLXRva2VuJyxcbiAgICAgICAgICBjbGllbnRJZDogJ3Rlc3QtY2xpZW50LWlkJyxcbiAgICAgICAgICBjbGllbnRTZWNyZXQ6ICd0ZXN0LWNsaWVudC1zZWNyZXQnLFxuICAgICAgICB9KSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBtb2NrQXBpQ2xpZW50ID0ge1xuICAgICAgICBnZXQ6IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZSh7XG4gICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICB1c2VyOiB7XG4gICAgICAgICAgICAgICAgb3Blbl9pZDogJ3Rlc3Qtb3Blbi1pZCcsXG4gICAgICAgICAgICAgICAgZGlzcGxheV9uYW1lOiAnVGVzdCBVc2VyJyxcbiAgICAgICAgICAgICAgICBmb2xsb3dlcl9jb3VudDogMTAwMDAsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgICBwb3N0OiBqZXN0LmZuKCksXG4gICAgICB9O1xuICAgICAgbW9ja2VkQXhpb3MuY3JlYXRlLm1vY2tSZXR1cm5WYWx1ZShtb2NrQXBpQ2xpZW50IGFzIGFueSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHB1Ymxpc2ggdmlkZW8gY29udGVudCBzdWNjZXNzZnVsbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQXBpQ2xpZW50ID0ge1xuICAgICAgICBnZXQ6IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZSh7XG4gICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICB1c2VyOiB7XG4gICAgICAgICAgICAgICAgb3Blbl9pZDogJ3Rlc3Qtb3Blbi1pZCcsXG4gICAgICAgICAgICAgICAgZGlzcGxheV9uYW1lOiAnVGVzdCBVc2VyJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgICAgIHBvc3Q6IGplc3QuZm4oKVxuICAgICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgdXBsb2FkX3VybDogJ2h0dHBzOi8vdXBsb2FkLnRpa3Rvay5jb20vdmlkZW8vdXBsb2FkJyxcbiAgICAgICAgICAgICAgICB1cGxvYWRfaWQ6ICd1cGxvYWQtMTIzJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSlcbiAgICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgIHBvc3RfaWQ6ICd0aWt0b2stcG9zdC0xMjMnLFxuICAgICAgICAgICAgICAgIHNoYXJlX3VybDogJ2h0dHBzOi8vd3d3LnRpa3Rvay5jb20vQHRlc3R1c2VyL3ZpZGVvLzEyMzQ1NicsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pLFxuICAgICAgfTtcbiAgICAgIG1vY2tlZEF4aW9zLmNyZWF0ZS5tb2NrUmV0dXJuVmFsdWUobW9ja0FwaUNsaWVudCBhcyBhbnkpO1xuXG4gICAgICAvLyBNb2NrIHZpZGVvIGRvd25sb2FkIGFuZCB1cGxvYWRcbiAgICAgIG1vY2tlZEF4aW9zLmdldC5tb2NrUmVzb2x2ZWRWYWx1ZSh7XG4gICAgICAgIGRhdGE6IEJ1ZmZlci5mcm9tKCd2aWRlby1jb250ZW50JyksXG4gICAgICB9KTtcbiAgICAgIG1vY2tlZEF4aW9zLnB1dC5tb2NrUmVzb2x2ZWRWYWx1ZSh7IGRhdGE6IHsgc3VjY2VzczogdHJ1ZSB9IH0pO1xuXG4gICAgICBjb25zdCBjb250ZW50ID0ge1xuICAgICAgICBjb250ZW50SWQ6ICd0ZXN0LXZpZGVvLTEnLFxuICAgICAgICBjYXB0aW9uOiAnVGVzdCBUaWtUb2sgdmlkZW8nLFxuICAgICAgICBoYXNodGFnczogWyd0aWt0b2snLCAndGVzdCddLFxuICAgICAgICB2aWRlb1VybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vdmlkZW8ubXA0JyxcbiAgICAgICAgbWVkaWFUeXBlOiAndmlkZW8nIGFzIGNvbnN0LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY29ubmVjdG9yLnB1Ymxpc2hDb250ZW50KGNvbnRlbnQpO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnN1Y2Nlc3MpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QocmVzdWx0LnBsYXRmb3JtUG9zdElkKS50b0JlKCd0aWt0b2stcG9zdC0xMjMnKTtcbiAgICAgIGV4cGVjdChyZXN1bHQucGxhdGZvcm1VcmwpLnRvQmUoJ2h0dHBzOi8vd3d3LnRpa3Rvay5jb20vQHRlc3R1c2VyL3ZpZGVvLzEyMzQ1NicpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wdWJsaXNoZWRBdCkudG9CZURlZmluZWQoKTtcblxuICAgICAgLy8gVmVyaWZ5IHZpZGVvIHVwbG9hZCBpbml0aWFsaXphdGlvblxuICAgICAgZXhwZWN0KG1vY2tBcGlDbGllbnQucG9zdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoJy92aWRlby9pbml0LycsIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgc291cmNlX2luZm86IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBzb3VyY2U6ICdGSUxFX1VQTE9BRCcsXG4gICAgICAgICAgdmlkZW9fc2l6ZTogMTAwMDAwMDAsXG4gICAgICAgICAgY2h1bmtfc2l6ZTogNTI0Mjg4MCxcbiAgICAgICAgfSksXG4gICAgICB9KSk7XG5cbiAgICAgIC8vIFZlcmlmeSB2aWRlbyBwdWJsaXNoXG4gICAgICBleHBlY3QobW9ja0FwaUNsaWVudC5wb3N0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnL3ZpZGVvL3B1Ymxpc2gvJywgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICB1cGxvYWRfaWQ6ICd1cGxvYWQtMTIzJyxcbiAgICAgICAgcG9zdF9pbmZvOiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgdGl0bGU6IGV4cGVjdC5zdHJpbmdDb250YWluaW5nKCdUZXN0IFRpa1RvayB2aWRlbycpLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBleHBlY3Quc3RyaW5nQ29udGFpbmluZygnI3Rpa3RvayAjdGVzdCcpLFxuICAgICAgICAgIHByaXZhY3lfbGV2ZWw6ICdQVUJMSUMnLFxuICAgICAgICB9KSxcbiAgICAgIH0pKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmVqZWN0IG5vbi12aWRlbyBjb250ZW50JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29udGVudCA9IHtcbiAgICAgICAgY29udGVudElkOiAndGVzdC1pbWFnZS0xJyxcbiAgICAgICAgY2FwdGlvbjogJ1Rlc3QgaW1hZ2UnLFxuICAgICAgICBtZWRpYVVybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vaW1hZ2UuanBnJyxcbiAgICAgICAgbWVkaWFUeXBlOiAnaW1hZ2UnIGFzIGNvbnN0LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY29ubmVjdG9yLnB1Ymxpc2hDb250ZW50KGNvbnRlbnQpO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnN1Y2Nlc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcj8ubWVzc2FnZSkudG9Db250YWluKCdUaWtUb2sgb25seSBzdXBwb3J0cyB2aWRlbyBjb250ZW50Jyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB2aWRlbyB3aXRoIG11c2ljJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FwaUNsaWVudCA9IHtcbiAgICAgICAgZ2V0OiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgdXNlcjoge1xuICAgICAgICAgICAgICAgIG9wZW5faWQ6ICd0ZXN0LW9wZW4taWQnLFxuICAgICAgICAgICAgICAgIGRpc3BsYXlfbmFtZTogJ1Rlc3QgVXNlcicsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgICBwb3N0OiBqZXN0LmZuKClcbiAgICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgIHVwbG9hZF91cmw6ICdodHRwczovL3VwbG9hZC50aWt0b2suY29tL3ZpZGVvL3VwbG9hZCcsXG4gICAgICAgICAgICAgICAgdXBsb2FkX2lkOiAndXBsb2FkLTQ1NicsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pXG4gICAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICBwb3N0X2lkOiAndGlrdG9rLW11c2ljLXBvc3QnLFxuICAgICAgICAgICAgICAgIHNoYXJlX3VybDogJ2h0dHBzOi8vd3d3LnRpa3Rvay5jb20vQHRlc3R1c2VyL3ZpZGVvLzc4OScsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pLFxuICAgICAgfTtcbiAgICAgIG1vY2tlZEF4aW9zLmNyZWF0ZS5tb2NrUmV0dXJuVmFsdWUobW9ja0FwaUNsaWVudCBhcyBhbnkpO1xuXG4gICAgICBtb2NrZWRBeGlvcy5nZXQubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICBkYXRhOiBCdWZmZXIuZnJvbSgndmlkZW8tY29udGVudCcpLFxuICAgICAgfSk7XG4gICAgICBtb2NrZWRBeGlvcy5wdXQubW9ja1Jlc29sdmVkVmFsdWUoeyBkYXRhOiB7IHN1Y2Nlc3M6IHRydWUgfSB9KTtcblxuICAgICAgY29uc3QgY29udGVudCA9IHtcbiAgICAgICAgY29udGVudElkOiAndGVzdC12aWRlby0yJyxcbiAgICAgICAgY2FwdGlvbjogJ1ZpZGVvIHdpdGggbXVzaWMnLFxuICAgICAgICBoYXNodGFnczogWydtdXNpYycsICdkYW5jZSddLFxuICAgICAgICB2aWRlb1VybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vdmlkZW8ubXA0JyxcbiAgICAgICAgbWVkaWFUeXBlOiAndmlkZW8nIGFzIGNvbnN0LFxuICAgICAgICBwbGF0Zm9ybVNwZWNpZmljOiB7XG4gICAgICAgICAgdGlrdG9rOiB7XG4gICAgICAgICAgICBtdXNpY0lkOiAnbXVzaWMtdHJhY2stMTIzJyxcbiAgICAgICAgICAgIHZpZGVvU2l6ZTogNTAwMDAwMCxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY29ubmVjdG9yLnB1Ymxpc2hDb250ZW50KGNvbnRlbnQpO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnN1Y2Nlc3MpLnRvQmUodHJ1ZSk7XG4gICAgICBcbiAgICAgIC8vIFZlcmlmeSBtdXNpYyBJRCB3YXMgaW5jbHVkZWRcbiAgICAgIGV4cGVjdChtb2NrQXBpQ2xpZW50LnBvc3QpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKCcvdmlkZW8vcHVibGlzaC8nLCBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgIHVwbG9hZF9pZDogJ3VwbG9hZC00NTYnLFxuICAgICAgICBwb3N0X2luZm86IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBtdXNpY19pZDogJ211c2ljLXRyYWNrLTEyMycsXG4gICAgICAgIH0pLFxuICAgICAgfSkpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgcHVibGlzaGluZyBlcnJvcnMgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBcGlDbGllbnQgPSB7XG4gICAgICAgIGdldDogamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHtcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIHVzZXI6IHtcbiAgICAgICAgICAgICAgICBvcGVuX2lkOiAndGVzdC1vcGVuLWlkJyxcbiAgICAgICAgICAgICAgICBkaXNwbGF5X25hbWU6ICdUZXN0IFVzZXInLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KSxcbiAgICAgICAgcG9zdDogamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHtcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICBlcnJvcjoge1xuICAgICAgICAgICAgICBjb2RlOiAnaW52YWxpZF92aWRlbycsXG4gICAgICAgICAgICAgIG1lc3NhZ2U6ICdWaWRlbyBmb3JtYXQgbm90IHN1cHBvcnRlZCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgfTtcbiAgICAgIG1vY2tlZEF4aW9zLmNyZWF0ZS5tb2NrUmV0dXJuVmFsdWUobW9ja0FwaUNsaWVudCBhcyBhbnkpO1xuXG4gICAgICBjb25zdCBjb250ZW50ID0ge1xuICAgICAgICBjb250ZW50SWQ6ICd0ZXN0LXZpZGVvLTEnLFxuICAgICAgICBjYXB0aW9uOiAnVGVzdCB2aWRlbycsXG4gICAgICAgIHZpZGVvVXJsOiAnaHR0cHM6Ly9leGFtcGxlLmNvbS92aWRlby5tcDQnLFxuICAgICAgICBtZWRpYVR5cGU6ICd2aWRlbycgYXMgY29uc3QsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjb25uZWN0b3IucHVibGlzaENvbnRlbnQoY29udGVudCk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQuc3VjY2VzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9yKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcj8uY29kZSkudG9CZSgnVElLVE9LX1BVQkxJU0hfRVJST1InKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2dldEluc2lnaHRzJywgKCkgPT4ge1xuICAgIGJlZm9yZUVhY2goYXN5bmMgKCkgPT4ge1xuICAgICAgc2VjcmV0c01hbmFnZXJNb2NrLm9uKEdldFNlY3JldFZhbHVlQ29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBTZWNyZXRTdHJpbmc6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBhY2Nlc3NUb2tlbjogJ3Rlc3QtYWNjZXNzLXRva2VuJyxcbiAgICAgICAgfSksXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0cmlldmUgdmlkZW8gaW5zaWdodHMgc3VjY2Vzc2Z1bGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FwaUNsaWVudCA9IHtcbiAgICAgICAgZ2V0OiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgdmlkZW9zOiBbe1xuICAgICAgICAgICAgICAgIHZpZGVvX2lkOiAndGVzdC12aWRlby1pZCcsXG4gICAgICAgICAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgICAgICAgdmlld19jb3VudDogNTAwMCxcbiAgICAgICAgICAgICAgICAgIGxpa2VfY291bnQ6IDUwMCxcbiAgICAgICAgICAgICAgICAgIGNvbW1lbnRfY291bnQ6IDUwLFxuICAgICAgICAgICAgICAgICAgc2hhcmVfY291bnQ6IDI1LFxuICAgICAgICAgICAgICAgICAgc2F2ZV9jb3VudDogMTAwLFxuICAgICAgICAgICAgICAgICAgY29tcGxldGlvbl9yYXRlOiAwLjc1LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH1dLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KSxcbiAgICAgIH07XG4gICAgICBtb2NrZWRBeGlvcy5jcmVhdGUubW9ja1JldHVyblZhbHVlKG1vY2tBcGlDbGllbnQgYXMgYW55KTtcblxuICAgICAgY29uc3QgaW5zaWdodHMgPSBhd2FpdCBjb25uZWN0b3IuZ2V0SW5zaWdodHMoJ3Rlc3QtdmlkZW8taWQnKTtcblxuICAgICAgZXhwZWN0KGluc2lnaHRzLnZpZXdzKS50b0JlKDUwMDApO1xuICAgICAgZXhwZWN0KGluc2lnaHRzLmxpa2VzKS50b0JlKDUwMCk7XG4gICAgICBleHBlY3QoaW5zaWdodHMuY29tbWVudHMpLnRvQmUoNTApO1xuICAgICAgZXhwZWN0KGluc2lnaHRzLnNoYXJlcykudG9CZSgyNSk7XG4gICAgICBleHBlY3QoaW5zaWdodHMuc2F2ZXMpLnRvQmUoMTAwKTtcbiAgICAgIGV4cGVjdChpbnNpZ2h0cy5jb21wbGV0aW9uUmF0ZSkudG9CZSgwLjc1KTtcbiAgICAgIGV4cGVjdChpbnNpZ2h0cy5lbmdhZ2VtZW50KS50b0JlKDY3NSk7IC8vIHN1bSBvZiBsaWtlcywgY29tbWVudHMsIHNoYXJlcywgc2F2ZXNcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2RlbGV0ZUNvbnRlbnQnLCAoKSA9PiB7XG4gICAgYmVmb3JlRWFjaChhc3luYyAoKSA9PiB7XG4gICAgICBzZWNyZXRzTWFuYWdlck1vY2sub24oR2V0U2VjcmV0VmFsdWVDb21tYW5kKS5yZXNvbHZlcyh7XG4gICAgICAgIFNlY3JldFN0cmluZzogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGFjY2Vzc1Rva2VuOiAndGVzdC1hY2Nlc3MtdG9rZW4nLFxuICAgICAgICB9KSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBpbmRpY2F0ZSB0aGF0IGRlbGV0aW9uIGlzIG5vdCBzdXBwb3J0ZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQXBpQ2xpZW50ID0ge1xuICAgICAgICBnZXQ6IGplc3QuZm4oKSxcbiAgICAgIH07XG4gICAgICBtb2NrZWRBeGlvcy5jcmVhdGUubW9ja1JldHVyblZhbHVlKG1vY2tBcGlDbGllbnQgYXMgYW55KTtcblxuICAgICAgYXdhaXQgZXhwZWN0KGNvbm5lY3Rvci5kZWxldGVDb250ZW50KCd0ZXN0LXBvc3QtaWQnKSkucmVqZWN0cy50b1Rocm93KFxuICAgICAgICAnVGlrVG9rIEFQSSBkb2VzIG5vdCBzdXBwb3J0IGNvbnRlbnQgZGVsZXRpb24nXG4gICAgICApO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgndG9rZW4gcmVmcmVzaCcsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJlZnJlc2ggYWNjZXNzIHRva2VuIHdoZW4gZXhwaXJlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIHNlY3JldHNNYW5hZ2VyTW9jay5vbihHZXRTZWNyZXRWYWx1ZUNvbW1hbmQpLnJlc29sdmVzKHtcbiAgICAgICAgU2VjcmV0U3RyaW5nOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgYWNjZXNzVG9rZW46ICdleHBpcmVkLXRva2VuJyxcbiAgICAgICAgICByZWZyZXNoVG9rZW46ICdyZWZyZXNoLXRva2VuJyxcbiAgICAgICAgICBjbGllbnRJZDogJ3Rlc3QtY2xpZW50LWlkJyxcbiAgICAgICAgICBjbGllbnRTZWNyZXQ6ICd0ZXN0LWNsaWVudC1zZWNyZXQnLFxuICAgICAgICAgIGV4cGlyZXNBdDogbmV3IERhdGUoRGF0ZS5ub3coKSAtIDM2MDAwMDApLnRvSVNPU3RyaW5nKCksIC8vIEV4cGlyZWQgMSBob3VyIGFnb1xuICAgICAgICB9KSxcbiAgICAgIH0pO1xuXG4gICAgICBtb2NrZWRBeGlvcy5wb3N0Lm1vY2tSZXNvbHZlZFZhbHVlKHtcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIGFjY2Vzc190b2tlbjogJ25ldy1hY2Nlc3MtdG9rZW4nLFxuICAgICAgICAgIHJlZnJlc2hfdG9rZW46ICduZXctcmVmcmVzaC10b2tlbicsXG4gICAgICAgICAgZXhwaXJlc19pbjogODY0MDAsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgbW9ja0FwaUNsaWVudCA9IHtcbiAgICAgICAgZ2V0OiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgdXNlcjoge1xuICAgICAgICAgICAgICAgIG9wZW5faWQ6ICd0ZXN0LW9wZW4taWQnLFxuICAgICAgICAgICAgICAgIGRpc3BsYXlfbmFtZTogJ1Rlc3QgVXNlcicsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgfTtcbiAgICAgIG1vY2tlZEF4aW9zLmNyZWF0ZS5tb2NrUmV0dXJuVmFsdWUobW9ja0FwaUNsaWVudCBhcyBhbnkpO1xuXG4gICAgICBhd2FpdCBjb25uZWN0b3IuYXV0aGVudGljYXRlKCk7XG5cbiAgICAgIGV4cGVjdChtb2NrZWRBeGlvcy5wb3N0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgJ2h0dHBzOi8vb3Blbi50aWt0b2thcGlzLmNvbS92Mi9vYXV0aC90b2tlbi8nLFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgZ3JhbnRfdHlwZTogJ3JlZnJlc2hfdG9rZW4nLFxuICAgICAgICAgIHJlZnJlc2hfdG9rZW46ICdyZWZyZXNoLXRva2VuJyxcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdyYXRlIGxpbWl0aW5nJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaWRlbnRpZnkgcmF0ZSBsaW1pdCBlcnJvcnMgYXMgcmV0cnlhYmxlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgc2VjcmV0c01hbmFnZXJNb2NrLm9uKEdldFNlY3JldFZhbHVlQ29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBTZWNyZXRTdHJpbmc6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBhY2Nlc3NUb2tlbjogJ3Rlc3QtYWNjZXNzLXRva2VuJyxcbiAgICAgICAgfSksXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgbW9ja0FwaUNsaWVudCA9IHtcbiAgICAgICAgZ2V0OiBqZXN0LmZuKCkubW9ja1JlamVjdGVkVmFsdWUoe1xuICAgICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgICBzdGF0dXM6IDQyOSxcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgZXJyb3I6IHtcbiAgICAgICAgICAgICAgICBjb2RlOiAncmF0ZV9saW1pdF9leGNlZWRlZCcsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogJ1RvbyBtYW55IHJlcXVlc3RzJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgICAgIHBvc3Q6IGplc3QuZm4oKSxcbiAgICAgIH07XG4gICAgICBtb2NrZWRBeGlvcy5jcmVhdGUubW9ja1JldHVyblZhbHVlKG1vY2tBcGlDbGllbnQgYXMgYW55KTtcblxuICAgICAgY29uc3QgY29udGVudCA9IHtcbiAgICAgICAgY29udGVudElkOiAndGVzdC12aWRlby0xJyxcbiAgICAgICAgY2FwdGlvbjogJ1Rlc3QnLFxuICAgICAgICB2aWRlb1VybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vdmlkZW8ubXA0JyxcbiAgICAgICAgbWVkaWFUeXBlOiAndmlkZW8nIGFzIGNvbnN0LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY29ubmVjdG9yLnB1Ymxpc2hDb250ZW50KGNvbnRlbnQpO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnN1Y2Nlc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcj8ucmV0cnlhYmxlKS50b0JlKHRydWUpO1xuICAgIH0pO1xuICB9KTtcbn0pOyJdfQ==