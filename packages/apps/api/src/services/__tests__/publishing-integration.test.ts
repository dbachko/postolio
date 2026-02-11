import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Prisma client so publishContent does not hit a real database.
vi.mock('../../config/database.js', () => {
  const mockClient = {
    content: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    socialAccount: {
      findFirst: vi.fn(),
    },
    contentPublication: {
      create: vi.fn(),
    },
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => mockClient),
    prisma: mockClient,
  };
});

// Mock ConnectorFactory to isolate publishContent from real connectors.
vi.mock('../connectors/index.js', () => {
  const publish = vi.fn(async () => ({
    externalPostId: 'connector-post-123',
    permalink: 'https://instagram.com/p/connector-post-123',
    publishedAt: new Date().toISOString(),
  }));

  const mockConnector = {
    platform: 'instagram',
    capabilities: {},
    rateLimits: {},
    publish,
    listRecentPosts: vi.fn(),
  } as any;

  const ConnectorFactory = {
    get: vi.fn(() => mockConnector),
    supports: vi.fn(() => true),
    supportedPlatforms: vi.fn(() => ['instagram']),
  };

  return { ConnectorFactory, __mockConnector: mockConnector };
});

// Mock Token Service helper so no network calls are made.
vi.mock('../../utils/token-service-client.js', () => ({
  fetchTokensForSocialAccountFromService: vi.fn(async () => ({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
  })),
}));

vi.mock('../social-account-resolver.js', () => ({
  resolvePrimarySocialAccount: vi.fn(),
}));

vi.mock('../assets-media.js', () => ({
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
  })),
}));

// Import after mocks
const { getDatabaseClient } = await import('../../config/database.js');
const { ConnectorFactory, __mockConnector } = await import('../connectors/index.js' as any);
const { resolvePrimarySocialAccount } = await import('../social-account-resolver.js');
const { publishContent } = await import('../content-operations/publishing.js');

describe('publishContent (connector integration)', () => {
  let mockPrisma: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = getDatabaseClient();
  });

  it('should call connector.publish and persist ContentPublication', async () => {
    mockPrisma.content.findUnique.mockResolvedValue({
      id: 'content-123',
      brandId: 'brand-123',
      caption: 'Test caption',
      hashtags: ['test'],
      contentType: 'post',
      shareToFeed: null,
      thumbOffset: null,
      mediaAssets: [{ assetId: 'asset-1', displayOrder: 0 }],
      brand: {
        id: 'brand-123',
        userId: 'user-123',
      },
    });

    (resolvePrimarySocialAccount as any).mockResolvedValue({
      id: 'social-account-123',
      brandId: 'brand-123',
      platform: 'instagram',
      externalAccountId: 'ig-account-123',
      externalPageId: 'fb-page-123',
      username: 'testuser',
      displayName: null,
      metadata: {},
    });

    const result = await publishContent('content-123', 'instagram');

    expect(result.success).toBe(true);
    expect(result.data?.platform).toBe('instagram');
    expect(result.data?.externalPostId).toBe('connector-post-123');

    // ConnectorFactory should be consulted for the platform
    expect(ConnectorFactory.get).toHaveBeenCalledWith('instagram');

    // Connector publish should be called with normalized request
    expect(__mockConnector.publish).toHaveBeenCalledTimes(1);
    const [publishReq, publishCreds, publishAccount] = (__mockConnector.publish as any).mock
      .calls[0];
    expect(publishReq.caption).toBe('Test caption');
    expect(publishCreds.accessToken).toBe('test-access-token');
    expect(publishAccount.platform).toBe('instagram');
    expect(publishAccount.externalAccountId).toBe('ig-account-123');

    // Prisma should persist publication + update content status
    expect(mockPrisma.content.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.contentPublication.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.contentPublication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentId: 'content-123',
          socialAccountId: 'social-account-123',
          platform: 'instagram',
          externalPostId: 'connector-post-123',
        }),
      })
    );
  });
});
