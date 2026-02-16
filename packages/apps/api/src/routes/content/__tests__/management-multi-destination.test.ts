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
  const contentGroups: any[] = [];
  const contents: any[] = [];
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
      platform: 'instagram',
      username: 'two',
      displayName: 'Two',
      metadata: {},
      sortOrder: 1,
      createdAt: new Date(),
    },
  ];

  const prisma = {
    contentGroup: {
      create: vi.fn(async (args: any) => {
        const id = `cg-${contentGroups.length + 1}`;
        const record = {
          id,
          brandId: args?.data?.brandId,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        contentGroups.push(record);
        const select = args?.select;
        if (select?.id) return { id };
        return record;
      }),
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
      delete: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        const idx = contentGroups.findIndex((g) => g.id === id);
        if (idx >= 0) contentGroups.splice(idx, 1);
        return { id };
      }),
    },
    content: {
      create: vi.fn(async (args: any) => {
        const data = args?.data ?? {};
        const base = {
          id: `content-${contents.length + 1}`,
          caption: data.caption,
          hashtags: data.hashtags ?? [],
          status: data.status ?? 'draft',
          brandId: data.brandId,
          contentGroupId: data.contentGroupId ?? null,
          targetSocialAccountId: data.targetSocialAccountId ?? null,
          schedulingError: data.schedulingError ?? null,
          generationParams: data.generationParams,
          createdAt: new Date(),
          updatedAt: new Date(),
          scheduledAt: data.scheduledAt ?? null,
          postedAt: data.postedAt ?? null,
          contentType: data.contentType ?? 'post',
          shareToFeed: data.shareToFeed ?? null,
          firstComment: data.firstComment ?? null,
          firstCommentStatus: data.firstCommentStatus ?? null,
          firstCommentPostedAt: data.firstCommentPostedAt ?? null,
          firstCommentError: data.firstCommentError ?? null,
          mediaAssets: [],
        };
        contents.push(base);
        const select = args?.select;
        if (!select) return base;
        const picked: any = {};
        for (const key of Object.keys(select)) {
          if (select[key]) picked[key] = (base as any)[key];
        }
        return picked;
      }),
      findMany: vi.fn(async (args: any) => {
        const ids = args?.where?.id?.in as string[] | undefined;
        const list = Array.isArray(ids)
          ? contents.filter((c) => ids.includes(c.id))
          : contents.slice();
        const select = args?.select;
        if (!select) return list;
        return list.map((record) => {
          const picked: any = {};
          for (const key of Object.keys(select)) {
            const value = (select as any)[key];
            if (value === true) picked[key] = (record as any)[key];
            if (key === 'mediaAssets' && value?.select) picked[key] = [];
          }
          return picked;
        });
      }),
      deleteMany: vi.fn(async (args: any) => {
        const ids = args?.where?.id?.in as string[] | undefined;
        const before = contents.length;
        if (!Array.isArray(ids)) return { count: 0 };
        for (let i = contents.length - 1; i >= 0; i -= 1) {
          if (ids.includes(contents[i].id)) contents.splice(i, 1);
        }
        return { count: before - contents.length };
      }),
    },
    brand: {
      findFirst: vi.fn(async () => ({
        id: 'brand-1',
        userId: 'user-123',
        name: 'Test Brand',
      })),
      findUnique: vi.fn(async () => ({ preferences: {} })),
    },
    socialAccount: {
      findFirst: vi.fn(async (args: any) => {
        const id = args?.where?.id as string | undefined;
        const brandId = args?.where?.brandId as string | undefined;
        if (!id || !brandId) return null;
        return socialAccounts.find((sa) => sa.id === id && sa.brandId === brandId) ?? null;
      }),
      findMany: vi.fn(async (args: any) => {
        const brandId = args?.where?.brandId as string | undefined;
        const ids = args?.where?.id?.in as string[] | undefined;
        if (!brandId || !Array.isArray(ids)) return [];
        return socialAccounts.filter((sa) => sa.brandId === brandId && ids.includes(sa.id));
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

describe('Multi-destination content groups', () => {
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

  it('creates a content group when targetSocialAccountIds has multiple destinations', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/content',
      headers: {
        authorization: authHeader,
        'content-type': 'application/json',
      },
      payload: {
        brandId: 'brand-1',
        caption: 'Hello world',
        assetIds: ['asset-1'],
        targetSocialAccountIds: ['sa-1', 'sa-2'],
      },
    });

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.payload);
    expect(payload?.contentGroupId).toBeTruthy();
    expect(Array.isArray(payload?.contents)).toBe(true);
    expect(payload.contents).toHaveLength(2);
    expect(payload.contents[0]?.contentGroupId).toBe(payload.contentGroupId);
    expect(payload.contents[1]?.contentGroupId).toBe(payload.contentGroupId);
  });

  it('deletes all posts in a content group', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/content',
      headers: {
        authorization: authHeader,
        'content-type': 'application/json',
      },
      payload: {
        brandId: 'brand-1',
        caption: 'Delete me',
        assetIds: ['asset-1'],
        targetSocialAccountIds: ['sa-1', 'sa-2'],
      },
    });

    expect(create.statusCode).toBe(201);
    const created = JSON.parse(create.payload);
    const groupId = created?.contentGroupId as string;
    expect(groupId).toBeTruthy();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/content/groups/${groupId}`,
      headers: { authorization: authHeader },
    });

    expect(del.statusCode).toBe(200);
    const deleted = JSON.parse(del.payload);
    expect(deleted?.success).toBe(true);
    expect(deleted?.deleted?.contentGroupId).toBe(groupId);
    expect(Array.isArray(deleted?.deleted?.contentIds)).toBe(true);
    expect(deleted.deleted.contentIds).toHaveLength(2);
  });

  it('rejects multi-destination creation when feature flag is disabled', async () => {
    const previous = process.env.FEATURE_MULTI_DESTINATION_ENABLED;
    process.env.FEATURE_MULTI_DESTINATION_ENABLED = 'false';

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/content',
        headers: {
          authorization: authHeader,
          'content-type': 'application/json',
        },
        payload: {
          brandId: 'brand-1',
          caption: 'Blocked',
          assetIds: ['asset-1'],
          targetSocialAccountIds: ['sa-1', 'sa-2'],
        },
      });

      expect(response.statusCode).toBe(403);
      const payload = JSON.parse(response.payload);
      expect(payload?.code).toBe('MULTI_DESTINATION_DISABLED');
    } finally {
      process.env.FEATURE_MULTI_DESTINATION_ENABLED = previous;
    }
  });
});
