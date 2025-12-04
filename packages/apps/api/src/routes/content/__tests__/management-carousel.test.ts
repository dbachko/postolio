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
vi.mock('../../../services/redis.js', () => ({
  getRedisClient: vi.fn(() => null),
}));

// Minimal in-memory Prisma mock for this suite
vi.mock('../../../config/database.js', () => {
  const prisma = {
    content: {
      create: vi.fn(async (args: any) => {
        const select = args?.select;
        const data = args?.data ?? {};
        const base = {
          id: 'content-1',
          caption: data.caption,
          hashtags: data.hashtags ?? [],
          primaryAssetCdnUrl: null,
          primaryAssetId: null,
          primaryAssetHeight: null,
          primaryAssetWidth: null,
          status: data.status ?? 'draft',
          brandId: data.brandId,
          generationParams: data.generationParams,
          createdAt: new Date(),
          mediaType: data.mediaType ?? 'image',
          contentType: data.contentType ?? 'post',
          videoUrl: data.videoUrl ?? null,
        };
        if (!select) return base;
        const picked: any = {};
        for (const key of Object.keys(select)) {
          if (select[key]) picked[key] = (base as any)[key];
        }
        return picked;
      }),
      update: vi.fn(),
    },
    brand: {
      findFirst: vi.fn(async () => ({
        id: 'brand-1',
        userId: 'user-123',
        name: 'Test Brand',
      })),
    },
    postMediaAsset: {
      create: vi.fn(),
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

  it('rejects content when carousel assets have mismatched aspect ratios', async () => {
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

    expect(response.statusCode).toBe(400);
    const payload = JSON.parse(response.payload);
    expect(payload?.error).toContain('same aspect ratio');
  });
});
