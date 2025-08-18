/**
 * YouTube Connector Unit Tests
 */

import { YouTubeConnector } from '../../../lib/lambda/platform-connectors/youtube-connector';
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

describe('YouTubeConnector', () => {
  let connector: YouTubeConnector;

  beforeEach(() => {
    jest.clearAllMocks();
    secretsManagerMock.reset();
    connector = new YouTubeConnector();
  });

  describe('authenticate', () => {
    it('should authenticate successfully with valid credentials', async () => {
      // Mock Secrets Manager
      secretsManagerMock.on(GetSecretValueCommand).resolves({
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

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
      secretsManagerMock.on(GetSecretValueCommand).resolves({
        SecretString: JSON.stringify({
          accessToken: 'invalid-token',
        }),
      });

      const mockApiClient = {
        get: jest.fn().mockRejectedValue(new Error('Invalid credentials')),
      };
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      await expect(connector.authenticate()).rejects.toThrow('Failed to authenticate with YouTube');
    });
  });

  describe('publishContent', () => {
    beforeEach(async () => {
      // Setup authenticated connector
      secretsManagerMock.on(GetSecretValueCommand).resolves({
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

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
        mediaType: 'video' as const,
      };

      const result = await connector.publishContent(content);

      expect(result.success).toBe(true);
      expect(result.platformPostId).toBe('youtube-video-id');
      expect(result.platformUrl).toBe('https://www.youtube.com/watch?v=youtube-video-id');
      expect(result.publishedAt).toBeDefined();

      // Verify video metadata
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://www.googleapis.com/upload/youtube/v3/videos',
        expect.objectContaining({
          snippet: expect.objectContaining({
            title: expect.stringContaining('Test YouTube video'),
            description: expect.stringContaining('#youtube #test'),
            tags: expect.arrayContaining(['youtube', 'test']),
          }),
          status: expect.objectContaining({
            privacyStatus: 'public',
          }),
        }),
        expect.objectContaining({
          params: {
            part: 'snippet,status',
            uploadType: 'resumable',
          },
        })
      );
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

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
        mediaType: 'video' as const,
        duration: 45, // Less than 60 seconds
        aspectRatio: '9:16', // Vertical video
      };

      const result = await connector.publishContent(content);

      expect(result.success).toBe(true);
      
      // Verify #Shorts tag was added
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          snippet: expect.objectContaining({
            title: expect.stringContaining('#Shorts'),
            tags: expect.arrayContaining(['Shorts']),
          }),
        }),
        expect.any(Object)
      );
    });

    it('should reject non-video content', async () => {
      const content = {
        contentId: 'test-image-1',
        caption: 'Test image',
        mediaUrl: 'https://example.com/image.jpg',
        mediaType: 'image' as const,
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

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
        mediaType: 'video' as const,
      };

      const result = await connector.publishContent(content);

      expect(result.success).toBe(true);
      
      // Verify thumbnail upload
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://www.googleapis.com/upload/youtube/v3/thumbnails/set',
        expect.any(Buffer),
        expect.objectContaining({
          params: {
            videoId: 'youtube-video-with-thumb',
          },
        })
      );
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

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
        mediaType: 'video' as const,
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
      secretsManagerMock.on(GetSecretValueCommand).resolves({
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
        .mockReturnValueOnce(mockApiClient as any)
        .mockReturnValueOnce(mockAnalyticsClient as any);

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
      secretsManagerMock.on(GetSecretValueCommand).resolves({
        SecretString: JSON.stringify({
          accessToken: 'test-access-token',
        }),
      });
    });

    it('should delete video successfully', async () => {
      const mockApiClient = {
        delete: jest.fn().mockResolvedValue({ data: { success: true } }),
      };
      mockedAxios.create.mockReturnValue(mockApiClient as any);

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
      secretsManagerMock.on(GetSecretValueCommand).resolves({
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      await connector.authenticate();

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          grant_type: 'refresh_token',
          refresh_token: 'refresh-token',
        })
      );
    });
  });

  describe('rate limiting', () => {
    it('should identify quota exceeded errors as retryable', async () => {
      secretsManagerMock.on(GetSecretValueCommand).resolves({
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      const content = {
        contentId: 'test-video-1',
        caption: 'Test',
        videoUrl: 'https://example.com/video.mp4',
        mediaType: 'video' as const,
      };

      const result = await connector.publishContent(content);

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(true);
    });
  });
});