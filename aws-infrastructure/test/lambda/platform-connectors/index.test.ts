/**
 * Platform Publisher Lambda Handler Unit Tests
 */

import { handler, ScheduleEventDetail } from '../../../lib/lambda/platform-connectors';
import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { InstagramConnector, TikTokConnector, YouTubeConnector } from '../../../lib/lambda/platform-connectors';

// Mock DynamoDB
const ddbMock = mockClient(DynamoDBDocumentClient);

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
  let mockInstagramConnector: jest.Mocked<InstagramConnector>;
  let mockTikTokConnector: jest.Mocked<TikTokConnector>;
  let mockYouTubeConnector: jest.Mocked<YouTubeConnector>;

  beforeEach(() => {
    jest.clearAllMocks();
    ddbMock.reset();

    // Setup mock connectors
    mockInstagramConnector = {
      authenticate: jest.fn(),
      publishContent: jest.fn(),
      getInsights: jest.fn(),
      deleteContent: jest.fn(),
    } as any;

    mockTikTokConnector = {
      authenticate: jest.fn(),
      publishContent: jest.fn(),
      getInsights: jest.fn(),
      deleteContent: jest.fn(),
    } as any;

    mockYouTubeConnector = {
      authenticate: jest.fn(),
      publishContent: jest.fn(),
      getInsights: jest.fn(),
      deleteContent: jest.fn(),
    } as any;

    (InstagramConnector as jest.MockedClass<typeof InstagramConnector>).mockImplementation(
      () => mockInstagramConnector
    );
    (TikTokConnector as jest.MockedClass<typeof TikTokConnector>).mockImplementation(
      () => mockTikTokConnector
    );
    (YouTubeConnector as jest.MockedClass<typeof YouTubeConnector>).mockImplementation(
      () => mockYouTubeConnector
    );
  });

  const createEvent = (detail: Partial<ScheduleEventDetail>): EventBridgeEvent<'ScheduledPublish', ScheduleEventDetail> => ({
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
      ddbMock.on(GetCommand).resolves({
        Item: {
          scheduleId: 'test-schedule-id',
          status: 'pending',
          retryCount: 0,
          lastAttemptAt: new Date().toISOString(),
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      // Mock Instagram connector
      mockInstagramConnector.authenticate.mockResolvedValue();
      mockInstagramConnector.publishContent.mockResolvedValue({
        success: true,
        platformPostId: 'ig-post-123',
        platformUrl: 'https://www.instagram.com/p/abc123/',
        publishedAt: new Date().toISOString(),
      });

      await handler(event);

      expect(mockInstagramConnector.authenticate).toHaveBeenCalled();
      expect(mockInstagramConnector.publishContent).toHaveBeenCalledWith(event.detail.content);
      
      // Verify status was updated to published
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(2);
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      const finalUpdate = updateCalls[1].args[0].input;
      expect(finalUpdate.ExpressionAttributeValues[':status']).toBe('published');
      expect(finalUpdate.ExpressionAttributeValues[':platformPostId']).toBe('ig-post-123');
      expect(finalUpdate.ExpressionAttributeValues[':platformUrl']).toBe('https://www.instagram.com/p/abc123/');
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

      ddbMock.on(GetCommand).resolves({
        Item: {
          scheduleId: 'test-schedule-id',
          status: 'pending',
          retryCount: 0,
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      mockInstagramConnector.authenticate.mockResolvedValue();
      mockInstagramConnector.publishContent.mockResolvedValue({
        success: true,
        platformPostId: 'ig-reel-456',
        platformUrl: 'https://www.instagram.com/reel/def456/',
        publishedAt: new Date().toISOString(),
      });

      await handler(event);

      expect(mockInstagramConnector.publishContent).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: 'video',
          videoUrl: 'https://example.com/video.mp4',
        })
      );
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

      ddbMock.on(GetCommand).resolves({
        Item: {
          scheduleId: 'test-schedule-id',
          status: 'pending',
          retryCount: 0,
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      mockTikTokConnector.authenticate.mockResolvedValue();
      mockTikTokConnector.publishContent.mockResolvedValue({
        success: true,
        platformPostId: 'tt-post-789',
        platformUrl: 'https://www.tiktok.com/@user/video/789',
        publishedAt: new Date().toISOString(),
      });

      await handler(event);

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

      ddbMock.on(GetCommand).resolves({
        Item: {
          scheduleId: 'test-schedule-id',
          status: 'pending',
          retryCount: 0,
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      mockYouTubeConnector.authenticate.mockResolvedValue();
      mockYouTubeConnector.publishContent.mockResolvedValue({
        success: true,
        platformPostId: 'yt-video-abc',
        platformUrl: 'https://www.youtube.com/watch?v=abc',
        publishedAt: new Date().toISOString(),
      });

      await handler(event);

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

      ddbMock.on(GetCommand).resolves({
        Item: {
          scheduleId: 'test-schedule-id',
          status: 'pending',
          retryCount: 0,
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      mockYouTubeConnector.authenticate.mockResolvedValue();
      mockYouTubeConnector.publishContent.mockResolvedValue({
        success: true,
        platformPostId: 'yt-short-xyz',
        platformUrl: 'https://www.youtube.com/shorts/xyz',
        publishedAt: new Date().toISOString(),
      });

      await handler(event);

      expect(mockYouTubeConnector.publishContent).toHaveBeenCalledWith(
        expect.objectContaining({
          duration: 45,
          aspectRatio: '9:16',
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should skip already published content', async () => {
      const event = createEvent({});

      ddbMock.on(GetCommand).resolves({
        Item: {
          scheduleId: 'test-schedule-id',
          status: 'published',
          platformPostId: 'already-published',
          publishedAt: new Date().toISOString(),
          retryCount: 0,
        },
      });

      await handler(event);

      expect(mockInstagramConnector.publishContent).not.toHaveBeenCalled();
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('should handle publishing failures with retry', async () => {
      const event = createEvent({});

      ddbMock.on(GetCommand).resolves({
        Item: {
          scheduleId: 'test-schedule-id',
          status: 'pending',
          retryCount: 0,
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      mockInstagramConnector.authenticate.mockResolvedValue();
      mockInstagramConnector.publishContent.mockResolvedValue({
        success: false,
        error: {
          code: 'RATE_LIMIT',
          message: 'Rate limit exceeded',
          retryable: true,
        },
      });

      await expect(handler(event)).rejects.toThrow('Publishing failed: Rate limit exceeded');

      // Verify status was updated to retrying
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      const statusUpdate = updateCalls.find(call => 
        call.args[0].input.ExpressionAttributeValues[':status'] === 'retrying'
      );
      expect(statusUpdate).toBeDefined();
    });

    it('should handle permanent failures', async () => {
      const event = createEvent({
        detail: {
          retryCount: 3, // Max retries reached
        },
      });

      ddbMock.on(GetCommand).resolves({
        Item: {
          scheduleId: 'test-schedule-id',
          status: 'retrying',
          retryCount: 3,
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      mockInstagramConnector.authenticate.mockResolvedValue();
      mockInstagramConnector.publishContent.mockResolvedValue({
        success: false,
        error: {
          code: 'INVALID_CONTENT',
          message: 'Content validation failed',
          retryable: true,
        },
      });

      await handler(event);

      // Verify status was updated to failed (not retrying)
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      const finalUpdate = updateCalls[updateCalls.length - 1].args[0].input;
      expect(finalUpdate.ExpressionAttributeValues[':status']).toBe('failed');
    });

    it('should handle unsupported platforms', async () => {
      const event = createEvent({
        platform: 'unsupported-platform',
      });

      ddbMock.on(GetCommand).resolves({
        Item: {
          scheduleId: 'test-schedule-id',
          status: 'pending',
          retryCount: 0,
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      await expect(handler(event)).rejects.toThrow('Unsupported platform: unsupported-platform');
    });

    it('should handle unexpected errors', async () => {
      const event = createEvent({});

      ddbMock.on(GetCommand).resolves({
        Item: {
          scheduleId: 'test-schedule-id',
          status: 'pending',
          retryCount: 0,
        },
      });
      ddbMock.on(UpdateCommand).resolves({});

      mockInstagramConnector.authenticate.mockRejectedValue(new Error('Network error'));

      await expect(handler(event)).rejects.toThrow('Network error');

      // Verify status was updated to failed
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      const failedUpdate = updateCalls.find(call =>
        call.args[0].input.ExpressionAttributeValues[':status'] === 'failed'
      );
      expect(failedUpdate).toBeDefined();
    });
  });

  describe('Status management', () => {
    it('should create default status if not found', async () => {
      const event = createEvent({});

      ddbMock.on(GetCommand).resolves({}); // No item found
      ddbMock.on(UpdateCommand).resolves({});

      mockInstagramConnector.authenticate.mockResolvedValue();
      mockInstagramConnector.publishContent.mockResolvedValue({
        success: true,
        platformPostId: 'new-post',
        platformUrl: 'https://instagram.com/p/new',
        publishedAt: new Date().toISOString(),
      });

      await handler(event);

      expect(mockInstagramConnector.publishContent).toHaveBeenCalled();
    });

    it('should handle DynamoDB errors gracefully', async () => {
      const event = createEvent({});

      ddbMock.on(GetCommand).rejects(new Error('DynamoDB error'));
      ddbMock.on(UpdateCommand).resolves({});

      mockInstagramConnector.authenticate.mockResolvedValue();
      mockInstagramConnector.publishContent.mockResolvedValue({
        success: true,
        platformPostId: 'post-123',
        platformUrl: 'https://instagram.com/p/123',
        publishedAt: new Date().toISOString(),
      });

      await handler(event);

      // Should still attempt to publish even if status load fails
      expect(mockInstagramConnector.publishContent).toHaveBeenCalled();
    });
  });
});