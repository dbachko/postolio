"use strict";
/**
 * Platform Publisher Lambda Handler Unit Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const platform_connectors_1 = require("../../../lib/lambda/platform-connectors");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const aws_sdk_client_mock_1 = require("aws-sdk-client-mock");
const platform_connectors_2 = require("../../../lib/lambda/platform-connectors");
// Mock DynamoDB
const ddbMock = (0, aws_sdk_client_mock_1.mockClient)(lib_dynamodb_1.DynamoDBDocumentClient);
// Mock environment variables
process.env.SCHEDULES_TABLE = 'test-schedules-table';
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
        addMetadata: jest.fn(),
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
// Mock platform connectors
jest.mock('../../../lib/lambda/platform-connectors/instagram-connector');
jest.mock('../../../lib/lambda/platform-connectors/tiktok-connector');
jest.mock('../../../lib/lambda/platform-connectors/youtube-connector');
describe('Platform Publisher Lambda Handler', () => {
    let mockInstagramConnector;
    let mockTikTokConnector;
    let mockYouTubeConnector;
    beforeEach(() => {
        jest.clearAllMocks();
        ddbMock.reset();
        // Setup mock connectors
        mockInstagramConnector = {
            authenticate: jest.fn(),
            publishContent: jest.fn(),
            getInsights: jest.fn(),
            deleteContent: jest.fn(),
        };
        mockTikTokConnector = {
            authenticate: jest.fn(),
            publishContent: jest.fn(),
            getInsights: jest.fn(),
            deleteContent: jest.fn(),
        };
        mockYouTubeConnector = {
            authenticate: jest.fn(),
            publishContent: jest.fn(),
            getInsights: jest.fn(),
            deleteContent: jest.fn(),
        };
        platform_connectors_2.InstagramConnector.mockImplementation(() => mockInstagramConnector);
        platform_connectors_2.TikTokConnector.mockImplementation(() => mockTikTokConnector);
        platform_connectors_2.YouTubeConnector.mockImplementation(() => mockYouTubeConnector);
    });
    const createEvent = (detail) => ({
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ScheduledPublish',
        source: 'content.scheduler',
        account: '123456789012',
        time: new Date().toISOString(),
        region: 'us-east-1',
        resources: [],
        detail: {
            scheduleId: 'test-schedule-id',
            brandId: 'test-brand-id',
            contentId: 'test-content-id',
            platform: 'instagram',
            content: {
                contentId: 'test-content-id',
                caption: 'Test caption',
                hashtags: ['test', 'hashtag'],
                mediaUrl: 'https://example.com/image.jpg',
                mediaType: 'image',
            },
            scheduledAt: new Date().toISOString(),
            ...detail,
        },
    });
    describe('Instagram publishing', () => {
        it('should publish to Instagram successfully', async () => {
            const event = createEvent({
                platform: 'instagram',
                content: {
                    contentId: 'ig-content-1',
                    caption: 'Instagram post',
                    mediaUrl: 'https://example.com/image.jpg',
                    mediaType: 'image',
                },
            });
            // Mock DynamoDB responses
            ddbMock.on(lib_dynamodb_1.GetCommand).resolves({
                Item: {
                    scheduleId: 'test-schedule-id',
                    status: 'pending',
                    retryCount: 0,
                    lastAttemptAt: new Date().toISOString(),
                },
            });
            ddbMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            // Mock Instagram connector
            mockInstagramConnector.authenticate.mockResolvedValue();
            mockInstagramConnector.publishContent.mockResolvedValue({
                success: true,
                platformPostId: 'ig-post-123',
                platformUrl: 'https://www.instagram.com/p/abc123/',
                publishedAt: new Date().toISOString(),
            });
            await (0, platform_connectors_1.handler)(event);
            expect(mockInstagramConnector.authenticate).toHaveBeenCalled();
            expect(mockInstagramConnector.publishContent).toHaveBeenCalledWith(event.detail.content);
            // Verify status was updated to published
            expect(ddbMock.commandCalls(lib_dynamodb_1.UpdateCommand)).toHaveLength(2);
            const updateCalls = ddbMock.commandCalls(lib_dynamodb_1.UpdateCommand);
            const finalUpdate = updateCalls[1]?.args[0]?.input;
            expect(finalUpdate?.ExpressionAttributeValues?.[':status']).toBe('published');
            expect(finalUpdate?.ExpressionAttributeValues?.[':platformPostId']).toBe('ig-post-123');
            expect(finalUpdate?.ExpressionAttributeValues?.[':platformUrl']).toBe('https://www.instagram.com/p/abc123/');
        });
        it('should handle Instagram Reel publishing', async () => {
            const event = createEvent({
                platform: 'instagram',
                content: {
                    contentId: 'ig-reel-1',
                    caption: 'Instagram Reel',
                    videoUrl: 'https://example.com/video.mp4',
                    mediaType: 'video',
                },
            });
            ddbMock.on(lib_dynamodb_1.GetCommand).resolves({
                Item: {
                    scheduleId: 'test-schedule-id',
                    status: 'pending',
                    retryCount: 0,
                },
            });
            ddbMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            mockInstagramConnector.authenticate.mockResolvedValue();
            mockInstagramConnector.publishContent.mockResolvedValue({
                success: true,
                platformPostId: 'ig-reel-456',
                platformUrl: 'https://www.instagram.com/reel/def456/',
                publishedAt: new Date().toISOString(),
            });
            await (0, platform_connectors_1.handler)(event);
            expect(mockInstagramConnector.publishContent).toHaveBeenCalledWith(expect.objectContaining({
                mediaType: 'video',
                videoUrl: 'https://example.com/video.mp4',
            }));
        });
    });
    describe('TikTok publishing', () => {
        it('should publish to TikTok successfully', async () => {
            const event = createEvent({
                platform: 'tiktok',
                content: {
                    contentId: 'tt-content-1',
                    caption: 'TikTok video',
                    videoUrl: 'https://example.com/tiktok.mp4',
                    mediaType: 'video',
                },
            });
            ddbMock.on(lib_dynamodb_1.GetCommand).resolves({
                Item: {
                    scheduleId: 'test-schedule-id',
                    status: 'pending',
                    retryCount: 0,
                },
            });
            ddbMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            mockTikTokConnector.authenticate.mockResolvedValue();
            mockTikTokConnector.publishContent.mockResolvedValue({
                success: true,
                platformPostId: 'tt-post-789',
                platformUrl: 'https://www.tiktok.com/@user/video/789',
                publishedAt: new Date().toISOString(),
            });
            await (0, platform_connectors_1.handler)(event);
            expect(mockTikTokConnector.authenticate).toHaveBeenCalled();
            expect(mockTikTokConnector.publishContent).toHaveBeenCalledWith(event.detail.content);
        });
    });
    describe('YouTube publishing', () => {
        it('should publish to YouTube successfully', async () => {
            const event = createEvent({
                platform: 'youtube',
                content: {
                    contentId: 'yt-content-1',
                    caption: 'YouTube video',
                    videoUrl: 'https://example.com/youtube.mp4',
                    mediaType: 'video',
                },
            });
            ddbMock.on(lib_dynamodb_1.GetCommand).resolves({
                Item: {
                    scheduleId: 'test-schedule-id',
                    status: 'pending',
                    retryCount: 0,
                },
            });
            ddbMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            mockYouTubeConnector.authenticate.mockResolvedValue();
            mockYouTubeConnector.publishContent.mockResolvedValue({
                success: true,
                platformPostId: 'yt-video-abc',
                platformUrl: 'https://www.youtube.com/watch?v=abc',
                publishedAt: new Date().toISOString(),
            });
            await (0, platform_connectors_1.handler)(event);
            expect(mockYouTubeConnector.authenticate).toHaveBeenCalled();
            expect(mockYouTubeConnector.publishContent).toHaveBeenCalledWith(event.detail.content);
        });
        it('should handle YouTube Shorts', async () => {
            const event = createEvent({
                platform: 'youtube',
                content: {
                    contentId: 'yt-short-1',
                    caption: 'YouTube Short',
                    hashtags: ['shorts'],
                    videoUrl: 'https://example.com/short.mp4',
                    mediaType: 'video',
                    duration: 45,
                    aspectRatio: '9:16',
                },
            });
            ddbMock.on(lib_dynamodb_1.GetCommand).resolves({
                Item: {
                    scheduleId: 'test-schedule-id',
                    status: 'pending',
                    retryCount: 0,
                },
            });
            ddbMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            mockYouTubeConnector.authenticate.mockResolvedValue();
            mockYouTubeConnector.publishContent.mockResolvedValue({
                success: true,
                platformPostId: 'yt-short-xyz',
                platformUrl: 'https://www.youtube.com/shorts/xyz',
                publishedAt: new Date().toISOString(),
            });
            await (0, platform_connectors_1.handler)(event);
            expect(mockYouTubeConnector.publishContent).toHaveBeenCalledWith(expect.objectContaining({
                duration: 45,
                aspectRatio: '9:16',
            }));
        });
    });
    describe('Error handling', () => {
        it('should skip already published content', async () => {
            const event = createEvent({});
            ddbMock.on(lib_dynamodb_1.GetCommand).resolves({
                Item: {
                    scheduleId: 'test-schedule-id',
                    status: 'published',
                    platformPostId: 'already-published',
                    publishedAt: new Date().toISOString(),
                    retryCount: 0,
                },
            });
            await (0, platform_connectors_1.handler)(event);
            expect(mockInstagramConnector.publishContent).not.toHaveBeenCalled();
            expect(ddbMock.commandCalls(lib_dynamodb_1.UpdateCommand)).toHaveLength(0);
        });
        it('should handle publishing failures with retry', async () => {
            const event = createEvent({});
            ddbMock.on(lib_dynamodb_1.GetCommand).resolves({
                Item: {
                    scheduleId: 'test-schedule-id',
                    status: 'pending',
                    retryCount: 0,
                },
            });
            ddbMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            mockInstagramConnector.authenticate.mockResolvedValue();
            mockInstagramConnector.publishContent.mockResolvedValue({
                success: false,
                error: {
                    code: 'RATE_LIMIT',
                    message: 'Rate limit exceeded',
                    retryable: true,
                },
            });
            await expect((0, platform_connectors_1.handler)(event)).rejects.toThrow('Publishing failed: Rate limit exceeded');
            // Verify status was updated to retrying
            const updateCalls = ddbMock.commandCalls(lib_dynamodb_1.UpdateCommand);
            const statusUpdate = updateCalls.find(call => call?.args[0]?.input?.ExpressionAttributeValues?.[':status'] === 'retrying');
            expect(statusUpdate).toBeDefined();
        });
        it('should handle permanent failures', async () => {
            const event = createEvent({
                retryCount: 3, // Max retries reached
            });
            ddbMock.on(lib_dynamodb_1.GetCommand).resolves({
                Item: {
                    scheduleId: 'test-schedule-id',
                    status: 'retrying',
                    retryCount: 3,
                },
            });
            ddbMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            mockInstagramConnector.authenticate.mockResolvedValue();
            mockInstagramConnector.publishContent.mockResolvedValue({
                success: false,
                error: {
                    code: 'INVALID_CONTENT',
                    message: 'Content validation failed',
                    retryable: true,
                },
            });
            await (0, platform_connectors_1.handler)(event);
            // Verify status was updated to failed (not retrying)
            const updateCalls = ddbMock.commandCalls(lib_dynamodb_1.UpdateCommand);
            const finalUpdate = updateCalls[updateCalls.length - 1]?.args[0]?.input;
            expect(finalUpdate?.ExpressionAttributeValues?.[':status']).toBe('failed');
        });
        it('should handle unsupported platforms', async () => {
            const event = createEvent({
                platform: 'unsupported-platform',
            });
            ddbMock.on(lib_dynamodb_1.GetCommand).resolves({
                Item: {
                    scheduleId: 'test-schedule-id',
                    status: 'pending',
                    retryCount: 0,
                },
            });
            ddbMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            await expect((0, platform_connectors_1.handler)(event)).rejects.toThrow('Unsupported platform: unsupported-platform');
        });
        it('should handle unexpected errors', async () => {
            const event = createEvent({});
            ddbMock.on(lib_dynamodb_1.GetCommand).resolves({
                Item: {
                    scheduleId: 'test-schedule-id',
                    status: 'pending',
                    retryCount: 0,
                },
            });
            ddbMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            mockInstagramConnector.authenticate.mockRejectedValue(new Error('Network error'));
            await expect((0, platform_connectors_1.handler)(event)).rejects.toThrow('Network error');
            // Verify status was updated to failed
            const updateCalls = ddbMock.commandCalls(lib_dynamodb_1.UpdateCommand);
            const failedUpdate = updateCalls.find(call => call?.args[0]?.input?.ExpressionAttributeValues?.[':status'] === 'failed');
            expect(failedUpdate).toBeDefined();
        });
    });
    describe('Status management', () => {
        it('should create default status if not found', async () => {
            const event = createEvent({});
            ddbMock.on(lib_dynamodb_1.GetCommand).resolves({}); // No item found
            ddbMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            mockInstagramConnector.authenticate.mockResolvedValue();
            mockInstagramConnector.publishContent.mockResolvedValue({
                success: true,
                platformPostId: 'new-post',
                platformUrl: 'https://instagram.com/p/new',
                publishedAt: new Date().toISOString(),
            });
            await (0, platform_connectors_1.handler)(event);
            expect(mockInstagramConnector.publishContent).toHaveBeenCalled();
        });
        it('should handle DynamoDB errors gracefully', async () => {
            const event = createEvent({});
            ddbMock.on(lib_dynamodb_1.GetCommand).rejects(new Error('DynamoDB error'));
            ddbMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            mockInstagramConnector.authenticate.mockResolvedValue();
            mockInstagramConnector.publishContent.mockResolvedValue({
                success: true,
                platformPostId: 'post-123',
                platformUrl: 'https://instagram.com/p/123',
                publishedAt: new Date().toISOString(),
            });
            await (0, platform_connectors_1.handler)(event);
            // Should still attempt to publish even if status load fails
            expect(mockInstagramConnector.publishContent).toHaveBeenCalled();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImluZGV4LnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOztHQUVHOztBQUVILGlGQUF1RjtBQUV2Rix3REFBMEY7QUFDMUYsNkRBQWlEO0FBQ2pELGlGQUFnSDtBQUVoSCxnQkFBZ0I7QUFDaEIsTUFBTSxPQUFPLEdBQUcsSUFBQSxnQ0FBVSxFQUFDLHFDQUFzQixDQUFDLENBQUM7QUFFbkQsNkJBQTZCO0FBQzdCLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxHQUFHLHNCQUFzQixDQUFDO0FBRXJELGNBQWM7QUFDZCxJQUFJLENBQUMsSUFBSSxDQUFDLCtCQUErQixFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDaEQsTUFBTSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQzFDLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQ2YsS0FBSyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDaEIsSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDZiwwQkFBMEIsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO0tBQ3RDLENBQUMsQ0FBQztDQUNKLENBQUMsQ0FBQyxDQUFDO0FBRUosZUFBZTtBQUNmLElBQUksQ0FBQyxJQUFJLENBQUMsZ0NBQWdDLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUNqRCxPQUFPLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFDM0MsU0FBUyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDcEIsV0FBVyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDdEIsb0JBQW9CLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtLQUNoQyxDQUFDLENBQUM7SUFDSCxVQUFVLEVBQUU7UUFD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QUNiLGNBQWMsRUFBRSxVQUFVO2dCQUMxQixXQUFXLEVBQUUsNkJBQTZCO2dCQUMxQyxXQUFXLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7YUFDdEMsQ0FBQyxDQUFDO1lBRUgsTUFBTSxJQUFBLDZCQUFPLEVBQUMsS0FBSyxDQUFDLENBQUM7WUFFckIsNERBQTREO1lBQzVELE1BQU0sQ0FBQyxzQkFBc0IsQ0FBQyxjQUFjLENBQUMsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1FBQ25FLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUGxhdGZvcm0gUHVibGlzaGVyIExhbWJkYSBIYW5kbGVyIFVuaXQgVGVzdHNcbiAqL1xuXG5pbXBvcnQgeyBoYW5kbGVyLCBTY2hlZHVsZUV2ZW50RGV0YWlsIH0gZnJvbSAnLi4vLi4vLi4vbGliL2xhbWJkYS9wbGF0Zm9ybS1jb25uZWN0b3JzJztcbmltcG9ydCB7IEV2ZW50QnJpZGdlRXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIEdldENvbW1hbmQsIFVwZGF0ZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xuaW1wb3J0IHsgbW9ja0NsaWVudCB9IGZyb20gJ2F3cy1zZGstY2xpZW50LW1vY2snO1xuaW1wb3J0IHsgSW5zdGFncmFtQ29ubmVjdG9yLCBUaWtUb2tDb25uZWN0b3IsIFlvdVR1YmVDb25uZWN0b3IgfSBmcm9tICcuLi8uLi8uLi9saWIvbGFtYmRhL3BsYXRmb3JtLWNvbm5lY3RvcnMnO1xuXG4vLyBNb2NrIER5bmFtb0RCXG5jb25zdCBkZGJNb2NrID0gbW9ja0NsaWVudChEeW5hbW9EQkRvY3VtZW50Q2xpZW50KTtcblxuLy8gTW9jayBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbnByb2Nlc3MuZW52LlNDSEVEVUxFU19UQUJMRSA9ICd0ZXN0LXNjaGVkdWxlcy10YWJsZSc7XG5cbi8vIE1vY2sgbG9nZ2VyXG5qZXN0Lm1vY2soJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbG9nZ2VyJywgKCkgPT4gKHtcbiAgTG9nZ2VyOiBqZXN0LmZuKCkubW9ja0ltcGxlbWVudGF0aW9uKCgpID0+ICh7XG4gICAgaW5mbzogamVzdC5mbigpLFxuICAgIGVycm9yOiBqZXN0LmZuKCksXG4gICAgd2FybjogamVzdC5mbigpLFxuICAgIGFkZFBlcnNpc3RlbnRMb2dBdHRyaWJ1dGVzOiBqZXN0LmZuKCksXG4gIH0pKSxcbn0pKTtcblxuLy8gTW9jayBtZXRyaWNzXG5qZXN0Lm1vY2soJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbWV0cmljcycsICgpID0+ICh7XG4gIE1ldHJpY3M6IGplc3QuZm4oKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4gKHtcbiAgICBhZGRNZXRyaWM6IGplc3QuZm4oKSxcbiAgICBhZGRNZXRhZGF0YTogamVzdC5mbigpLFxuICAgIHB1Ymxpc2hTdG9yZWRNZXRyaWNzOiBqZXN0LmZuKCksXG4gIH0pKSxcbiAgTWV0cmljVW5pdDoge1xuICAgIENvdW50OiAnQ291bnQnLFxuICAgIE1pbGxpc2Vjb25kczogJ01pbGxpc2Vjb25kcycsXG4gIH0sXG59KSk7XG5cbi8vIE1vY2sgdHJhY2VyXG5qZXN0Lm1vY2soJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvdHJhY2VyJywgKCkgPT4gKHtcbiAgVHJhY2VyOiBqZXN0LmZuKCkubW9ja0ltcGxlbWVudGF0aW9uKCgpID0+ICh7XG4gICAgY2FwdHVyZUFXU3YzQ2xpZW50OiBqZXN0LmZuKChjbGllbnQpID0+IGNsaWVudCksXG4gIH0pKSxcbn0pKTtcblxuLy8gTW9jayBwbGF0Zm9ybSBjb25uZWN0b3JzXG5qZXN0Lm1vY2soJy4uLy4uLy4uL2xpYi9sYW1iZGEvcGxhdGZvcm0tY29ubmVjdG9ycy9pbnN0YWdyYW0tY29ubmVjdG9yJyk7XG5qZXN0Lm1vY2soJy4uLy4uLy4uL2xpYi9sYW1iZGEvcGxhdGZvcm0tY29ubmVjdG9ycy90aWt0b2stY29ubmVjdG9yJyk7XG5qZXN0Lm1vY2soJy4uLy4uLy4uL2xpYi9sYW1iZGEvcGxhdGZvcm0tY29ubmVjdG9ycy95b3V0dWJlLWNvbm5lY3RvcicpO1xuXG5kZXNjcmliZSgnUGxhdGZvcm0gUHVibGlzaGVyIExhbWJkYSBIYW5kbGVyJywgKCkgPT4ge1xuICBsZXQgbW9ja0luc3RhZ3JhbUNvbm5lY3RvcjogamVzdC5Nb2NrZWQ8SW5zdGFncmFtQ29ubmVjdG9yPjtcbiAgbGV0IG1vY2tUaWtUb2tDb25uZWN0b3I6IGplc3QuTW9ja2VkPFRpa1Rva0Nvbm5lY3Rvcj47XG4gIGxldCBtb2NrWW91VHViZUNvbm5lY3RvcjogamVzdC5Nb2NrZWQ8WW91VHViZUNvbm5lY3Rvcj47XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XG4gICAgZGRiTW9jay5yZXNldCgpO1xuXG4gICAgLy8gU2V0dXAgbW9jayBjb25uZWN0b3JzXG4gICAgbW9ja0luc3RhZ3JhbUNvbm5lY3RvciA9IHtcbiAgICAgIGF1dGhlbnRpY2F0ZTogamVzdC5mbigpLFxuICAgICAgcHVibGlzaENvbnRlbnQ6IGplc3QuZm4oKSxcbiAgICAgIGdldEluc2lnaHRzOiBqZXN0LmZuKCksXG4gICAgICBkZWxldGVDb250ZW50OiBqZXN0LmZuKCksXG4gICAgfSBhcyBhbnk7XG5cbiAgICBtb2NrVGlrVG9rQ29ubmVjdG9yID0ge1xuICAgICAgYXV0aGVudGljYXRlOiBqZXN0LmZuKCksXG4gICAgICBwdWJsaXNoQ29udGVudDogamVzdC5mbigpLFxuICAgICAgZ2V0SW5zaWdodHM6IGplc3QuZm4oKSxcbiAgICAgIGRlbGV0ZUNvbnRlbnQ6IGplc3QuZm4oKSxcbiAgICB9IGFzIGFueTtcblxuICAgIG1vY2tZb3VUdWJlQ29ubmVjdG9yID0ge1xuICAgICAgYXV0aGVudGljYXRlOiBqZXN0LmZuKCksXG4gICAgICBwdWJsaXNoQ29udGVudDogamVzdC5mbigpLFxuICAgICAgZ2V0SW5zaWdodHM6IGplc3QuZm4oKSxcbiAgICAgIGRlbGV0ZUNvbnRlbnQ6IGplc3QuZm4oKSxcbiAgICB9IGFzIGFueTtcblxuICAgIChJbnN0YWdyYW1Db25uZWN0b3IgYXMgamVzdC5Nb2NrZWRDbGFzczx0eXBlb2YgSW5zdGFncmFtQ29ubmVjdG9yPikubW9ja0ltcGxlbWVudGF0aW9uKFxuICAgICAgKCkgPT4gbW9ja0luc3RhZ3JhbUNvbm5lY3RvclxuICAgICk7XG4gICAgKFRpa1Rva0Nvbm5lY3RvciBhcyBqZXN0Lk1vY2tlZENsYXNzPHR5cGVvZiBUaWtUb2tDb25uZWN0b3I+KS5tb2NrSW1wbGVtZW50YXRpb24oXG4gICAgICAoKSA9PiBtb2NrVGlrVG9rQ29ubmVjdG9yXG4gICAgKTtcbiAgICAoWW91VHViZUNvbm5lY3RvciBhcyBqZXN0Lk1vY2tlZENsYXNzPHR5cGVvZiBZb3VUdWJlQ29ubmVjdG9yPikubW9ja0ltcGxlbWVudGF0aW9uKFxuICAgICAgKCkgPT4gbW9ja1lvdVR1YmVDb25uZWN0b3JcbiAgICApO1xuICB9KTtcblxuICBjb25zdCBjcmVhdGVFdmVudCA9IChkZXRhaWw6IFBhcnRpYWw8U2NoZWR1bGVFdmVudERldGFpbD4pOiBFdmVudEJyaWRnZUV2ZW50PCdTY2hlZHVsZWRQdWJsaXNoJywgU2NoZWR1bGVFdmVudERldGFpbD4gPT4gKHtcbiAgICB2ZXJzaW9uOiAnMCcsXG4gICAgaWQ6ICd0ZXN0LWV2ZW50LWlkJyxcbiAgICAnZGV0YWlsLXR5cGUnOiAnU2NoZWR1bGVkUHVibGlzaCcsXG4gICAgc291cmNlOiAnY29udGVudC5zY2hlZHVsZXInLFxuICAgIGFjY291bnQ6ICcxMjM0NTY3ODkwMTInLFxuICAgIHRpbWU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICByZWdpb246ICd1cy1lYXN0LTEnLFxuICAgIHJlc291cmNlczogW10sXG4gICAgZGV0YWlsOiB7XG4gICAgICBzY2hlZHVsZUlkOiAndGVzdC1zY2hlZHVsZS1pZCcsXG4gICAgICBicmFuZElkOiAndGVzdC1icmFuZC1pZCcsXG4gICAgICBjb250ZW50SWQ6ICd0ZXN0LWNvbnRlbnQtaWQnLFxuICAgICAgcGxhdGZvcm06ICdpbnN0YWdyYW0nLFxuICAgICAgY29udGVudDoge1xuICAgICAgICBjb250ZW50SWQ6ICd0ZXN0LWNvbnRlbnQtaWQnLFxuICAgICAgICBjYXB0aW9uOiAnVGVzdCBjYXB0aW9uJyxcbiAgICAgICAgaGFzaHRhZ3M6IFsndGVzdCcsICdoYXNodGFnJ10sXG4gICAgICAgIG1lZGlhVXJsOiAnaHR0cHM6Ly9leGFtcGxlLmNvbS9pbWFnZS5qcGcnLFxuICAgICAgICBtZWRpYVR5cGU6ICdpbWFnZScsXG4gICAgICB9LFxuICAgICAgc2NoZWR1bGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIC4uLmRldGFpbCxcbiAgICB9LFxuICB9KTtcblxuICBkZXNjcmliZSgnSW5zdGFncmFtIHB1Ymxpc2hpbmcnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBwdWJsaXNoIHRvIEluc3RhZ3JhbSBzdWNjZXNzZnVsbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZUV2ZW50KHtcbiAgICAgICAgcGxhdGZvcm06ICdpbnN0YWdyYW0nLFxuICAgICAgICBjb250ZW50OiB7XG4gICAgICAgICAgY29udGVudElkOiAnaWctY29udGVudC0xJyxcbiAgICAgICAgICBjYXB0aW9uOiAnSW5zdGFncmFtIHBvc3QnLFxuICAgICAgICAgIG1lZGlhVXJsOiAnaHR0cHM6Ly9leGFtcGxlLmNvbS9pbWFnZS5qcGcnLFxuICAgICAgICAgIG1lZGlhVHlwZTogJ2ltYWdlJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBNb2NrIER5bmFtb0RCIHJlc3BvbnNlc1xuICAgICAgZGRiTW9jay5vbihHZXRDb21tYW5kKS5yZXNvbHZlcyh7XG4gICAgICAgIEl0ZW06IHtcbiAgICAgICAgICBzY2hlZHVsZUlkOiAndGVzdC1zY2hlZHVsZS1pZCcsXG4gICAgICAgICAgc3RhdHVzOiAncGVuZGluZycsXG4gICAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgICBsYXN0QXR0ZW1wdEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGRkYk1vY2sub24oVXBkYXRlQ29tbWFuZCkucmVzb2x2ZXMoe30pO1xuXG4gICAgICAvLyBNb2NrIEluc3RhZ3JhbSBjb25uZWN0b3JcbiAgICAgIG1vY2tJbnN0YWdyYW1Db25uZWN0b3IuYXV0aGVudGljYXRlLm1vY2tSZXNvbHZlZFZhbHVlKCk7XG4gICAgICBtb2NrSW5zdGFncmFtQ29ubmVjdG9yLnB1Ymxpc2hDb250ZW50Lm1vY2tSZXNvbHZlZFZhbHVlKHtcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgcGxhdGZvcm1Qb3N0SWQ6ICdpZy1wb3N0LTEyMycsXG4gICAgICAgIHBsYXRmb3JtVXJsOiAnaHR0cHM6Ly93d3cuaW5zdGFncmFtLmNvbS9wL2FiYzEyMy8nLFxuICAgICAgICBwdWJsaXNoZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGhhbmRsZXIoZXZlbnQpO1xuXG4gICAgICBleHBlY3QobW9ja0luc3RhZ3JhbUNvbm5lY3Rvci5hdXRoZW50aWNhdGUpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgIGV4cGVjdChtb2NrSW5zdGFncmFtQ29ubmVjdG9yLnB1Ymxpc2hDb250ZW50KS50b0hhdmVCZWVuQ2FsbGVkV2l0aChldmVudC5kZXRhaWwuY29udGVudCk7XG4gICAgICBcbiAgICAgIC8vIFZlcmlmeSBzdGF0dXMgd2FzIHVwZGF0ZWQgdG8gcHVibGlzaGVkXG4gICAgICBleHBlY3QoZGRiTW9jay5jb21tYW5kQ2FsbHMoVXBkYXRlQ29tbWFuZCkpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgIGNvbnN0IHVwZGF0ZUNhbGxzID0gZGRiTW9jay5jb21tYW5kQ2FsbHMoVXBkYXRlQ29tbWFuZCk7XG4gICAgICBjb25zdCBmaW5hbFVwZGF0ZSA9IHVwZGF0ZUNhbGxzWzFdPy5hcmdzWzBdPy5pbnB1dDtcbiAgICAgIGV4cGVjdChmaW5hbFVwZGF0ZT8uRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlcz8uWyc6c3RhdHVzJ10pLnRvQmUoJ3B1Ymxpc2hlZCcpO1xuICAgICAgZXhwZWN0KGZpbmFsVXBkYXRlPy5FeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzPy5bJzpwbGF0Zm9ybVBvc3RJZCddKS50b0JlKCdpZy1wb3N0LTEyMycpO1xuICAgICAgZXhwZWN0KGZpbmFsVXBkYXRlPy5FeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzPy5bJzpwbGF0Zm9ybVVybCddKS50b0JlKCdodHRwczovL3d3dy5pbnN0YWdyYW0uY29tL3AvYWJjMTIzLycpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgSW5zdGFncmFtIFJlZWwgcHVibGlzaGluZycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlRXZlbnQoe1xuICAgICAgICBwbGF0Zm9ybTogJ2luc3RhZ3JhbScsXG4gICAgICAgIGNvbnRlbnQ6IHtcbiAgICAgICAgICBjb250ZW50SWQ6ICdpZy1yZWVsLTEnLFxuICAgICAgICAgIGNhcHRpb246ICdJbnN0YWdyYW0gUmVlbCcsXG4gICAgICAgICAgdmlkZW9Vcmw6ICdodHRwczovL2V4YW1wbGUuY29tL3ZpZGVvLm1wNCcsXG4gICAgICAgICAgbWVkaWFUeXBlOiAndmlkZW8nLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGRkYk1vY2sub24oR2V0Q29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBJdGVtOiB7XG4gICAgICAgICAgc2NoZWR1bGVJZDogJ3Rlc3Qtc2NoZWR1bGUtaWQnLFxuICAgICAgICAgIHN0YXR1czogJ3BlbmRpbmcnLFxuICAgICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGRkYk1vY2sub24oVXBkYXRlQ29tbWFuZCkucmVzb2x2ZXMoe30pO1xuXG4gICAgICBtb2NrSW5zdGFncmFtQ29ubmVjdG9yLmF1dGhlbnRpY2F0ZS5tb2NrUmVzb2x2ZWRWYWx1ZSgpO1xuICAgICAgbW9ja0luc3RhZ3JhbUNvbm5lY3Rvci5wdWJsaXNoQ29udGVudC5tb2NrUmVzb2x2ZWRWYWx1ZSh7XG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIHBsYXRmb3JtUG9zdElkOiAnaWctcmVlbC00NTYnLFxuICAgICAgICBwbGF0Zm9ybVVybDogJ2h0dHBzOi8vd3d3Lmluc3RhZ3JhbS5jb20vcmVlbC9kZWY0NTYvJyxcbiAgICAgICAgcHVibGlzaGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBoYW5kbGVyKGV2ZW50KTtcblxuICAgICAgZXhwZWN0KG1vY2tJbnN0YWdyYW1Db25uZWN0b3IucHVibGlzaENvbnRlbnQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgbWVkaWFUeXBlOiAndmlkZW8nLFxuICAgICAgICAgIHZpZGVvVXJsOiAnaHR0cHM6Ly9leGFtcGxlLmNvbS92aWRlby5tcDQnLFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1Rpa1RvayBwdWJsaXNoaW5nJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcHVibGlzaCB0byBUaWtUb2sgc3VjY2Vzc2Z1bGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCh7XG4gICAgICAgIHBsYXRmb3JtOiAndGlrdG9rJyxcbiAgICAgICAgY29udGVudDoge1xuICAgICAgICAgIGNvbnRlbnRJZDogJ3R0LWNvbnRlbnQtMScsXG4gICAgICAgICAgY2FwdGlvbjogJ1Rpa1RvayB2aWRlbycsXG4gICAgICAgICAgdmlkZW9Vcmw6ICdodHRwczovL2V4YW1wbGUuY29tL3Rpa3Rvay5tcDQnLFxuICAgICAgICAgIG1lZGlhVHlwZTogJ3ZpZGVvJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBkZGJNb2NrLm9uKEdldENvbW1hbmQpLnJlc29sdmVzKHtcbiAgICAgICAgSXRlbToge1xuICAgICAgICAgIHNjaGVkdWxlSWQ6ICd0ZXN0LXNjaGVkdWxlLWlkJyxcbiAgICAgICAgICBzdGF0dXM6ICdwZW5kaW5nJyxcbiAgICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBkZGJNb2NrLm9uKFVwZGF0ZUNvbW1hbmQpLnJlc29sdmVzKHt9KTtcblxuICAgICAgbW9ja1Rpa1Rva0Nvbm5lY3Rvci5hdXRoZW50aWNhdGUubW9ja1Jlc29sdmVkVmFsdWUoKTtcbiAgICAgIG1vY2tUaWtUb2tDb25uZWN0b3IucHVibGlzaENvbnRlbnQubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICBwbGF0Zm9ybVBvc3RJZDogJ3R0LXBvc3QtNzg5JyxcbiAgICAgICAgcGxhdGZvcm1Vcmw6ICdodHRwczovL3d3dy50aWt0b2suY29tL0B1c2VyL3ZpZGVvLzc4OScsXG4gICAgICAgIHB1Ymxpc2hlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgaGFuZGxlcihldmVudCk7XG5cbiAgICAgIGV4cGVjdChtb2NrVGlrVG9rQ29ubmVjdG9yLmF1dGhlbnRpY2F0ZSkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgZXhwZWN0KG1vY2tUaWtUb2tDb25uZWN0b3IucHVibGlzaENvbnRlbnQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKGV2ZW50LmRldGFpbC5jb250ZW50KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1lvdVR1YmUgcHVibGlzaGluZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHB1Ymxpc2ggdG8gWW91VHViZSBzdWNjZXNzZnVsbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZUV2ZW50KHtcbiAgICAgICAgcGxhdGZvcm06ICd5b3V0dWJlJyxcbiAgICAgICAgY29udGVudDoge1xuICAgICAgICAgIGNvbnRlbnRJZDogJ3l0LWNvbnRlbnQtMScsXG4gICAgICAgICAgY2FwdGlvbjogJ1lvdVR1YmUgdmlkZW8nLFxuICAgICAgICAgIHZpZGVvVXJsOiAnaHR0cHM6Ly9leGFtcGxlLmNvbS95b3V0dWJlLm1wNCcsXG4gICAgICAgICAgbWVkaWFUeXBlOiAndmlkZW8nLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGRkYk1vY2sub24oR2V0Q29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBJdGVtOiB7XG4gICAgICAgICAgc2NoZWR1bGVJZDogJ3Rlc3Qtc2NoZWR1bGUtaWQnLFxuICAgICAgICAgIHN0YXR1czogJ3BlbmRpbmcnLFxuICAgICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGRkYk1vY2sub24oVXBkYXRlQ29tbWFuZCkucmVzb2x2ZXMoe30pO1xuXG4gICAgICBtb2NrWW91VHViZUNvbm5lY3Rvci5hdXRoZW50aWNhdGUubW9ja1Jlc29sdmVkVmFsdWUoKTtcbiAgICAgIG1vY2tZb3VUdWJlQ29ubmVjdG9yLnB1Ymxpc2hDb250ZW50Lm1vY2tSZXNvbHZlZFZhbHVlKHtcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgcGxhdGZvcm1Qb3N0SWQ6ICd5dC12aWRlby1hYmMnLFxuICAgICAgICBwbGF0Zm9ybVVybDogJ2h0dHBzOi8vd3d3LnlvdXR1YmUuY29tL3dhdGNoP3Y9YWJjJyxcbiAgICAgICAgcHVibGlzaGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBoYW5kbGVyKGV2ZW50KTtcblxuICAgICAgZXhwZWN0KG1vY2tZb3VUdWJlQ29ubmVjdG9yLmF1dGhlbnRpY2F0ZSkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgZXhwZWN0KG1vY2tZb3VUdWJlQ29ubmVjdG9yLnB1Ymxpc2hDb250ZW50KS50b0hhdmVCZWVuQ2FsbGVkV2l0aChldmVudC5kZXRhaWwuY29udGVudCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBZb3VUdWJlIFNob3J0cycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlRXZlbnQoe1xuICAgICAgICBwbGF0Zm9ybTogJ3lvdXR1YmUnLFxuICAgICAgICBjb250ZW50OiB7XG4gICAgICAgICAgY29udGVudElkOiAneXQtc2hvcnQtMScsXG4gICAgICAgICAgY2FwdGlvbjogJ1lvdVR1YmUgU2hvcnQnLFxuICAgICAgICAgIGhhc2h0YWdzOiBbJ3Nob3J0cyddLFxuICAgICAgICAgIHZpZGVvVXJsOiAnaHR0cHM6Ly9leGFtcGxlLmNvbS9zaG9ydC5tcDQnLFxuICAgICAgICAgIG1lZGlhVHlwZTogJ3ZpZGVvJyxcbiAgICAgICAgICBkdXJhdGlvbjogNDUsXG4gICAgICAgICAgYXNwZWN0UmF0aW86ICc5OjE2JyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBkZGJNb2NrLm9uKEdldENvbW1hbmQpLnJlc29sdmVzKHtcbiAgICAgICAgSXRlbToge1xuICAgICAgICAgIHNjaGVkdWxlSWQ6ICd0ZXN0LXNjaGVkdWxlLWlkJyxcbiAgICAgICAgICBzdGF0dXM6ICdwZW5kaW5nJyxcbiAgICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBkZGJNb2NrLm9uKFVwZGF0ZUNvbW1hbmQpLnJlc29sdmVzKHt9KTtcblxuICAgICAgbW9ja1lvdVR1YmVDb25uZWN0b3IuYXV0aGVudGljYXRlLm1vY2tSZXNvbHZlZFZhbHVlKCk7XG4gICAgICBtb2NrWW91VHViZUNvbm5lY3Rvci5wdWJsaXNoQ29udGVudC5tb2NrUmVzb2x2ZWRWYWx1ZSh7XG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIHBsYXRmb3JtUG9zdElkOiAneXQtc2hvcnQteHl6JyxcbiAgICAgICAgcGxhdGZvcm1Vcmw6ICdodHRwczovL3d3dy55b3V0dWJlLmNvbS9zaG9ydHMveHl6JyxcbiAgICAgICAgcHVibGlzaGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBoYW5kbGVyKGV2ZW50KTtcblxuICAgICAgZXhwZWN0KG1vY2tZb3VUdWJlQ29ubmVjdG9yLnB1Ymxpc2hDb250ZW50KS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgIGR1cmF0aW9uOiA0NSxcbiAgICAgICAgICBhc3BlY3RSYXRpbzogJzk6MTYnLFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0Vycm9yIGhhbmRsaW5nJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgc2tpcCBhbHJlYWR5IHB1Ymxpc2hlZCBjb250ZW50JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCh7fSk7XG5cbiAgICAgIGRkYk1vY2sub24oR2V0Q29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBJdGVtOiB7XG4gICAgICAgICAgc2NoZWR1bGVJZDogJ3Rlc3Qtc2NoZWR1bGUtaWQnLFxuICAgICAgICAgIHN0YXR1czogJ3B1Ymxpc2hlZCcsXG4gICAgICAgICAgcGxhdGZvcm1Qb3N0SWQ6ICdhbHJlYWR5LXB1Ymxpc2hlZCcsXG4gICAgICAgICAgcHVibGlzaGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGhhbmRsZXIoZXZlbnQpO1xuXG4gICAgICBleHBlY3QobW9ja0luc3RhZ3JhbUNvbm5lY3Rvci5wdWJsaXNoQ29udGVudCkubm90LnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgIGV4cGVjdChkZGJNb2NrLmNvbW1hbmRDYWxscyhVcGRhdGVDb21tYW5kKSkudG9IYXZlTGVuZ3RoKDApO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgcHVibGlzaGluZyBmYWlsdXJlcyB3aXRoIHJldHJ5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCh7fSk7XG5cbiAgICAgIGRkYk1vY2sub24oR2V0Q29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBJdGVtOiB7XG4gICAgICAgICAgc2NoZWR1bGVJZDogJ3Rlc3Qtc2NoZWR1bGUtaWQnLFxuICAgICAgICAgIHN0YXR1czogJ3BlbmRpbmcnLFxuICAgICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGRkYk1vY2sub24oVXBkYXRlQ29tbWFuZCkucmVzb2x2ZXMoe30pO1xuXG4gICAgICBtb2NrSW5zdGFncmFtQ29ubmVjdG9yLmF1dGhlbnRpY2F0ZS5tb2NrUmVzb2x2ZWRWYWx1ZSgpO1xuICAgICAgbW9ja0luc3RhZ3JhbUNvbm5lY3Rvci5wdWJsaXNoQ29udGVudC5tb2NrUmVzb2x2ZWRWYWx1ZSh7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBlcnJvcjoge1xuICAgICAgICAgIGNvZGU6ICdSQVRFX0xJTUlUJyxcbiAgICAgICAgICBtZXNzYWdlOiAnUmF0ZSBsaW1pdCBleGNlZWRlZCcsXG4gICAgICAgICAgcmV0cnlhYmxlOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGV4cGVjdChoYW5kbGVyKGV2ZW50KSkucmVqZWN0cy50b1Rocm93KCdQdWJsaXNoaW5nIGZhaWxlZDogUmF0ZSBsaW1pdCBleGNlZWRlZCcpO1xuXG4gICAgICAvLyBWZXJpZnkgc3RhdHVzIHdhcyB1cGRhdGVkIHRvIHJldHJ5aW5nXG4gICAgICBjb25zdCB1cGRhdGVDYWxscyA9IGRkYk1vY2suY29tbWFuZENhbGxzKFVwZGF0ZUNvbW1hbmQpO1xuICAgICAgY29uc3Qgc3RhdHVzVXBkYXRlID0gdXBkYXRlQ2FsbHMuZmluZChjYWxsID0+IFxuICAgICAgICBjYWxsPy5hcmdzWzBdPy5pbnB1dD8uRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlcz8uWyc6c3RhdHVzJ10gPT09ICdyZXRyeWluZydcbiAgICAgICk7XG4gICAgICBleHBlY3Qoc3RhdHVzVXBkYXRlKS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgcGVybWFuZW50IGZhaWx1cmVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCh7XG4gICAgICAgIHJldHJ5Q291bnQ6IDMsIC8vIE1heCByZXRyaWVzIHJlYWNoZWRcbiAgICAgIH0pO1xuXG4gICAgICBkZGJNb2NrLm9uKEdldENvbW1hbmQpLnJlc29sdmVzKHtcbiAgICAgICAgSXRlbToge1xuICAgICAgICAgIHNjaGVkdWxlSWQ6ICd0ZXN0LXNjaGVkdWxlLWlkJyxcbiAgICAgICAgICBzdGF0dXM6ICdyZXRyeWluZycsXG4gICAgICAgICAgcmV0cnlDb3VudDogMyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgZGRiTW9jay5vbihVcGRhdGVDb21tYW5kKS5yZXNvbHZlcyh7fSk7XG5cbiAgICAgIG1vY2tJbnN0YWdyYW1Db25uZWN0b3IuYXV0aGVudGljYXRlLm1vY2tSZXNvbHZlZFZhbHVlKCk7XG4gICAgICBtb2NrSW5zdGFncmFtQ29ubmVjdG9yLnB1Ymxpc2hDb250ZW50Lm1vY2tSZXNvbHZlZFZhbHVlKHtcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGVycm9yOiB7XG4gICAgICAgICAgY29kZTogJ0lOVkFMSURfQ09OVEVOVCcsXG4gICAgICAgICAgbWVzc2FnZTogJ0NvbnRlbnQgdmFsaWRhdGlvbiBmYWlsZWQnLFxuICAgICAgICAgIHJldHJ5YWJsZTogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBoYW5kbGVyKGV2ZW50KTtcblxuICAgICAgLy8gVmVyaWZ5IHN0YXR1cyB3YXMgdXBkYXRlZCB0byBmYWlsZWQgKG5vdCByZXRyeWluZylcbiAgICAgIGNvbnN0IHVwZGF0ZUNhbGxzID0gZGRiTW9jay5jb21tYW5kQ2FsbHMoVXBkYXRlQ29tbWFuZCk7XG4gICAgICBjb25zdCBmaW5hbFVwZGF0ZSA9IHVwZGF0ZUNhbGxzW3VwZGF0ZUNhbGxzLmxlbmd0aCAtIDFdPy5hcmdzWzBdPy5pbnB1dDtcbiAgICAgIGV4cGVjdChmaW5hbFVwZGF0ZT8uRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlcz8uWyc6c3RhdHVzJ10pLnRvQmUoJ2ZhaWxlZCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgdW5zdXBwb3J0ZWQgcGxhdGZvcm1zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCh7XG4gICAgICAgIHBsYXRmb3JtOiAndW5zdXBwb3J0ZWQtcGxhdGZvcm0nLFxuICAgICAgfSk7XG5cbiAgICAgIGRkYk1vY2sub24oR2V0Q29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBJdGVtOiB7XG4gICAgICAgICAgc2NoZWR1bGVJZDogJ3Rlc3Qtc2NoZWR1bGUtaWQnLFxuICAgICAgICAgIHN0YXR1czogJ3BlbmRpbmcnLFxuICAgICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGRkYk1vY2sub24oVXBkYXRlQ29tbWFuZCkucmVzb2x2ZXMoe30pO1xuXG4gICAgICBhd2FpdCBleHBlY3QoaGFuZGxlcihldmVudCkpLnJlamVjdHMudG9UaHJvdygnVW5zdXBwb3J0ZWQgcGxhdGZvcm06IHVuc3VwcG9ydGVkLXBsYXRmb3JtJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB1bmV4cGVjdGVkIGVycm9ycycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlRXZlbnQoe30pO1xuXG4gICAgICBkZGJNb2NrLm9uKEdldENvbW1hbmQpLnJlc29sdmVzKHtcbiAgICAgICAgSXRlbToge1xuICAgICAgICAgIHNjaGVkdWxlSWQ6ICd0ZXN0LXNjaGVkdWxlLWlkJyxcbiAgICAgICAgICBzdGF0dXM6ICdwZW5kaW5nJyxcbiAgICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBkZGJNb2NrLm9uKFVwZGF0ZUNvbW1hbmQpLnJlc29sdmVzKHt9KTtcblxuICAgICAgbW9ja0luc3RhZ3JhbUNvbm5lY3Rvci5hdXRoZW50aWNhdGUubW9ja1JlamVjdGVkVmFsdWUobmV3IEVycm9yKCdOZXR3b3JrIGVycm9yJykpO1xuXG4gICAgICBhd2FpdCBleHBlY3QoaGFuZGxlcihldmVudCkpLnJlamVjdHMudG9UaHJvdygnTmV0d29yayBlcnJvcicpO1xuXG4gICAgICAvLyBWZXJpZnkgc3RhdHVzIHdhcyB1cGRhdGVkIHRvIGZhaWxlZFxuICAgICAgY29uc3QgdXBkYXRlQ2FsbHMgPSBkZGJNb2NrLmNvbW1hbmRDYWxscyhVcGRhdGVDb21tYW5kKTtcbiAgICAgIGNvbnN0IGZhaWxlZFVwZGF0ZSA9IHVwZGF0ZUNhbGxzLmZpbmQoY2FsbCA9PlxuICAgICAgICBjYWxsPy5hcmdzWzBdPy5pbnB1dD8uRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlcz8uWyc6c3RhdHVzJ10gPT09ICdmYWlsZWQnXG4gICAgICApO1xuICAgICAgZXhwZWN0KGZhaWxlZFVwZGF0ZSkudG9CZURlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1N0YXR1cyBtYW5hZ2VtZW50JywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY3JlYXRlIGRlZmF1bHQgc3RhdHVzIGlmIG5vdCBmb3VuZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlRXZlbnQoe30pO1xuXG4gICAgICBkZGJNb2NrLm9uKEdldENvbW1hbmQpLnJlc29sdmVzKHt9KTsgLy8gTm8gaXRlbSBmb3VuZFxuICAgICAgZGRiTW9jay5vbihVcGRhdGVDb21tYW5kKS5yZXNvbHZlcyh7fSk7XG5cbiAgICAgIG1vY2tJbnN0YWdyYW1Db25uZWN0b3IuYXV0aGVudGljYXRlLm1vY2tSZXNvbHZlZFZhbHVlKCk7XG4gICAgICBtb2NrSW5zdGFncmFtQ29ubmVjdG9yLnB1Ymxpc2hDb250ZW50Lm1vY2tSZXNvbHZlZFZhbHVlKHtcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgcGxhdGZvcm1Qb3N0SWQ6ICduZXctcG9zdCcsXG4gICAgICAgIHBsYXRmb3JtVXJsOiAnaHR0cHM6Ly9pbnN0YWdyYW0uY29tL3AvbmV3JyxcbiAgICAgICAgcHVibGlzaGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBoYW5kbGVyKGV2ZW50KTtcblxuICAgICAgZXhwZWN0KG1vY2tJbnN0YWdyYW1Db25uZWN0b3IucHVibGlzaENvbnRlbnQpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIER5bmFtb0RCIGVycm9ycyBncmFjZWZ1bGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCh7fSk7XG5cbiAgICAgIGRkYk1vY2sub24oR2V0Q29tbWFuZCkucmVqZWN0cyhuZXcgRXJyb3IoJ0R5bmFtb0RCIGVycm9yJykpO1xuICAgICAgZGRiTW9jay5vbihVcGRhdGVDb21tYW5kKS5yZXNvbHZlcyh7fSk7XG5cbiAgICAgIG1vY2tJbnN0YWdyYW1Db25uZWN0b3IuYXV0aGVudGljYXRlLm1vY2tSZXNvbHZlZFZhbHVlKCk7XG4gICAgICBtb2NrSW5zdGFncmFtQ29ubmVjdG9yLnB1Ymxpc2hDb250ZW50Lm1vY2tSZXNvbHZlZFZhbHVlKHtcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgcGxhdGZvcm1Qb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgIHBsYXRmb3JtVXJsOiAnaHR0cHM6Ly9pbnN0YWdyYW0uY29tL3AvMTIzJyxcbiAgICAgICAgcHVibGlzaGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBoYW5kbGVyKGV2ZW50KTtcblxuICAgICAgLy8gU2hvdWxkIHN0aWxsIGF0dGVtcHQgdG8gcHVibGlzaCBldmVuIGlmIHN0YXR1cyBsb2FkIGZhaWxzXG4gICAgICBleHBlY3QobW9ja0luc3RhZ3JhbUNvbm5lY3Rvci5wdWJsaXNoQ29udGVudCkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgIH0pO1xuICB9KTtcbn0pOyJdfQ==