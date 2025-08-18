"use strict";
/**
 * YouTube Connector Unit Tests
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const youtube_connector_1 = require("../../../lib/lambda/platform-connectors/youtube-connector");
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
describe('YouTubeConnector', () => {
    let connector;
    beforeEach(() => {
        jest.clearAllMocks();
        secretsManagerMock.reset();
        connector = new youtube_connector_1.YouTubeConnector();
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
                        items: [{
                                id: 'test-channel-id',
                                snippet: {
                                    title: 'Test Channel',
                                },
                                statistics: {
                                    subscriberCount: '100000',
                                },
                            }],
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            await connector.authenticate();
            expect(mockedAxios.create).toHaveBeenCalledTimes(2); // API client and Analytics client
            expect(mockApiClient.get).toHaveBeenCalledWith('/channels', {
                params: {
                    part: 'snippet,statistics',
                    mine: true,
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
                get: jest.fn().mockRejectedValue(new Error('Invalid credentials')),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            await expect(connector.authenticate()).rejects.toThrow('Failed to authenticate with YouTube');
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
                        items: [{
                                id: 'test-channel-id',
                                snippet: { title: 'Test Channel' },
                                statistics: { subscriberCount: '100000' },
                            }],
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
        });
        it('should publish video content successfully', async () => {
            const mockApiClient = {
                get: jest.fn()
                    .mockResolvedValueOnce({
                    data: {
                        items: [{
                                id: 'test-channel-id',
                                snippet: { title: 'Test Channel' },
                                statistics: { subscriberCount: '100000' },
                            }],
                    },
                })
                    .mockResolvedValueOnce({
                    data: {
                        items: [{
                                status: {
                                    uploadStatus: 'processed',
                                },
                            }],
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            // Mock resumable upload initialization
            mockedAxios.post.mockResolvedValueOnce({
                headers: {
                    location: 'https://upload.youtube.com/resumable/upload/123',
                },
                data: {},
            });
            // Mock video upload
            mockedAxios.get.mockResolvedValueOnce({
                data: Buffer.from('video-content'),
            });
            mockedAxios.put.mockResolvedValueOnce({
                data: {
                    id: 'youtube-video-id',
                },
            });
            const content = {
                contentId: 'test-video-1',
                caption: 'Test YouTube video',
                hashtags: ['youtube', 'test'],
                videoUrl: 'https://example.com/video.mp4',
                mediaType: 'video',
            };
            const result = await connector.publishContent(content);
            expect(result.success).toBe(true);
            expect(result.platformPostId).toBe('youtube-video-id');
            expect(result.platformUrl).toBe('https://www.youtube.com/watch?v=youtube-video-id');
            expect(result.publishedAt).toBeDefined();
            // Verify video metadata
            expect(mockedAxios.post).toHaveBeenCalledWith('https://www.googleapis.com/upload/youtube/v3/videos', expect.objectContaining({
                snippet: expect.objectContaining({
                    title: expect.stringContaining('Test YouTube video'),
                    description: expect.stringContaining('#youtube #test'),
                    tags: expect.arrayContaining(['youtube', 'test']),
                }),
                status: expect.objectContaining({
                    privacyStatus: 'public',
                }),
            }), expect.objectContaining({
                params: {
                    part: 'snippet,status',
                    uploadType: 'resumable',
                },
            }));
        });
        it('should publish YouTube Shorts with proper formatting', async () => {
            const mockApiClient = {
                get: jest.fn()
                    .mockResolvedValueOnce({
                    data: {
                        items: [{
                                id: 'test-channel-id',
                                snippet: { title: 'Test Channel' },
                                statistics: { subscriberCount: '100000' },
                            }],
                    },
                })
                    .mockResolvedValueOnce({
                    data: {
                        items: [{
                                status: {
                                    uploadStatus: 'processed',
                                },
                            }],
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            mockedAxios.post.mockResolvedValueOnce({
                headers: {
                    location: 'https://upload.youtube.com/resumable/upload/456',
                },
                data: {},
            });
            mockedAxios.get.mockResolvedValueOnce({
                data: Buffer.from('short-video-content'),
            });
            mockedAxios.put.mockResolvedValueOnce({
                data: {
                    id: 'youtube-short-id',
                },
            });
            const content = {
                contentId: 'test-short-1',
                caption: 'Test YouTube Short',
                hashtags: ['shorts'],
                videoUrl: 'https://example.com/short.mp4',
                mediaType: 'video',
                duration: 45,
                aspectRatio: '9:16', // Vertical video
            };
            const result = await connector.publishContent(content);
            expect(result.success).toBe(true);
            // Verify #Shorts tag was added
            expect(mockedAxios.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                snippet: expect.objectContaining({
                    title: expect.stringContaining('#Shorts'),
                    tags: expect.arrayContaining(['Shorts']),
                }),
            }), expect.any(Object));
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
            expect(result.error?.message).toContain('YouTube only supports video content');
        });
        it('should set custom thumbnail when provided', async () => {
            const mockApiClient = {
                get: jest.fn()
                    .mockResolvedValueOnce({
                    data: {
                        items: [{
                                id: 'test-channel-id',
                                snippet: { title: 'Test Channel' },
                                statistics: { subscriberCount: '100000' },
                            }],
                    },
                })
                    .mockResolvedValueOnce({
                    data: {
                        items: [{
                                status: {
                                    uploadStatus: 'processed',
                                },
                            }],
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            mockedAxios.post.mockResolvedValueOnce({
                headers: {
                    location: 'https://upload.youtube.com/resumable/upload/789',
                },
                data: {},
            });
            mockedAxios.get
                .mockResolvedValueOnce({
                data: Buffer.from('video-content'),
            })
                .mockResolvedValueOnce({
                data: Buffer.from('thumbnail-content'),
            });
            mockedAxios.put.mockResolvedValueOnce({
                data: {
                    id: 'youtube-video-with-thumb',
                },
            });
            mockedAxios.post.mockResolvedValueOnce({
                data: { success: true },
            });
            const content = {
                contentId: 'test-video-2',
                caption: 'Video with thumbnail',
                videoUrl: 'https://example.com/video.mp4',
                thumbnailUrl: 'https://example.com/thumbnail.jpg',
                mediaType: 'video',
            };
            const result = await connector.publishContent(content);
            expect(result.success).toBe(true);
            // Verify thumbnail upload
            expect(mockedAxios.post).toHaveBeenCalledWith('https://www.googleapis.com/upload/youtube/v3/thumbnails/set', expect.any(Buffer), expect.objectContaining({
                params: {
                    videoId: 'youtube-video-with-thumb',
                },
            }));
        });
        it('should handle processing timeout', async () => {
            const mockApiClient = {
                get: jest.fn()
                    .mockResolvedValueOnce({
                    data: {
                        items: [{
                                id: 'test-channel-id',
                                snippet: { title: 'Test Channel' },
                                statistics: { subscriberCount: '100000' },
                            }],
                    },
                })
                    .mockResolvedValue({
                    data: {
                        items: [{
                                status: {
                                    uploadStatus: 'processing',
                                },
                                processingDetails: {
                                    processingProgress: {
                                        partsProcessed: 50,
                                        partsTotal: 100,
                                        timeLeftMs: 5000,
                                    },
                                },
                            }],
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            mockedAxios.post.mockResolvedValueOnce({
                headers: {
                    location: 'https://upload.youtube.com/resumable/upload/timeout',
                },
                data: {},
            });
            mockedAxios.get.mockResolvedValueOnce({
                data: Buffer.from('video-content'),
            });
            mockedAxios.put.mockResolvedValueOnce({
                data: {
                    id: 'youtube-video-timeout',
                },
            });
            // Mock setTimeout to speed up test
            jest.useFakeTimers();
            const content = {
                contentId: 'test-video-timeout',
                caption: 'Timeout test',
                videoUrl: 'https://example.com/video.mp4',
                mediaType: 'video',
            };
            const resultPromise = connector.publishContent(content);
            // Fast-forward time to trigger timeout
            jest.advanceTimersByTime(310000); // 310 seconds
            const result = await resultPromise;
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('timeout');
            jest.useRealTimers();
        });
    });
    describe('getInsights', () => {
        beforeEach(async () => {
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'test-access-token',
                    accountId: 'test-channel-id',
                }),
            });
        });
        it('should retrieve video insights successfully', async () => {
            const mockApiClient = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        items: [{
                                statistics: {
                                    viewCount: '10000',
                                    likeCount: '500',
                                    commentCount: '50',
                                    dislikeCount: '10',
                                    favoriteCount: '100',
                                },
                            }],
                    },
                }),
            };
            const mockAnalyticsClient = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        rows: [['test-video-id', 10000, 1500, 180, 75]],
                    },
                }),
            };
            mockedAxios.create
                .mockReturnValueOnce(mockApiClient)
                .mockReturnValueOnce(mockAnalyticsClient);
            const insights = await connector.getInsights('test-video-id');
            expect(insights.views).toBe(10000);
            expect(insights.likes).toBe(500);
            expect(insights.comments).toBe(50);
            expect(insights.engagement).toBe(550); // likes + comments
            expect(insights.completionRate).toBe(75); // from analytics
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
        it('should delete video successfully', async () => {
            const mockApiClient = {
                delete: jest.fn().mockResolvedValue({ data: { success: true } }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            await connector.deleteContent('test-video-id');
            expect(mockApiClient.delete).toHaveBeenCalledWith('/videos', {
                params: {
                    id: 'test-video-id',
                },
            });
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
                    expires_in: 3600,
                },
            });
            const mockApiClient = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        items: [{
                                id: 'test-channel-id',
                                snippet: { title: 'Test Channel' },
                                statistics: { subscriberCount: '100000' },
                            }],
                    },
                }),
            };
            mockedAxios.create.mockReturnValue(mockApiClient);
            await connector.authenticate();
            expect(mockedAxios.post).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.objectContaining({
                grant_type: 'refresh_token',
                refresh_token: 'refresh-token',
            }));
        });
    });
    describe('rate limiting', () => {
        it('should identify quota exceeded errors as retryable', async () => {
            secretsManagerMock.on(client_secrets_manager_1.GetSecretValueCommand).resolves({
                SecretString: JSON.stringify({
                    accessToken: 'test-access-token',
                }),
            });
            const mockApiClient = {
                get: jest.fn().mockRejectedValue({
                    response: {
                        status: 403,
                        data: {
                            error: {
                                errors: [{
                                        reason: 'quotaExceeded',
                                    }],
                            },
                        },
                    },
                }),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoieW91dHViZS1jb25uZWN0b3IudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInlvdXR1YmUtY29ubmVjdG9yLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOztHQUVHOzs7OztBQUVILGlHQUE2RjtBQUM3RixrREFBMEI7QUFDMUIsNEVBQThGO0FBQzlGLDZEQUFpRDtBQUVqRCxlQUFlO0FBQ2YsTUFBTSxrQkFBa0IsR0FBRyxJQUFBLGdDQUFVLEVBQUMsNkNBQW9CLENBQUMsQ0FBQztBQUU1RCxhQUFhO0FBQ2IsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUNuQixNQUFNLFdBQVcsR0FBRyxlQUFrQyxDQUFDO0FBRXZELGNBQWM7QUFDZCxJQUFJLENBQUMsSUFBSSxDQUFDLCtCQUErQixFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDaEQsTUFBTSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQzFDLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQ2YsS0FBSyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDaEIsSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDZiwwQkFBMEIsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO0tBQ3RDLENBQUMsQ0FBQztDQUNKLENBQUMsQ0FBQyxDQUFDO0FBRUosZUFBZTtBQUNmLElBQUksQ0FBQyxJQUFJLENBQUMsZ0NBQWdDLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUNqRCxPQUFPLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFDM0MsU0FBUyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDcEIsb0JBQW9CLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtLQUNoQyxDQUFDLENBQUM7SUFDSCxV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QUFlO3FDQUN4QixDQUFDOzZCQUNIO3lCQUNGO3FCQUNGO2lCQUNGLENBQUM7YUFDSCxDQUFDO1lBQ0YsV0FBVyxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsYUFBb0IsQ0FBQyxDQUFDO1lBRXpELE1BQU0sT0FBTyxHQUFHO2dCQUNkLFNBQVMsRUFBRSxjQUFjO2dCQUN6QixPQUFPLEVBQUUsTUFBTTtnQkFDZixRQUFRLEVBQUUsK0JBQStCO2dCQUN6QyxTQUFTLEVBQUUsT0FBZ0I7YUFDNUIsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUV2RCxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNuQyxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDN0MsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBZb3VUdWJlIENvbm5lY3RvciBVbml0IFRlc3RzXG4gKi9cblxuaW1wb3J0IHsgWW91VHViZUNvbm5lY3RvciB9IGZyb20gJy4uLy4uLy4uL2xpYi9sYW1iZGEvcGxhdGZvcm0tY29ubmVjdG9ycy95b3V0dWJlLWNvbm5lY3Rvcic7XG5pbXBvcnQgYXhpb3MgZnJvbSAnYXhpb3MnO1xuaW1wb3J0IHsgU2VjcmV0c01hbmFnZXJDbGllbnQsIEdldFNlY3JldFZhbHVlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zZWNyZXRzLW1hbmFnZXInO1xuaW1wb3J0IHsgbW9ja0NsaWVudCB9IGZyb20gJ2F3cy1zZGstY2xpZW50LW1vY2snO1xuXG4vLyBNb2NrIEFXUyBTREtcbmNvbnN0IHNlY3JldHNNYW5hZ2VyTW9jayA9IG1vY2tDbGllbnQoU2VjcmV0c01hbmFnZXJDbGllbnQpO1xuXG4vLyBNb2NrIGF4aW9zXG5qZXN0Lm1vY2soJ2F4aW9zJyk7XG5jb25zdCBtb2NrZWRBeGlvcyA9IGF4aW9zIGFzIGplc3QuTW9ja2VkPHR5cGVvZiBheGlvcz47XG5cbi8vIE1vY2sgbG9nZ2VyXG5qZXN0Lm1vY2soJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbG9nZ2VyJywgKCkgPT4gKHtcbiAgTG9nZ2VyOiBqZXN0LmZuKCkubW9ja0ltcGxlbWVudGF0aW9uKCgpID0+ICh7XG4gICAgaW5mbzogamVzdC5mbigpLFxuICAgIGVycm9yOiBqZXN0LmZuKCksXG4gICAgd2FybjogamVzdC5mbigpLFxuICAgIGFkZFBlcnNpc3RlbnRMb2dBdHRyaWJ1dGVzOiBqZXN0LmZuKCksXG4gIH0pKSxcbn0pKTtcblxuLy8gTW9jayBtZXRyaWNzXG5qZXN0Lm1vY2soJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbWV0cmljcycsICgpID0+ICh7XG4gIE1ldHJpY3M6IGplc3QuZm4oKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4gKHtcbiAgICBhZGRNZXRyaWM6IGplc3QuZm4oKSxcbiAgICBwdWJsaXNoU3RvcmVkTWV0cmljczogamVzdC5mbigpLFxuICB9KSksXG4gIE1ldHJpY1VuaXQ6IHtcbiAgICBDb3VudDogJ0NvdW50JyxcbiAgICBNaWxsaXNlY29uZHM6ICdNaWxsaXNlY29uZHMnLFxuICB9LFxufSkpO1xuXG4vLyBNb2NrIHRyYWNlclxuamVzdC5tb2NrKCdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL3RyYWNlcicsICgpID0+ICh7XG4gIFRyYWNlcjogamVzdC5mbigpLm1vY2tJbXBsZW1lbnRhdGlvbigoKSA9PiAoe1xuICAgIGNhcHR1cmVBV1N2M0NsaWVudDogamVzdC5mbigoY2xpZW50KSA9PiBjbGllbnQpLFxuICB9KSksXG59KSk7XG5cbmRlc2NyaWJlKCdZb3VUdWJlQ29ubmVjdG9yJywgKCkgPT4ge1xuICBsZXQgY29ubmVjdG9yOiBZb3VUdWJlQ29ubmVjdG9yO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xuICAgIHNlY3JldHNNYW5hZ2VyTW9jay5yZXNldCgpO1xuICAgIGNvbm5lY3RvciA9IG5ldyBZb3VUdWJlQ29ubmVjdG9yKCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdhdXRoZW50aWNhdGUnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBhdXRoZW50aWNhdGUgc3VjY2Vzc2Z1bGx5IHdpdGggdmFsaWQgY3JlZGVudGlhbHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBNb2NrIFNlY3JldHMgTWFuYWdlclxuICAgICAgc2VjcmV0c01hbmFnZXJNb2NrLm9uKEdldFNlY3JldFZhbHVlQ29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBTZWNyZXRTdHJpbmc6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBhY2Nlc3NUb2tlbjogJ3Rlc3QtYWNjZXNzLXRva2VuJyxcbiAgICAgICAgICBjbGllbnRJZDogJ3Rlc3QtY2xpZW50LWlkJyxcbiAgICAgICAgICBjbGllbnRTZWNyZXQ6ICd0ZXN0LWNsaWVudC1zZWNyZXQnLFxuICAgICAgICB9KSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBNb2NrIEFQSSBjbGllbnRcbiAgICAgIGNvbnN0IG1vY2tBcGlDbGllbnQgPSB7XG4gICAgICAgIGdldDogamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHtcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICBpdGVtczogW3tcbiAgICAgICAgICAgICAgaWQ6ICd0ZXN0LWNoYW5uZWwtaWQnLFxuICAgICAgICAgICAgICBzbmlwcGV0OiB7XG4gICAgICAgICAgICAgICAgdGl0bGU6ICdUZXN0IENoYW5uZWwnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBzdGF0aXN0aWNzOiB7XG4gICAgICAgICAgICAgICAgc3Vic2NyaWJlckNvdW50OiAnMTAwMDAwJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH1dLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgfTtcbiAgICAgIG1vY2tlZEF4aW9zLmNyZWF0ZS5tb2NrUmV0dXJuVmFsdWUobW9ja0FwaUNsaWVudCBhcyBhbnkpO1xuXG4gICAgICBhd2FpdCBjb25uZWN0b3IuYXV0aGVudGljYXRlKCk7XG5cbiAgICAgIGV4cGVjdChtb2NrZWRBeGlvcy5jcmVhdGUpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygyKTsgLy8gQVBJIGNsaWVudCBhbmQgQW5hbHl0aWNzIGNsaWVudFxuICAgICAgXG4gICAgICBleHBlY3QobW9ja0FwaUNsaWVudC5nZXQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKCcvY2hhbm5lbHMnLCB7XG4gICAgICAgIHBhcmFtczoge1xuICAgICAgICAgIHBhcnQ6ICdzbmlwcGV0LHN0YXRpc3RpY3MnLFxuICAgICAgICAgIG1pbmU6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdGhyb3cgZXJyb3Igd2hlbiBhdXRoZW50aWNhdGlvbiBmYWlscycsIGFzeW5jICgpID0+IHtcbiAgICAgIHNlY3JldHNNYW5hZ2VyTW9jay5vbihHZXRTZWNyZXRWYWx1ZUNvbW1hbmQpLnJlc29sdmVzKHtcbiAgICAgICAgU2VjcmV0U3RyaW5nOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgYWNjZXNzVG9rZW46ICdpbnZhbGlkLXRva2VuJyxcbiAgICAgICAgfSksXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgbW9ja0FwaUNsaWVudCA9IHtcbiAgICAgICAgZ2V0OiBqZXN0LmZuKCkubW9ja1JlamVjdGVkVmFsdWUobmV3IEVycm9yKCdJbnZhbGlkIGNyZWRlbnRpYWxzJykpLFxuICAgICAgfTtcbiAgICAgIG1vY2tlZEF4aW9zLmNyZWF0ZS5tb2NrUmV0dXJuVmFsdWUobW9ja0FwaUNsaWVudCBhcyBhbnkpO1xuXG4gICAgICBhd2FpdCBleHBlY3QoY29ubmVjdG9yLmF1dGhlbnRpY2F0ZSgpKS5yZWplY3RzLnRvVGhyb3coJ0ZhaWxlZCB0byBhdXRoZW50aWNhdGUgd2l0aCBZb3VUdWJlJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdwdWJsaXNoQ29udGVudCcsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFNldHVwIGF1dGhlbnRpY2F0ZWQgY29ubmVjdG9yXG4gICAgICBzZWNyZXRzTWFuYWdlck1vY2sub24oR2V0U2VjcmV0VmFsdWVDb21tYW5kKS5yZXNvbHZlcyh7XG4gICAgICAgIFNlY3JldFN0cmluZzogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGFjY2Vzc1Rva2VuOiAndGVzdC1hY2Nlc3MtdG9rZW4nLFxuICAgICAgICAgIGNsaWVudElkOiAndGVzdC1jbGllbnQtaWQnLFxuICAgICAgICAgIGNsaWVudFNlY3JldDogJ3Rlc3QtY2xpZW50LXNlY3JldCcsXG4gICAgICAgIH0pLFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IG1vY2tBcGlDbGllbnQgPSB7XG4gICAgICAgIGdldDogamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHtcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICBpdGVtczogW3tcbiAgICAgICAgICAgICAgaWQ6ICd0ZXN0LWNoYW5uZWwtaWQnLFxuICAgICAgICAgICAgICBzbmlwcGV0OiB7IHRpdGxlOiAnVGVzdCBDaGFubmVsJyB9LFxuICAgICAgICAgICAgICBzdGF0aXN0aWNzOiB7IHN1YnNjcmliZXJDb3VudDogJzEwMDAwMCcgfSxcbiAgICAgICAgICAgIH1dLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgfTtcbiAgICAgIG1vY2tlZEF4aW9zLmNyZWF0ZS5tb2NrUmV0dXJuVmFsdWUobW9ja0FwaUNsaWVudCBhcyBhbnkpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwdWJsaXNoIHZpZGVvIGNvbnRlbnQgc3VjY2Vzc2Z1bGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FwaUNsaWVudCA9IHtcbiAgICAgICAgZ2V0OiBqZXN0LmZuKClcbiAgICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgaXRlbXM6IFt7XG4gICAgICAgICAgICAgICAgaWQ6ICd0ZXN0LWNoYW5uZWwtaWQnLFxuICAgICAgICAgICAgICAgIHNuaXBwZXQ6IHsgdGl0bGU6ICdUZXN0IENoYW5uZWwnIH0sXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljczogeyBzdWJzY3JpYmVyQ291bnQ6ICcxMDAwMDAnIH0sXG4gICAgICAgICAgICAgIH1dLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICBpdGVtczogW3tcbiAgICAgICAgICAgICAgICBzdGF0dXM6IHtcbiAgICAgICAgICAgICAgICAgIHVwbG9hZFN0YXR1czogJ3Byb2Nlc3NlZCcsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfV0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pLFxuICAgICAgfTtcbiAgICAgIG1vY2tlZEF4aW9zLmNyZWF0ZS5tb2NrUmV0dXJuVmFsdWUobW9ja0FwaUNsaWVudCBhcyBhbnkpO1xuXG4gICAgICAvLyBNb2NrIHJlc3VtYWJsZSB1cGxvYWQgaW5pdGlhbGl6YXRpb25cbiAgICAgIG1vY2tlZEF4aW9zLnBvc3QubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgIGxvY2F0aW9uOiAnaHR0cHM6Ly91cGxvYWQueW91dHViZS5jb20vcmVzdW1hYmxlL3VwbG9hZC8xMjMnLFxuICAgICAgICB9LFxuICAgICAgICBkYXRhOiB7fSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBNb2NrIHZpZGVvIHVwbG9hZFxuICAgICAgbW9ja2VkQXhpb3MuZ2V0Lm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XG4gICAgICAgIGRhdGE6IEJ1ZmZlci5mcm9tKCd2aWRlby1jb250ZW50JyksXG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgbW9ja2VkQXhpb3MucHV0Lm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBpZDogJ3lvdXR1YmUtdmlkZW8taWQnLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSB7XG4gICAgICAgIGNvbnRlbnRJZDogJ3Rlc3QtdmlkZW8tMScsXG4gICAgICAgIGNhcHRpb246ICdUZXN0IFlvdVR1YmUgdmlkZW8nLFxuICAgICAgICBoYXNodGFnczogWyd5b3V0dWJlJywgJ3Rlc3QnXSxcbiAgICAgICAgdmlkZW9Vcmw6ICdodHRwczovL2V4YW1wbGUuY29tL3ZpZGVvLm1wNCcsXG4gICAgICAgIG1lZGlhVHlwZTogJ3ZpZGVvJyBhcyBjb25zdCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbm5lY3Rvci5wdWJsaXNoQ29udGVudChjb250ZW50KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5zdWNjZXNzKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wbGF0Zm9ybVBvc3RJZCkudG9CZSgneW91dHViZS12aWRlby1pZCcpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wbGF0Zm9ybVVybCkudG9CZSgnaHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj15b3V0dWJlLXZpZGVvLWlkJyk7XG4gICAgICBleHBlY3QocmVzdWx0LnB1Ymxpc2hlZEF0KS50b0JlRGVmaW5lZCgpO1xuXG4gICAgICAvLyBWZXJpZnkgdmlkZW8gbWV0YWRhdGFcbiAgICAgIGV4cGVjdChtb2NrZWRBeGlvcy5wb3N0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgJ2h0dHBzOi8vd3d3Lmdvb2dsZWFwaXMuY29tL3VwbG9hZC95b3V0dWJlL3YzL3ZpZGVvcycsXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBzbmlwcGV0OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICB0aXRsZTogZXhwZWN0LnN0cmluZ0NvbnRhaW5pbmcoJ1Rlc3QgWW91VHViZSB2aWRlbycpLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IGV4cGVjdC5zdHJpbmdDb250YWluaW5nKCcjeW91dHViZSAjdGVzdCcpLFxuICAgICAgICAgICAgdGFnczogZXhwZWN0LmFycmF5Q29udGFpbmluZyhbJ3lvdXR1YmUnLCAndGVzdCddKSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBzdGF0dXM6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICAgIHByaXZhY3lTdGF0dXM6ICdwdWJsaWMnLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9KSxcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgIHBhcmFtczoge1xuICAgICAgICAgICAgcGFydDogJ3NuaXBwZXQsc3RhdHVzJyxcbiAgICAgICAgICAgIHVwbG9hZFR5cGU6ICdyZXN1bWFibGUnLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwdWJsaXNoIFlvdVR1YmUgU2hvcnRzIHdpdGggcHJvcGVyIGZvcm1hdHRpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQXBpQ2xpZW50ID0ge1xuICAgICAgICBnZXQ6IGplc3QuZm4oKVxuICAgICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICBpdGVtczogW3tcbiAgICAgICAgICAgICAgICBpZDogJ3Rlc3QtY2hhbm5lbC1pZCcsXG4gICAgICAgICAgICAgICAgc25pcHBldDogeyB0aXRsZTogJ1Rlc3QgQ2hhbm5lbCcgfSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWNzOiB7IHN1YnNjcmliZXJDb3VudDogJzEwMDAwMCcgfSxcbiAgICAgICAgICAgICAgfV0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pXG4gICAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIGl0ZW1zOiBbe1xuICAgICAgICAgICAgICAgIHN0YXR1czoge1xuICAgICAgICAgICAgICAgICAgdXBsb2FkU3RhdHVzOiAncHJvY2Vzc2VkJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9XSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSksXG4gICAgICB9O1xuICAgICAgbW9ja2VkQXhpb3MuY3JlYXRlLm1vY2tSZXR1cm5WYWx1ZShtb2NrQXBpQ2xpZW50IGFzIGFueSk7XG5cbiAgICAgIG1vY2tlZEF4aW9zLnBvc3QubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgIGxvY2F0aW9uOiAnaHR0cHM6Ly91cGxvYWQueW91dHViZS5jb20vcmVzdW1hYmxlL3VwbG9hZC80NTYnLFxuICAgICAgICB9LFxuICAgICAgICBkYXRhOiB7fSxcbiAgICAgIH0pO1xuXG4gICAgICBtb2NrZWRBeGlvcy5nZXQubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgZGF0YTogQnVmZmVyLmZyb20oJ3Nob3J0LXZpZGVvLWNvbnRlbnQnKSxcbiAgICAgIH0pO1xuICAgICAgXG4gICAgICBtb2NrZWRBeGlvcy5wdXQubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIGlkOiAneW91dHViZS1zaG9ydC1pZCcsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgY29udGVudCA9IHtcbiAgICAgICAgY29udGVudElkOiAndGVzdC1zaG9ydC0xJyxcbiAgICAgICAgY2FwdGlvbjogJ1Rlc3QgWW91VHViZSBTaG9ydCcsXG4gICAgICAgIGhhc2h0YWdzOiBbJ3Nob3J0cyddLFxuICAgICAgICB2aWRlb1VybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vc2hvcnQubXA0JyxcbiAgICAgICAgbWVkaWFUeXBlOiAndmlkZW8nIGFzIGNvbnN0LFxuICAgICAgICBkdXJhdGlvbjogNDUsIC8vIExlc3MgdGhhbiA2MCBzZWNvbmRzXG4gICAgICAgIGFzcGVjdFJhdGlvOiAnOToxNicsIC8vIFZlcnRpY2FsIHZpZGVvXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjb25uZWN0b3IucHVibGlzaENvbnRlbnQoY29udGVudCk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQuc3VjY2VzcykudG9CZSh0cnVlKTtcbiAgICAgIFxuICAgICAgLy8gVmVyaWZ5ICNTaG9ydHMgdGFnIHdhcyBhZGRlZFxuICAgICAgZXhwZWN0KG1vY2tlZEF4aW9zLnBvc3QpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBleHBlY3QuYW55KFN0cmluZyksXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBzbmlwcGV0OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICB0aXRsZTogZXhwZWN0LnN0cmluZ0NvbnRhaW5pbmcoJyNTaG9ydHMnKSxcbiAgICAgICAgICAgIHRhZ3M6IGV4cGVjdC5hcnJheUNvbnRhaW5pbmcoWydTaG9ydHMnXSksXG4gICAgICAgICAgfSksXG4gICAgICAgIH0pLFxuICAgICAgICBleHBlY3QuYW55KE9iamVjdClcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJlamVjdCBub24tdmlkZW8gY29udGVudCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSB7XG4gICAgICAgIGNvbnRlbnRJZDogJ3Rlc3QtaW1hZ2UtMScsXG4gICAgICAgIGNhcHRpb246ICdUZXN0IGltYWdlJyxcbiAgICAgICAgbWVkaWFVcmw6ICdodHRwczovL2V4YW1wbGUuY29tL2ltYWdlLmpwZycsXG4gICAgICAgIG1lZGlhVHlwZTogJ2ltYWdlJyBhcyBjb25zdCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbm5lY3Rvci5wdWJsaXNoQ29udGVudChjb250ZW50KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5zdWNjZXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3I/Lm1lc3NhZ2UpLnRvQ29udGFpbignWW91VHViZSBvbmx5IHN1cHBvcnRzIHZpZGVvIGNvbnRlbnQnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgc2V0IGN1c3RvbSB0aHVtYm5haWwgd2hlbiBwcm92aWRlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBcGlDbGllbnQgPSB7XG4gICAgICAgIGdldDogamVzdC5mbigpXG4gICAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIGl0ZW1zOiBbe1xuICAgICAgICAgICAgICAgIGlkOiAndGVzdC1jaGFubmVsLWlkJyxcbiAgICAgICAgICAgICAgICBzbmlwcGV0OiB7IHRpdGxlOiAnVGVzdCBDaGFubmVsJyB9LFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpY3M6IHsgc3Vic2NyaWJlckNvdW50OiAnMTAwMDAwJyB9LFxuICAgICAgICAgICAgICB9XSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSlcbiAgICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgaXRlbXM6IFt7XG4gICAgICAgICAgICAgICAgc3RhdHVzOiB7XG4gICAgICAgICAgICAgICAgICB1cGxvYWRTdGF0dXM6ICdwcm9jZXNzZWQnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH1dLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KSxcbiAgICAgIH07XG4gICAgICBtb2NrZWRBeGlvcy5jcmVhdGUubW9ja1JldHVyblZhbHVlKG1vY2tBcGlDbGllbnQgYXMgYW55KTtcblxuICAgICAgbW9ja2VkQXhpb3MucG9zdC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgbG9jYXRpb246ICdodHRwczovL3VwbG9hZC55b3V0dWJlLmNvbS9yZXN1bWFibGUvdXBsb2FkLzc4OScsXG4gICAgICAgIH0sXG4gICAgICAgIGRhdGE6IHt9LFxuICAgICAgfSk7XG5cbiAgICAgIG1vY2tlZEF4aW9zLmdldFxuICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgICBkYXRhOiBCdWZmZXIuZnJvbSgndmlkZW8tY29udGVudCcpLFxuICAgICAgICB9KVxuICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgICBkYXRhOiBCdWZmZXIuZnJvbSgndGh1bWJuYWlsLWNvbnRlbnQnKSxcbiAgICAgICAgfSk7XG4gICAgICBcbiAgICAgIG1vY2tlZEF4aW9zLnB1dC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgaWQ6ICd5b3V0dWJlLXZpZGVvLXdpdGgtdGh1bWInLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIG1vY2tlZEF4aW9zLnBvc3QubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgZGF0YTogeyBzdWNjZXNzOiB0cnVlIH0sXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgY29udGVudCA9IHtcbiAgICAgICAgY29udGVudElkOiAndGVzdC12aWRlby0yJyxcbiAgICAgICAgY2FwdGlvbjogJ1ZpZGVvIHdpdGggdGh1bWJuYWlsJyxcbiAgICAgICAgdmlkZW9Vcmw6ICdodHRwczovL2V4YW1wbGUuY29tL3ZpZGVvLm1wNCcsXG4gICAgICAgIHRodW1ibmFpbFVybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vdGh1bWJuYWlsLmpwZycsXG4gICAgICAgIG1lZGlhVHlwZTogJ3ZpZGVvJyBhcyBjb25zdCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbm5lY3Rvci5wdWJsaXNoQ29udGVudChjb250ZW50KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5zdWNjZXNzKS50b0JlKHRydWUpO1xuICAgICAgXG4gICAgICAvLyBWZXJpZnkgdGh1bWJuYWlsIHVwbG9hZFxuICAgICAgZXhwZWN0KG1vY2tlZEF4aW9zLnBvc3QpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICAnaHR0cHM6Ly93d3cuZ29vZ2xlYXBpcy5jb20vdXBsb2FkL3lvdXR1YmUvdjMvdGh1bWJuYWlscy9zZXQnLFxuICAgICAgICBleHBlY3QuYW55KEJ1ZmZlciksXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAgIHZpZGVvSWQ6ICd5b3V0dWJlLXZpZGVvLXdpdGgtdGh1bWInLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgcHJvY2Vzc2luZyB0aW1lb3V0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FwaUNsaWVudCA9IHtcbiAgICAgICAgZ2V0OiBqZXN0LmZuKClcbiAgICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgaXRlbXM6IFt7XG4gICAgICAgICAgICAgICAgaWQ6ICd0ZXN0LWNoYW5uZWwtaWQnLFxuICAgICAgICAgICAgICAgIHNuaXBwZXQ6IHsgdGl0bGU6ICdUZXN0IENoYW5uZWwnIH0sXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljczogeyBzdWJzY3JpYmVyQ291bnQ6ICcxMDAwMDAnIH0sXG4gICAgICAgICAgICAgIH1dLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZSh7XG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIGl0ZW1zOiBbe1xuICAgICAgICAgICAgICAgIHN0YXR1czoge1xuICAgICAgICAgICAgICAgICAgdXBsb2FkU3RhdHVzOiAncHJvY2Vzc2luZycsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwcm9jZXNzaW5nRGV0YWlsczoge1xuICAgICAgICAgICAgICAgICAgcHJvY2Vzc2luZ1Byb2dyZXNzOiB7XG4gICAgICAgICAgICAgICAgICAgIHBhcnRzUHJvY2Vzc2VkOiA1MCxcbiAgICAgICAgICAgICAgICAgICAgcGFydHNUb3RhbDogMTAwLFxuICAgICAgICAgICAgICAgICAgICB0aW1lTGVmdE1zOiA1MDAwLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9XSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSksXG4gICAgICB9O1xuICAgICAgbW9ja2VkQXhpb3MuY3JlYXRlLm1vY2tSZXR1cm5WYWx1ZShtb2NrQXBpQ2xpZW50IGFzIGFueSk7XG5cbiAgICAgIG1vY2tlZEF4aW9zLnBvc3QubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgIGxvY2F0aW9uOiAnaHR0cHM6Ly91cGxvYWQueW91dHViZS5jb20vcmVzdW1hYmxlL3VwbG9hZC90aW1lb3V0JyxcbiAgICAgICAgfSxcbiAgICAgICAgZGF0YToge30sXG4gICAgICB9KTtcblxuICAgICAgbW9ja2VkQXhpb3MuZ2V0Lm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XG4gICAgICAgIGRhdGE6IEJ1ZmZlci5mcm9tKCd2aWRlby1jb250ZW50JyksXG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgbW9ja2VkQXhpb3MucHV0Lm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBpZDogJ3lvdXR1YmUtdmlkZW8tdGltZW91dCcsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gTW9jayBzZXRUaW1lb3V0IHRvIHNwZWVkIHVwIHRlc3RcbiAgICAgIGplc3QudXNlRmFrZVRpbWVycygpO1xuXG4gICAgICBjb25zdCBjb250ZW50ID0ge1xuICAgICAgICBjb250ZW50SWQ6ICd0ZXN0LXZpZGVvLXRpbWVvdXQnLFxuICAgICAgICBjYXB0aW9uOiAnVGltZW91dCB0ZXN0JyxcbiAgICAgICAgdmlkZW9Vcmw6ICdodHRwczovL2V4YW1wbGUuY29tL3ZpZGVvLm1wNCcsXG4gICAgICAgIG1lZGlhVHlwZTogJ3ZpZGVvJyBhcyBjb25zdCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdFByb21pc2UgPSBjb25uZWN0b3IucHVibGlzaENvbnRlbnQoY29udGVudCk7XG4gICAgICBcbiAgICAgIC8vIEZhc3QtZm9yd2FyZCB0aW1lIHRvIHRyaWdnZXIgdGltZW91dFxuICAgICAgamVzdC5hZHZhbmNlVGltZXJzQnlUaW1lKDMxMDAwMCk7IC8vIDMxMCBzZWNvbmRzXG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlc3VsdFByb21pc2U7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQuc3VjY2VzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9yPy5tZXNzYWdlKS50b0NvbnRhaW4oJ3RpbWVvdXQnKTtcblxuICAgICAgamVzdC51c2VSZWFsVGltZXJzKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdnZXRJbnNpZ2h0cycsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKGFzeW5jICgpID0+IHtcbiAgICAgIHNlY3JldHNNYW5hZ2VyTW9jay5vbihHZXRTZWNyZXRWYWx1ZUNvbW1hbmQpLnJlc29sdmVzKHtcbiAgICAgICAgU2VjcmV0U3RyaW5nOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgYWNjZXNzVG9rZW46ICd0ZXN0LWFjY2Vzcy10b2tlbicsXG4gICAgICAgICAgYWNjb3VudElkOiAndGVzdC1jaGFubmVsLWlkJyxcbiAgICAgICAgfSksXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0cmlldmUgdmlkZW8gaW5zaWdodHMgc3VjY2Vzc2Z1bGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FwaUNsaWVudCA9IHtcbiAgICAgICAgZ2V0OiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIGl0ZW1zOiBbe1xuICAgICAgICAgICAgICBzdGF0aXN0aWNzOiB7XG4gICAgICAgICAgICAgICAgdmlld0NvdW50OiAnMTAwMDAnLFxuICAgICAgICAgICAgICAgIGxpa2VDb3VudDogJzUwMCcsXG4gICAgICAgICAgICAgICAgY29tbWVudENvdW50OiAnNTAnLFxuICAgICAgICAgICAgICAgIGRpc2xpa2VDb3VudDogJzEwJyxcbiAgICAgICAgICAgICAgICBmYXZvcml0ZUNvdW50OiAnMTAwJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH1dLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgfTtcbiAgICAgIFxuICAgICAgY29uc3QgbW9ja0FuYWx5dGljc0NsaWVudCA9IHtcbiAgICAgICAgZ2V0OiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIHJvd3M6IFtbJ3Rlc3QtdmlkZW8taWQnLCAxMDAwMCwgMTUwMCwgMTgwLCA3NV1dLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgfTtcbiAgICAgIFxuICAgICAgbW9ja2VkQXhpb3MuY3JlYXRlXG4gICAgICAgIC5tb2NrUmV0dXJuVmFsdWVPbmNlKG1vY2tBcGlDbGllbnQgYXMgYW55KVxuICAgICAgICAubW9ja1JldHVyblZhbHVlT25jZShtb2NrQW5hbHl0aWNzQ2xpZW50IGFzIGFueSk7XG5cbiAgICAgIGNvbnN0IGluc2lnaHRzID0gYXdhaXQgY29ubmVjdG9yLmdldEluc2lnaHRzKCd0ZXN0LXZpZGVvLWlkJyk7XG5cbiAgICAgIGV4cGVjdChpbnNpZ2h0cy52aWV3cykudG9CZSgxMDAwMCk7XG4gICAgICBleHBlY3QoaW5zaWdodHMubGlrZXMpLnRvQmUoNTAwKTtcbiAgICAgIGV4cGVjdChpbnNpZ2h0cy5jb21tZW50cykudG9CZSg1MCk7XG4gICAgICBleHBlY3QoaW5zaWdodHMuZW5nYWdlbWVudCkudG9CZSg1NTApOyAvLyBsaWtlcyArIGNvbW1lbnRzXG4gICAgICBleHBlY3QoaW5zaWdodHMuY29tcGxldGlvblJhdGUpLnRvQmUoNzUpOyAvLyBmcm9tIGFuYWx5dGljc1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnZGVsZXRlQ29udGVudCcsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKGFzeW5jICgpID0+IHtcbiAgICAgIHNlY3JldHNNYW5hZ2VyTW9jay5vbihHZXRTZWNyZXRWYWx1ZUNvbW1hbmQpLnJlc29sdmVzKHtcbiAgICAgICAgU2VjcmV0U3RyaW5nOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgYWNjZXNzVG9rZW46ICd0ZXN0LWFjY2Vzcy10b2tlbicsXG4gICAgICAgIH0pLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGRlbGV0ZSB2aWRlbyBzdWNjZXNzZnVsbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQXBpQ2xpZW50ID0ge1xuICAgICAgICBkZWxldGU6IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZSh7IGRhdGE6IHsgc3VjY2VzczogdHJ1ZSB9IH0pLFxuICAgICAgfTtcbiAgICAgIG1vY2tlZEF4aW9zLmNyZWF0ZS5tb2NrUmV0dXJuVmFsdWUobW9ja0FwaUNsaWVudCBhcyBhbnkpO1xuXG4gICAgICBhd2FpdCBjb25uZWN0b3IuZGVsZXRlQ29udGVudCgndGVzdC12aWRlby1pZCcpO1xuXG4gICAgICBleHBlY3QobW9ja0FwaUNsaWVudC5kZWxldGUpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKCcvdmlkZW9zJywge1xuICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICBpZDogJ3Rlc3QtdmlkZW8taWQnLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCd0b2tlbiByZWZyZXNoJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcmVmcmVzaCBhY2Nlc3MgdG9rZW4gd2hlbiBleHBpcmVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgc2VjcmV0c01hbmFnZXJNb2NrLm9uKEdldFNlY3JldFZhbHVlQ29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBTZWNyZXRTdHJpbmc6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBhY2Nlc3NUb2tlbjogJ2V4cGlyZWQtdG9rZW4nLFxuICAgICAgICAgIHJlZnJlc2hUb2tlbjogJ3JlZnJlc2gtdG9rZW4nLFxuICAgICAgICAgIGNsaWVudElkOiAndGVzdC1jbGllbnQtaWQnLFxuICAgICAgICAgIGNsaWVudFNlY3JldDogJ3Rlc3QtY2xpZW50LXNlY3JldCcsXG4gICAgICAgICAgZXhwaXJlc0F0OiBuZXcgRGF0ZShEYXRlLm5vdygpIC0gMzYwMDAwMCkudG9JU09TdHJpbmcoKSwgLy8gRXhwaXJlZCAxIGhvdXIgYWdvXG4gICAgICAgIH0pLFxuICAgICAgfSk7XG5cbiAgICAgIG1vY2tlZEF4aW9zLnBvc3QubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgYWNjZXNzX3Rva2VuOiAnbmV3LWFjY2Vzcy10b2tlbicsXG4gICAgICAgICAgZXhwaXJlc19pbjogMzYwMCxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBtb2NrQXBpQ2xpZW50ID0ge1xuICAgICAgICBnZXQ6IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZSh7XG4gICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgaXRlbXM6IFt7XG4gICAgICAgICAgICAgIGlkOiAndGVzdC1jaGFubmVsLWlkJyxcbiAgICAgICAgICAgICAgc25pcHBldDogeyB0aXRsZTogJ1Rlc3QgQ2hhbm5lbCcgfSxcbiAgICAgICAgICAgICAgc3RhdGlzdGljczogeyBzdWJzY3JpYmVyQ291bnQ6ICcxMDAwMDAnIH0sXG4gICAgICAgICAgICB9XSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KSxcbiAgICAgIH07XG4gICAgICBtb2NrZWRBeGlvcy5jcmVhdGUubW9ja1JldHVyblZhbHVlKG1vY2tBcGlDbGllbnQgYXMgYW55KTtcblxuICAgICAgYXdhaXQgY29ubmVjdG9yLmF1dGhlbnRpY2F0ZSgpO1xuXG4gICAgICBleHBlY3QobW9ja2VkQXhpb3MucG9zdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgICdodHRwczovL29hdXRoMi5nb29nbGVhcGlzLmNvbS90b2tlbicsXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBncmFudF90eXBlOiAncmVmcmVzaF90b2tlbicsXG4gICAgICAgICAgcmVmcmVzaF90b2tlbjogJ3JlZnJlc2gtdG9rZW4nLFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3JhdGUgbGltaXRpbmcnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBpZGVudGlmeSBxdW90YSBleGNlZWRlZCBlcnJvcnMgYXMgcmV0cnlhYmxlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgc2VjcmV0c01hbmFnZXJNb2NrLm9uKEdldFNlY3JldFZhbHVlQ29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBTZWNyZXRTdHJpbmc6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBhY2Nlc3NUb2tlbjogJ3Rlc3QtYWNjZXNzLXRva2VuJyxcbiAgICAgICAgfSksXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgbW9ja0FwaUNsaWVudCA9IHtcbiAgICAgICAgZ2V0OiBqZXN0LmZuKCkubW9ja1JlamVjdGVkVmFsdWUoe1xuICAgICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgICBzdGF0dXM6IDQwMyxcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgZXJyb3I6IHtcbiAgICAgICAgICAgICAgICBlcnJvcnM6IFt7XG4gICAgICAgICAgICAgICAgICByZWFzb246ICdxdW90YUV4Y2VlZGVkJyxcbiAgICAgICAgICAgICAgICB9XSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgICB9O1xuICAgICAgbW9ja2VkQXhpb3MuY3JlYXRlLm1vY2tSZXR1cm5WYWx1ZShtb2NrQXBpQ2xpZW50IGFzIGFueSk7XG5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSB7XG4gICAgICAgIGNvbnRlbnRJZDogJ3Rlc3QtdmlkZW8tMScsXG4gICAgICAgIGNhcHRpb246ICdUZXN0JyxcbiAgICAgICAgdmlkZW9Vcmw6ICdodHRwczovL2V4YW1wbGUuY29tL3ZpZGVvLm1wNCcsXG4gICAgICAgIG1lZGlhVHlwZTogJ3ZpZGVvJyBhcyBjb25zdCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbm5lY3Rvci5wdWJsaXNoQ29udGVudChjb250ZW50KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5zdWNjZXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3I/LnJldHJ5YWJsZSkudG9CZSh0cnVlKTtcbiAgICB9KTtcbiAgfSk7XG59KTsiXX0=