/**
 * Instagram Connector Unit Tests
 */

import { InstagramConnector } from '../../../lib/lambda/platform-connectors/instagram-connector';
import axios from 'axios';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { mockClient } from 'aws-sdk-client-mock';

// Mock AWS SDK
const secretsManagerMock = mockClient(SecretsManagerClient);

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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
  let connector: InstagramConnector;

  beforeEach(() => {
    jest.clearAllMocks();
    secretsManagerMock.reset();
    connector = new InstagramConnector();
  });

  describe('authenticate', () => {
    it('should authenticate successfully with valid credentials', async () => {
      // Mock Secrets Manager
      secretsManagerMock.on(GetSecretValueCommand).resolves({
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

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
      secretsManagerMock.on(GetSecretValueCommand).resolves({
        SecretString: JSON.stringify({
          accessToken: 'invalid-token',
          accountId: 'test-account-id',
        }),
      });

      const mockApiClient = {
        get: jest.fn().mockRejectedValue(new Error('Invalid OAuth 2.0 Access Token')),
      };
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      await expect(connector.authenticate()).rejects.toThrow('Failed to authenticate with Instagram');
    });
  });

  describe('publishContent', () => {
    beforeEach(async () => {
      // Setup authenticated connector
      secretsManagerMock.on(GetSecretValueCommand).resolves({
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      const content = {
        contentId: 'test-content-1',
        caption: 'Test caption',
        hashtags: ['test', 'instagram'],
        mediaUrl: 'https://example.com/image.jpg',
        mediaType: 'image' as const,
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      const content = {
        contentId: 'test-reel-1',
        caption: 'Test Reel caption',
        hashtags: ['reels', 'video'],
        videoUrl: 'https://example.com/video.mp4',
        mediaType: 'video' as const,
      };

      const result = await connector.publishContent(content);

      expect(result.success).toBe(true);
      expect(result.platformPostId).toBe('reel-id');
      expect(result.platformUrl).toBe('https://www.instagram.com/reel/test456/');
      
      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/test-account-id/media',
        expect.objectContaining({
          media_type: 'REELS',
          video_url: 'https://example.com/video.mp4',
          caption: 'Test Reel caption\n\n#reels #video',
          thumb_offset: 0,
          share_to_feed: true,
        })
      );
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      const content = {
        contentId: 'test-carousel-1',
        caption: 'Carousel post',
        hashtags: ['carousel', 'multiple'],
        mediaType: 'carousel' as const,
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      const content = {
        contentId: 'test-content-1',
        caption: 'Test caption',
        mediaUrl: 'invalid-url',
        mediaType: 'image' as const,
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
      secretsManagerMock.on(GetSecretValueCommand).resolves({
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

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
      secretsManagerMock.on(GetSecretValueCommand).resolves({
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      await connector.deleteContent('test-post-id');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/test-post-id');
    });
  });

  describe('rate limiting', () => {
    it('should respect rate limits', async () => {
      secretsManagerMock.on(GetSecretValueCommand).resolves({
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      const content = {
        contentId: 'test-content-1',
        caption: 'Test',
        mediaUrl: 'https://example.com/image.jpg',
        mediaType: 'image' as const,
      };

      const result = await connector.publishContent(content);

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(true);
    });
  });
});