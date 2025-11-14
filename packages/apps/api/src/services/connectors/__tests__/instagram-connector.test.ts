import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstagramConnector } from '../instagram-connector.js';
import * as instagramService from '../../instagram.js';
import type { PublishRequest, Credentials, AccountIdentity } from '../types.js';

// Mock the Instagram service
vi.mock('../../instagram.js', () => ({
  instagramService: {
    publishMedia: vi.fn(),
    getRecentPosts: vi.fn(),
    getProfile: vi.fn(),
    getMediaInsights: vi.fn(),
    getPostComments: vi.fn(),
  },
}));

describe('InstagramConnector', () => {
  let connector: InstagramConnector;
  let mockCredentials: Credentials;
  let mockAccount: AccountIdentity;

  beforeEach(() => {
    connector = new InstagramConnector();
    mockCredentials = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
    };
    mockAccount = {
      platform: 'instagram',
      externalAccountId: 'ig-account-123',
      externalPageId: 'ig-page-456',
      username: 'testuser',
    };
    vi.clearAllMocks();
  });

  describe('platform metadata', () => {
    it('should have correct platform identifier', () => {
      expect(connector.platform).toBe('instagram');
    });

    it('should have correct capabilities', () => {
      expect(connector.capabilities).toEqual({
        publish: true,
        accountInsights: true,
        mediaInsights: true,
        comments: true,
        pagination: true,
      });
    });

    it('should have Instagram rate limits', () => {
      expect(connector.rateLimits).toEqual({
        apiCallsPerHour: 200,
        postsPerDay: 25,
      });
    });
  });

  describe('publish', () => {
    it('should successfully publish content with image', async () => {
      const publishRequest: PublishRequest = {
        caption: 'Test caption #test',
        hashtags: ['test', 'instagram'],
        imageUrl: 'https://cdn.example.com/image.jpg',
      };

      vi.mocked(instagramService.instagramService.publishMedia).mockResolvedValue({
        id: 'ig-post-123',
        permalink: 'https://www.instagram.com/p/abc123/',
      });

      const result = await connector.publish(publishRequest, mockCredentials, mockAccount);

      expect(result).toEqual({
        externalPostId: 'ig-post-123',
        permalink: 'https://www.instagram.com/p/abc123/',
        publishedAt: expect.any(String),
      });

      expect(instagramService.instagramService.publishMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          instagramAccountId: 'ig-account-123',
          instagramPageId: 'ig-page-456',
        }),
        {
          cdnImageUrl: 'https://cdn.example.com/image.jpg',
          caption: 'Test caption #test',
          hashtags: ['test', 'instagram'],
        }
      );
    });

    it('should successfully publish video content', async () => {
      const publishRequest: PublishRequest = {
        caption: 'Video post',
        hashtags: ['video'],
        mediaUrl: 'https://cdn.example.com/video.mp4',
        mediaType: 'video',
      };

      vi.mocked(instagramService.instagramService.publishMedia).mockResolvedValue({
        id: 'ig-video-456',
        permalink: 'https://www.instagram.com/p/video456/',
      });

      const result = await connector.publish(publishRequest, mockCredentials, mockAccount);

      expect(result.externalPostId).toBe('ig-video-456');
      expect(result.permalink).toBe('https://www.instagram.com/p/video456/');
    });

    it('should handle publish errors and map to platform errors', async () => {
      const publishRequest: PublishRequest = {
        caption: 'Test',
        hashtags: ['test'],
        imageUrl: 'https://cdn.example.com/image.jpg',
      };

      const igError = new Error('Invalid OAuth 2.0 Access Token');
      (igError as any).response = {
        data: {
          error: {
            code: 190,
            message: 'Invalid OAuth 2.0 Access Token',
          },
        },
      };

      vi.mocked(instagramService.instagramService.publishMedia).mockRejectedValue(igError);

      await expect(connector.publish(publishRequest, mockCredentials, mockAccount)).rejects.toThrow(
        'Invalid OAuth 2.0 Access Token'
      );
    });

    it('should format hashtags in caption', async () => {
      const publishRequest: PublishRequest = {
        caption: 'Great photo',
        hashtags: ['photography', 'nature'],
        imageUrl: 'https://cdn.example.com/image.jpg',
      };

      vi.mocked(instagramService.instagramService.publishMedia).mockResolvedValue({
        id: 'ig-123',
        permalink: 'https://instagram.com/p/123/',
      });

      await connector.publish(publishRequest, mockCredentials, mockAccount);

      expect(instagramService.instagramService.publishMedia).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          caption: 'Great photo',
          hashtags: ['photography', 'nature'],
        })
      );
    });
  });

  describe('listRecentPosts', () => {
    it('should fetch recent posts successfully', async () => {
      const mockPosts = [
        {
          id: 'post-1',
          caption: 'Post 1',
          media_url: 'https://instagram.com/photo1.jpg',
          timestamp: '2025-01-10T12:00:00Z',
          like_count: 100,
          comments_count: 10,
        },
        {
          id: 'post-2',
          caption: 'Post 2',
          media_url: 'https://instagram.com/photo2.jpg',
          timestamp: '2025-01-09T12:00:00Z',
          like_count: 80,
          comments_count: 5,
        },
      ];

      vi.mocked(instagramService.instagramService.getRecentPosts).mockResolvedValue(mockPosts);

      const result = await connector.listRecentPosts(mockCredentials, mockAccount, 10);

      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        externalPostId: 'post-1',
        caption: 'Post 1',
        mediaUrl: 'https://instagram.com/photo1.jpg',
        postedAt: '2025-01-10T12:00:00Z',
        metrics: {
          likes: 100,
          comments: 10,
          engagement: 110,
        },
      });

      expect(instagramService.instagramService.getRecentPosts).toHaveBeenCalledWith(
        expect.objectContaining({
          instagramAccountId: 'ig-account-123',
        }),
        10
      );
    });

    it('should handle pagination with cursor', async () => {
      vi.mocked(instagramService.instagramService.getRecentPosts).mockResolvedValue([]);

      await connector.listRecentPosts(mockCredentials, mockAccount, 25, 'cursor-abc');

      expect(instagramService.instagramService.getRecentPosts).toHaveBeenCalledWith(
        expect.any(Object),
        25
      );
    });

    it('should return empty array when no posts exist', async () => {
      vi.mocked(instagramService.instagramService.getRecentPosts).mockResolvedValue([]);

      const result = await connector.listRecentPosts(mockCredentials, mockAccount, 10);

      expect(result.data).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  describe('getAccountInsights', () => {
    it('should fetch account insights successfully', async () => {
      const mockProfile = {
        followers_count: 1500,
        follows_count: 300,
        media_count: 75,
        username: 'testuser',
      };

      vi.mocked(instagramService.instagramService.getProfile).mockResolvedValue(mockProfile);

      const result = await connector.getAccountInsights(mockCredentials, mockAccount, '7d');

      expect(result).toEqual({
        followers: 1500,
        following: 300,
        posts: 75,
        profileViews: 0,
        reach: 0,
        impressions: 0,
      });
    });

    it('should handle missing optional metrics', async () => {
      const mockProfile = {
        followers_count: 1000,
        media_count: 50,
      };

      vi.mocked(instagramService.instagramService.getProfile).mockResolvedValue(mockProfile);

      const result = await connector.getAccountInsights(mockCredentials, mockAccount, '30d');

      expect(result.followers).toBe(1000);
      expect(result.following).toBe(0);
      expect(result.posts).toBe(50);
    });
  });

  describe('getMediaInsights', () => {
    it('should fetch media insights successfully', async () => {
      const mockInsights = {
        like_count: 150,
        comments_count: 20,
        impressions: 1000,
        reach: 800,
        saved: 30,
      };

      vi.mocked(instagramService.instagramService.getMediaInsights).mockResolvedValue(mockInsights);

      const result = await connector.getMediaInsights(mockCredentials, mockAccount, 'media-123');

      expect(result).toEqual({
        likes: 150,
        comments: 20,
        shares: 0,
        saves: 30,
        reach: 800,
        impressions: 1000,
        engagement: 170,
        engagementRate: expect.any(Number),
      });

      expect(instagramService.instagramService.getMediaInsights).toHaveBeenCalledWith(
        expect.objectContaining({
          instagramAccountId: 'ig-account-123',
        }),
        'media-123'
      );
    });

    it('should calculate engagement rate correctly', async () => {
      const mockInsights = {
        like_count: 100,
        comments_count: 10,
        impressions: 1000,
        reach: 800,
      };

      vi.mocked(instagramService.instagramService.getMediaInsights).mockResolvedValue(mockInsights);

      const result = await connector.getMediaInsights(mockCredentials, mockAccount, 'media-123');

      // Engagement rate = (likes + comments) / impressions * 100
      // (100 + 10) / 1000 * 100 = 11%
      expect(result.engagementRate).toBeCloseTo(11.0, 1);
    });

    it('should handle zero impressions when calculating engagement rate', async () => {
      const mockInsights = {
        like_count: 50,
        comments_count: 5,
        impressions: 0,
      };

      vi.mocked(instagramService.instagramService.getMediaInsights).mockResolvedValue(mockInsights);

      const result = await connector.getMediaInsights(mockCredentials, mockAccount, 'media-123');

      expect(result.engagementRate).toBe(0);
    });
  });

  describe('getComments', () => {
    it('should fetch comments successfully', async () => {
      const mockComments = [
        {
          id: 'comment-1',
          text: 'Great post!',
          username: 'user1',
          timestamp: '2025-01-10T12:00:00Z',
        },
        {
          id: 'comment-2',
          text: 'Love it!',
          username: 'user2',
          timestamp: '2025-01-10T11:00:00Z',
        },
      ];

      vi.mocked(instagramService.instagramService.getPostComments).mockResolvedValue({
        data: mockComments,
        total: 2,
      });

      const result = await connector.getComments(mockCredentials, mockAccount, 'post-123', 10);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.data[0]).toEqual({
        id: 'comment-1',
        text: 'Great post!',
        author: 'user1',
        createdAt: '2025-01-10T12:00:00Z',
      });

      expect(instagramService.instagramService.getPostComments).toHaveBeenCalledWith(
        expect.objectContaining({
          instagramAccountId: 'ig-account-123',
        }),
        'post-123',
        10
      );
    });

    it('should return empty array when no comments exist', async () => {
      vi.mocked(instagramService.instagramService.getPostComments).mockResolvedValue({
        data: [],
        total: 0,
      });

      const result = await connector.getComments(mockCredentials, mockAccount, 'post-123', 10);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle rate limit errors', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).response = {
        data: {
          error: {
            code: 4,
            message: 'Application request limit reached',
          },
        },
      };

      vi.mocked(instagramService.instagramService.publishMedia).mockRejectedValue(rateLimitError);

      await expect(
        connector.publish(
          {
            caption: 'Test',
            hashtags: [],
            imageUrl: 'https://example.com/img.jpg',
          },
          mockCredentials,
          mockAccount
        )
      ).rejects.toThrow();
    });

    it('should handle token expiration errors', async () => {
      const tokenError = new Error('Token expired');
      (tokenError as any).response = {
        data: {
          error: {
            code: 190,
            message: 'Error validating access token',
          },
        },
      };

      vi.mocked(instagramService.instagramService.getProfile).mockRejectedValue(tokenError);

      await expect(
        connector.getAccountInsights(mockCredentials, mockAccount, '7d')
      ).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network error');

      vi.mocked(instagramService.instagramService.getRecentPosts).mockRejectedValue(networkError);

      await expect(connector.listRecentPosts(mockCredentials, mockAccount, 10)).rejects.toThrow(
        'Network error'
      );
    });
  });
});
