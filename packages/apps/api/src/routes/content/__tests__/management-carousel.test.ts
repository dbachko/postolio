import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildFastify } from '../../../server.js';

// Keep CSRF behavior out of unit tests; mock these plugins as no-ops.
vi.mock('@fastify/csrf-protection', () => ({
  default: (async () => {}) as any,
}));

vi.mock('../../../plugins/csrf-auto-protect.js', () => ({
  default: (async () => {}) as any,
}));

// Disable Redis-backed rate limiting in these tests to avoid
// stateful 429 responses when hitting endpoints repeatedly.
vi.mock('../../../services/redis.js', () => {
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

// Avoid starting real BullMQ workers during tests.
vi.mock('../../../services/regeneration-queue.js', () => ({
  regenerationService: {
    startRegeneration: vi.fn(),
    getJobProgress: vi.fn(),
    cancelJob: vi.fn(),
  },
}));

// Minimal in-memory Prisma mock for this suite
vi.mock('../../../config/database.js', () => {
  const contents: any[] = [];
  const prisma = {
    content: {
      create: vi.fn(async (args: any) => {
        const select = args?.select;
        const data = args?.data ?? {};
        const base = {
          id: `content-${contents.length + 1}`,
          caption: data.caption,
          hashtags: data.hashtags ?? [],
          status: data.status ?? 'draft',
          brandId: data.brandId,
          generationParams: data.generationParams,
          createdAt: new Date(),
          updatedAt: new Date(),
          contentType: data.contentType ?? 'post',
          shareToFeed: data.shareToFeed ?? null,
          campaignId: data.campaignId ?? null,
          schedulingError: data.schedulingError ?? null,
          scheduledAt: data.scheduledAt ?? null,
          postedAt: data.postedAt ?? null,
          firstComment: data.firstComment ?? null,
          firstCommentStatus: data.firstCommentStatus ?? null,
          firstCommentPostedAt: data.firstCommentPostedAt ?? null,
          firstCommentError: data.firstCommentError ?? null,
          mediaAssets: [],
        };
        contents.push(base);
        if (!select) return base;
        const picked: any = {};
        for (const key of Object.keys(select)) {
          if (select[key]) picked[key] = (base as any)[key];
        }
        return picked;
      }),
      update: vi.fn(),
      findUnique: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        const record = contents.find((c) => c.id === id) ?? null;
        if (!record) return null;
        const select = args?.select;
        if (!select) return record;
        const picked: any = {};
        for (const key of Object.keys(select)) {
          if (select[key]) picked[key] = (record as any)[key];
        }
        return picked;
      }),
    },
    brand: {
      findFirst: vi.fn(async () => ({
        id: 'brand-1',
        userId: 'user-123',
        name: 'Test Brand',
      })),
      findUnique: vi.fn(async () => ({
        preferences: {},
      })),
    },
    socialAccount: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    contentMediaAsset: {
      createMany: vi.fn(async () => ({ count: 1 })),
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma)),
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

// Mock brand/content ownership helpers to always authorize
vi.mock('../../../services/content-operations/authorization.js', () => ({
  verifyBrandOwnership: vi.fn(async () => ({ authorized: true })),
  verifyContentOwnership: vi.fn(),
  verifyContentDeletable: vi.fn(),
  verifyCampaignAccess: vi.fn(async () => ({ authorized: true })),
}));

vi.mock('../../../services/assets-media.js', () => {
  const getAssetsClient = vi.fn(() => ({
    getBatchAssets: vi.fn(async (assetIds: string[]) =>
      assetIds.map((assetId) => ({
        id: assetId,
        brandId: 'brand-1',
        fileType: 'image',
        url: `https://cdn.example.com/assets/${assetId}.jpg`,
        width: 1080,
        height: 1080,
      }))
    ),
  }));

  return {
    getAssetsClient,
    verifyAssetOwnership: vi.fn(),
    attachAssetToContent: vi.fn(),
    importImageFromExternalUrl: vi.fn(),
    importImageBuffer: vi.fn(),
  };
});

// Re-import mocked helpers for finer-grained control in tests
import { getAssetsClient } from '../../../services/assets-media.js';

describe('Content management carousel assets', () => {
  let app: FastifyInstance;
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = buildFastify();
    await app.ready();

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - jwt decorator is added by @fastify/jwt
    const token = await (app as any).jwt.sign({
      id: 'user-123',
      email: 'test-user@example.com',
    });
    authHeader = `Bearer ${token}`;
  });

  it('creates content when a single assetId is provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/content',
      headers: {
        authorization: authHeader,
        'content-type': 'application/json',
      },
      payload: {
        brandId: 'brand-1',
        caption: 'Test caption',
        hashtags: [],
        mediaType: 'image',
        contentType: 'post',
        assetIds: ['asset-1'],
      },
    });

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.payload);
    expect(payload?.content?.id).toBeDefined();
  });

  it('creates content when multiple assetIds are provided for carousel', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/content',
      headers: {
        authorization: authHeader,
        'content-type': 'application/json',
      },
      payload: {
        brandId: 'brand-1',
        caption: 'Test carousel caption',
        hashtags: [],
        mediaType: 'image',
        contentType: 'post',
        assetIds: ['asset-1', 'asset-2'],
      },
    });

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.payload);
    expect(payload?.content?.id).toBeDefined();
  });

  it('allows drafts when carousel assets have mismatched aspect ratios', async () => {
    (getAssetsClient as any).mockImplementation(() => ({
      getBatchAssets: vi.fn(async (assetIds: string[]) =>
        assetIds.map((assetId, index) => ({
          id: assetId,
          brandId: 'brand-1',
          url: `https://cdn.example.com/assets/${assetId}.jpg`,
          // First asset square, second asset wide to trigger mismatch
          width: index === 0 ? 1080 : 1920,
          height: 1080,
        }))
      ),
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/content',
      headers: {
        authorization: authHeader,
        'content-type': 'application/json',
      },
      payload: {
        brandId: 'brand-1',
        caption: 'Test mismatched carousel caption',
        hashtags: [],
        mediaType: 'image',
        contentType: 'post',
        assetIds: ['asset-1', 'asset-2'],
      },
    });

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.payload);
    expect(payload?.content?.id).toBeDefined();
  });

  it('rejects scheduled content when carousel assets have mismatched aspect ratios', async () => {
    (getAssetsClient as any).mockImplementation(() => ({
      getBatchAssets: vi.fn(async (assetIds: string[]) =>
        assetIds.map((assetId, index) => ({
          id: assetId,
          brandId: 'brand-1',
          url: `https://cdn.example.com/assets/${assetId}.jpg`,
          // First asset square, second asset wide to trigger mismatch
          width: index === 0 ? 1080 : 1920,
          height: 1080,
        }))
      ),
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/content',
      headers: {
        authorization: authHeader,
        'content-type': 'application/json',
      },
      payload: {
        brandId: 'brand-1',
        caption: 'Test scheduled carousel caption',
        hashtags: [],
        mediaType: 'image',
        contentType: 'post',
        assetIds: ['asset-1', 'asset-2'],
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(400);
    const payload = JSON.parse(response.payload);
    expect(payload?.error).toContain('same aspect ratio');
  });
});
