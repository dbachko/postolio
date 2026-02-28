import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildFastify } from '../../server.js';
import { ConnectorFactory } from '../../services/connectors/index.js';
import type { Connector } from '../../services/connectors/types.js';

// Keep CSRF behavior out of unit tests; mock these plugins as no-ops.
vi.mock('@fastify/csrf-protection', () => ({
  default: (async () => {}) as any,
}));

vi.mock('../../plugins/csrf-auto-protect.js', () => ({
  default: (async () => {}) as any,
}));

// Disable Redis-backed rate limiting in these tests to avoid
// stateful 429 responses when hitting sync endpoints repeatedly.
vi.mock('../../services/redis.js', () => {
  const redisService = {
    increment: vi.fn(async () => null),
    del: vi.fn(async () => true),
    getClient: vi.fn(() => null),
    set: vi.fn(async () => false),
    setex: vi.fn(async () => false),
    disconnect: vi.fn(async () => {}),
    isConnected: vi.fn(() => false),
  };

  return {
    redisService,
    getRedisClient: vi.fn(() => null),
    createRedisClient: vi.fn(() => null),
  };
});

// Mock dependencies
vi.mock('../../config/database.js', () => {
  const mockClient = {
    socialAccount: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    content: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    contentPublication: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    contentMediaAsset: {
      create: vi.fn(),
    },
    brand: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(mockClient)),
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => mockClient),
    prisma: mockClient,
  };
});

vi.mock('../../services/connectors/index.js', () => ({
  ConnectorFactory: {
    get: vi.fn(),
    supports: vi.fn(),
    supportedPlatforms: vi.fn(() => ['instagram']),
  },
}));

vi.mock('../../utils/token-service-client.js', () => ({
  fetchTokensFromService: vi.fn(() =>
    Promise.resolve({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    })
  ),
  fetchTokensForSocialAccountFromService: vi.fn(() =>
    Promise.resolve({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    })
  ),
}));

vi.mock('../../services/service-clients.js', () => ({
  getTokenService: vi.fn(async () => ({
    deleteTokenForSocialAccount: vi.fn(async () => true),
  })),
}));

vi.mock('../../services/assets-media.js', () => ({
  getAssetsClient: vi.fn(() => ({
    getBatchAssets: vi.fn(async (assetIds: string[]) =>
      assetIds.map((assetId) => ({
        id: assetId,
        brandId: 'brand-123',
        fileType: 'image',
        url: 'https://cdn.example.com/image.jpg',
        s3Key: `assets/${assetId}`,
        width: 1080,
        height: 1080,
      }))
    ),
    importFromUrl: vi.fn(async () => ({
      id: 'imported-asset-1',
      brandId: 'brand-123',
      fileType: 'image',
      url: 'https://cdn.example.com/imported.jpg',
      s3Key: 'assets/imported-asset-1',
      width: 1080,
      height: 1080,
    })),
  })),
}));

describe('Social Platform Routes', () => {
  let app: FastifyInstance;
  let mockPrisma: any;
  let mockConnector: Connector;
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create mock connector
    mockConnector = {
      platform: 'instagram',
      capabilities: {
        publish: true,
        accountInsights: true,
        mediaInsights: true,
        comments: true,
        pagination: true,
      },
      rateLimits: {
        apiCallsPerHour: 200,
        postsPerDay: 25,
      },
      publish: vi.fn(),
      listRecentPosts: vi.fn(),
      getAccountInsights: vi.fn(),
      getMediaInsights: vi.fn(),
      getComments: vi.fn(),
    };

    vi.mocked(ConnectorFactory.get).mockReturnValue(mockConnector);
    vi.mocked(ConnectorFactory.supports).mockImplementation((platform) => platform === 'instagram');

    // Build Fastify app and wait for plugins to be ready
    app = buildFastify();
    await app.ready();

    // Generate a valid JWT for tests using the app's jwt decorator
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - jwt decorator is added by @fastify/jwt
    authHeader = `Bearer ${await (app as any).jwt.sign({
      id: 'user-123',
      email: 'test-user@example.com',
    })}`;

    // Get mock Prisma instance
    const { getDatabaseClient } = await import('../../config/database.js');
    mockPrisma = getDatabaseClient();

    mockPrisma.socialAccount.findMany.mockResolvedValue([]);
  });

  describe('GET /api/social/:platform/status/:brandId', () => {
    it('should return connected status when social account exists', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({
        id: 'brand-123',
        userId: 'user-123',
        name: 'Test Brand',
      });

      const socialAccount = {
        id: 'social-account-123',
        brandId: 'brand-123',
        platform: 'instagram',
        externalAccountId: 'ig-account-123',
        externalPageId: null,
        username: null,
        displayName: 'testuser',
        metadata: null,
        createdAt: new Date(),
        sortOrder: 0,
      };
      mockPrisma.socialAccount.findMany.mockResolvedValue([socialAccount]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/social/instagram/status/brand-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.connected).toBe(true);
      expect(payload.account).toBeDefined();
      expect(payload.account.platform).toBe('instagram');
    });

    it('should return not connected when social account does not exist', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({
        id: 'brand-123',
        userId: 'user-123',
      });

      mockPrisma.socialAccount.findUnique.mockResolvedValue(null);
      mockPrisma.socialAccount.findFirst.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/social/instagram/status/brand-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.connected).toBe(false);
      expect(payload.account).toBeNull();
    });

    it('should return 400 for unsupported platform', async () => {
      vi.mocked(ConnectorFactory.supports).mockReturnValue(false);

      const response = await app.inject({
        method: 'GET',
        url: '/api/social/unsupported/status/brand-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.error).toContain('unsupported_platform');
    });

    it('should return 404 when brand not found', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/social/instagram/status/brand-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/social/instagram/status/brand-123',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/social/:platform/publish/:contentId', () => {
    it('should successfully publish content', async () => {
      mockPrisma.content.findUnique.mockResolvedValue({
        id: 'content-123',
        brandId: 'brand-123',
        caption: 'Test post',
        hashtags: ['test', 'instagram'],
        status: 'scheduled',
        contentType: 'post',
        shareToFeed: null,
        thumbOffset: null,
        mediaAssets: [{ assetId: 'asset-1', displayOrder: 0 }],
        brand: {
          id: 'brand-123',
          userId: 'user-123',
        },
      });

      const socialAccount = {
        id: 'social-account-123',
        brandId: 'brand-123',
        platform: 'instagram',
        externalAccountId: 'ig-account-123',
        externalPageId: null,
        username: null,
        displayName: null,
        metadata: null,
        createdAt: new Date(),
        sortOrder: 0,
      };
      mockPrisma.socialAccount.findMany.mockResolvedValue([socialAccount]);

      mockPrisma.socialAccount.upsert.mockResolvedValue({
        id: 'social-account-123',
      });

      vi.mocked(mockConnector.publish).mockResolvedValue({
        externalPostId: 'ig-post-789',
        permalink: 'https://instagram.com/p/abc123/',
        publishedAt: new Date().toISOString(),
      });

      mockPrisma.contentPublication.create.mockResolvedValue({
        id: 'publication-123',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/social/instagram/publish/content-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(true);
      expect(payload.externalPostId).toBe('ig-post-789');
      expect(payload.permalink).toBe('https://instagram.com/p/abc123/');
    });

    it('should return 400 when content not found', async () => {
      mockPrisma.content.findUnique.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/api/social/instagram/publish/content-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 when social account not connected', async () => {
      mockPrisma.content.findUnique.mockResolvedValue({
        id: 'content-123',
        brandId: 'brand-123',
        brand: { id: 'brand-123', userId: 'user-123' },
      });

      mockPrisma.socialAccount.findUnique.mockResolvedValue(null);
      mockPrisma.socialAccount.findFirst.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/api/social/instagram/publish/content-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.error).toContain('not connected');
    });

    it('should handle publish errors gracefully', async () => {
      mockPrisma.content.findUnique.mockResolvedValue({
        id: 'content-123',
        brandId: 'brand-123',
        caption: 'Test',
        hashtags: ['test'],
        contentType: 'post',
        shareToFeed: null,
        thumbOffset: null,
        mediaAssets: [{ assetId: 'asset-1', displayOrder: 0 }],
        brand: { id: 'brand-123', userId: 'user-123' },
      });

      const socialAccount = {
        id: 'social-account-123',
        brandId: 'brand-123',
        platform: 'instagram',
        externalAccountId: 'ig-account-123',
        externalPageId: null,
        username: null,
        displayName: null,
        metadata: null,
        createdAt: new Date(),
        sortOrder: 0,
      };
      mockPrisma.socialAccount.findMany.mockResolvedValue([socialAccount]);

      vi.mocked(mockConnector.publish).mockRejectedValue(new Error('Rate limit exceeded'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/social/instagram/publish/content-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(500);
      const payload = JSON.parse(response.payload);
      expect(payload.error).toBe('publish_failed');
      expect(payload.message).toContain('Rate limit exceeded');
    });
  });

  describe('POST /api/social/:platform/sync/:brandId', () => {
    it('should successfully sync posts from platform', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({
        id: 'brand-123',
        userId: 'user-123',
      });

      const socialAccount = {
        id: 'social-account-123',
        brandId: 'brand-123',
        platform: 'instagram',
        externalAccountId: 'ig-account-123',
        externalPageId: null,
        username: null,
        displayName: null,
        metadata: null,
        createdAt: new Date(),
        sortOrder: 0,
      };
      mockPrisma.socialAccount.findMany.mockResolvedValue([socialAccount]);

      vi.mocked(mockConnector.listRecentPosts).mockResolvedValue({
        data: [
          {
            id: 'post-1',
            caption: 'Post 1',
            mediaUrl: 'https://instagram.com/photo.jpg',
            postedAt: '2025-01-10T12:00:00Z',
            metrics: { likes: 100, comments: 10, engagement: 110 },
          },
        ],
      });

      mockPrisma.content.create.mockResolvedValue({
        id: 'content-synced-1',
      });

      mockPrisma.contentPublication.findFirst.mockResolvedValue(null);
      mockPrisma.contentPublication.create.mockResolvedValue({});

      const response = await app.inject({
        method: 'POST',
        url: '/api/social/instagram/sync/brand-123',
        headers: {
          authorization: authHeader,
        },
        payload: {
          maxPosts: 10,
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(true);
      expect(payload.synced).toBeGreaterThanOrEqual(0);
      expect(payload.results.synced).toBeGreaterThanOrEqual(0);
      expect(mockPrisma.content.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            targetSocialAccountId: socialAccount.id,
          }),
        })
      );
    });

    it('should skip posts that already exist for the brand and platform', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({
        id: 'brand-123',
        userId: 'user-123',
      });

      const socialAccount = {
        id: 'social-account-123',
        brandId: 'brand-123',
        platform: 'instagram',
        externalAccountId: 'ig-account-123',
        externalPageId: null,
        username: null,
        displayName: null,
        metadata: null,
        createdAt: new Date(),
        sortOrder: 0,
      };
      mockPrisma.socialAccount.findMany.mockResolvedValue([socialAccount]);

      vi.mocked(mockConnector.listRecentPosts).mockResolvedValue({
        data: [
          {
            id: 'post-1',
            caption: 'Existing post',
            mediaUrl: 'https://instagram.com/photo.jpg',
            postedAt: '2025-01-10T12:00:00Z',
          },
        ],
      });

      // Simulate an existing publication for this externalPostId at the brand+platform level
      mockPrisma.contentPublication.findFirst.mockResolvedValue({
        id: 'publication-1',
        contentId: 'content-1',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/social/instagram/sync/brand-123',
        headers: {
          authorization: authHeader,
        },
        payload: {
          maxPosts: 10,
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(true);
      expect(payload.synced).toBe(0);
      expect(payload.skipped).toBe(1);
      // Ensure no new content or publication were created
      expect(mockPrisma.content.create).not.toHaveBeenCalled();
      expect(mockPrisma.contentPublication.create).not.toHaveBeenCalled();
    });

    it('should return 404 when brand not found', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/api/social/instagram/sync/brand-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/social/:platform/disconnect/:brandId', () => {
    it('should successfully disconnect social account', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({
        id: 'brand-123',
        userId: 'user-123',
      });

      const socialAccount = {
        id: 'social-account-123',
        brandId: 'brand-123',
        platform: 'instagram',
        externalAccountId: 'ig-account-123',
        externalPageId: 'fb-page-123',
        username: 'testuser',
        displayName: 'Test User',
        metadata: {},
        createdAt: new Date(),
        sortOrder: 0,
      };
      mockPrisma.socialAccount.findMany.mockResolvedValue([socialAccount]);
      mockPrisma.socialAccount.update.mockResolvedValue({});

      const response = await app.inject({
        method: 'POST',
        url: '/api/social/instagram/disconnect/brand-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(true);
    });

    it('should return 404 when brand not found', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/api/social/instagram/disconnect/brand-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/social/:platform/insights/:contentId', () => {
    it('should successfully fetch post insights', async () => {
      mockPrisma.content.findUnique.mockResolvedValue({
        id: 'content-123',
        brandId: 'brand-123',
        brand: { id: 'brand-123', userId: 'user-123' },
      });

      mockPrisma.contentPublication.findMany.mockResolvedValue([
        {
          id: 'publication-123',
          contentId: 'content-123',
          platform: 'instagram',
          externalPostId: 'ig-post-123',
          socialAccountId: 'social-account-123',
          socialAccount: {
            id: 'social-account-123',
            brandId: 'brand-123',
            brand: { id: 'brand-123', userId: 'user-123' },
            platform: 'instagram',
            externalAccountId: 'ig-account-123',
            externalPageId: 'fb-page-123',
            username: 'testuser',
          },
        },
      ]);

      vi.mocked(mockConnector.getMediaInsights).mockResolvedValue({
        likes: 100,
        comments: 10,
        shares: 5,
        saves: 20,
        reach: 1000,
        impressions: 1200,
        engagement: 135,
        engagementRate: 11.25,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/social/instagram/insights/content-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.platform).toBe('instagram');
      expect(payload.insights.likes).toBe(100);
      expect(payload.insights.engagement).toBe(135);
    });

    it('should return 404 when content not found', async () => {
      mockPrisma.content.findUnique.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/social/instagram/insights/content-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 404 when content not published', async () => {
      mockPrisma.content.findUnique.mockResolvedValue({
        id: 'content-123',
        brandId: 'brand-123',
        brand: { id: 'brand-123', userId: 'user-123' },
      });

      mockPrisma.contentPublication.findMany.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/social/instagram/insights/content-123',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(404);
      const payload = JSON.parse(response.payload);
      expect(payload.error).toContain('not published');
    });
  });

  describe('Platform validation', () => {
    it('should reject requests for unsupported platforms', async () => {
      vi.mocked(ConnectorFactory.supports).mockReturnValue(false);

      const endpoints = [
        'GET /api/social/facebook/status/brand-123',
        'POST /api/social/linkedin/publish/content-123',
        'POST /api/social/tiktok/sync/brand-123',
        'POST /api/social/youtube/disconnect/brand-123',
      ];

      for (const endpoint of endpoints) {
        const [method, url] = endpoint.split(' ');
        const response = await app.inject({
          method: method as any,
          url,
          headers: {
            authorization: authHeader,
          },
        });

        expect(response.statusCode).toBe(400);
        const payload = JSON.parse(response.payload);
        expect(payload.error).toContain('unsupported_platform');
      }
    });
  });
});
