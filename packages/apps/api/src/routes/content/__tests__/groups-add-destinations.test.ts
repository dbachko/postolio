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

// Minimal in-memory Prisma mock for this suite
vi.mock('../../../config/database.js', () => {
  const contentGroups: any[] = [
    {
      id: 'cg-1',
      brandId: 'brand-1',
      templateInitialized: true,
      templateCaption: 'Hello world',
      templateContentType: 'post',
      templateShareToFeed: null,
      templateThumbOffset: null,
      templateFirstComment: null,
      templateAssetIds: ['asset-1'],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const socialAccounts: any[] = [
    {
      id: 'sa-1',
      brandId: 'brand-1',
      platform: 'instagram',
      username: 'one',
      displayName: 'One',
      metadata: {},
      sortOrder: 0,
      createdAt: new Date(),
    },
    {
      id: 'sa-2',
      brandId: 'brand-1',
      platform: 'facebook',
      username: 'two',
      displayName: 'Two',
      metadata: {},
      sortOrder: 1,
      createdAt: new Date(),
    },
  ];

  const contents: any[] = [
    {
      id: 'content-1',
      caption: 'Hello world',
      hashtags: [],
      status: 'draft',
      brandId: 'brand-1',
      contentGroupId: 'cg-1',
      targetSocialAccountId: 'sa-1',
      schedulingError: null,
      generationParams: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      scheduledAt: null,
      postedAt: null,
      contentType: 'post',
      shareToFeed: null,
      thumbOffset: null,
      firstComment: null,
      firstCommentStatus: null,
      firstCommentPostedAt: null,
      firstCommentError: null,
      mediaAssets: [],
      targetSocialAccount: socialAccounts[0],
    },
  ];

  const prisma = {
    contentGroup: {
      findUnique: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        const group = contentGroups.find((g) => g.id === id) ?? null;
        if (!group) return null;

        const include = args?.include;
        const base: any = { ...group };
        if (include?.brand) {
          base.brand = { id: group.brandId, userId: 'user-123' };
        }
        if (include?.contents) {
          base.contents = contents
            .filter((c) => c.contentGroupId === group.id)
            .map((c) => ({
              ...c,
              targetSocialAccount:
                socialAccounts.find((sa) => sa.id === c.targetSocialAccountId) || null,
            }));
        }
        return base;
      }),
    },
    brand: {
      findFirst: vi.fn(async () => ({
        id: 'brand-1',
        userId: 'user-123',
        name: 'Test Brand',
        preferences: {},
        postingTimezone: 'UTC',
      })),
    },
    socialAccount: {
      findMany: vi.fn(async (args: any) => {
        const brandId = args?.where?.brandId as string | undefined;
        const ids = args?.where?.id?.in as string[] | undefined;
        if (!brandId || !Array.isArray(ids)) return [];
        return socialAccounts.filter((sa) => sa.brandId === brandId && ids.includes(sa.id));
      }),
    },
    content: {
      create: vi.fn(async (args: any) => {
        const data = args?.data ?? {};
        const created = {
          id: `content-${contents.length + 1}`,
          caption: data.caption,
          hashtags: data.hashtags ?? [],
          status: data.status ?? 'draft',
          brandId: data.brandId,
          contentGroupId: data.contentGroupId ?? null,
          targetSocialAccountId: data.targetSocialAccountId ?? null,
          schedulingError: data.schedulingError ?? null,
          generationParams: data.generationParams ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
          scheduledAt: data.scheduledAt ?? null,
          postedAt: data.postedAt ?? null,
          contentType: data.contentType ?? 'post',
          shareToFeed: data.shareToFeed ?? null,
          thumbOffset: data.thumbOffset ?? null,
          firstComment: data.firstComment ?? null,
          firstCommentStatus: data.firstCommentStatus ?? null,
          firstCommentPostedAt: data.firstCommentPostedAt ?? null,
          firstCommentError: data.firstCommentError ?? null,
          mediaAssets: [],
          targetSocialAccount:
            socialAccounts.find((sa) => sa.id === data.targetSocialAccountId) || null,
        };
        contents.push(created);
        return { id: created.id };
      }),
    },
    contentMediaAsset: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma)),
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

describe('Content group destination adding', () => {
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

  it('adds a new destination to an existing content group', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/content/groups/cg-1/destinations',
      headers: {
        authorization: authHeader,
        'content-type': 'application/json',
      },
      payload: {
        targetSocialAccountIds: ['sa-2'],
      },
    });

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.payload);
    expect(payload?.success).toBe(true);
    expect(payload?.contentGroupId).toBe('cg-1');
    expect(Array.isArray(payload?.added)).toBe(true);
    expect(payload.added).toHaveLength(1);
    expect(payload.added[0]?.targetSocialAccountId).toBe('sa-2');
    expect(typeof payload.added[0]?.contentId).toBe('string');
  });
});
