/**
 * TikTok Connector Unit Tests
 */

import { TikTokConnector } from '../../../lib/lambda/platform-connectors/tiktok-connector';
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

describe('TikTokConnector', () => {
  let connector: TikTokConnector;

  beforeEach(() => {
    jest.clearAllMocks();
    secretsManagerMock.reset();
    connector = new TikTokConnector();
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

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
      secretsManagerMock.on(GetSecretValueCommand).resolves({
        SecretString: JSON.stringify({
          accessToken: 'invalid-token',
        }),
      });

      const mockApiClient = {
        get: jest.fn().mockRejectedValue(new Error('Invalid access token')),
      };
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      await expect(connector.authenticate()).rejects.toThrow('Failed to authenticate with TikTok');
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

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
        mediaType: 'video' as const,
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
        mediaType: 'image' as const,
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      mockedAxios.get.mockResolvedValue({
        data: Buffer.from('video-content'),
      });
      mockedAxios.put.mockResolvedValue({ data: { success: true } });

      const content = {
        contentId: 'test-video-2',
        caption: 'Video with music',
        hashtags: ['music', 'dance'],
        videoUrl: 'https://example.com/video.mp4',
        mediaType: 'video' as const,
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      const content = {
        contentId: 'test-video-1',
        caption: 'Test video',
        videoUrl: 'https://example.com/video.mp4',
        mediaType: 'video' as const,
      };

      const result = await connector.publishContent(content);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('TIKTOK_PUBLISH_ERROR');
    });
  });

  describe('getInsights', () => {
    beforeEach(async () => {
      secretsManagerMock.on(GetSecretValueCommand).resolves({
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

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
      secretsManagerMock.on(GetSecretValueCommand).resolves({
        SecretString: JSON.stringify({
          accessToken: 'test-access-token',
        }),
      });
    });

    it('should indicate that deletion is not supported', async () => {
      const mockApiClient = {
        get: jest.fn(),
      };
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      await expect(connector.deleteContent('test-post-id')).rejects.toThrow(
        'TikTok API does not support content deletion'
      );
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
      mockedAxios.create.mockReturnValue(mockApiClient as any);

      await connector.authenticate();

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://open.tiktokapis.com/v2/oauth/token/',
        expect.objectContaining({
          grant_type: 'refresh_token',
          refresh_token: 'refresh-token',
        })
      );
    });
  });

  describe('rate limiting', () => {
    it('should identify rate limit errors as retryable', async () => {
      secretsManagerMock.on(GetSecretValueCommand).resolves({
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