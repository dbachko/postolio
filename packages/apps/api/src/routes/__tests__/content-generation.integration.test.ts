import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

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

// Avoid starting real BullMQ workers during tests.
vi.mock('../../services/regeneration-queue.js', () => ({
  regenerationService: {
    startRegeneration: vi.fn(),
    getJobProgress: vi.fn(),
    cancelJob: vi.fn(),
  },
}));

// In-memory store to observe DB changes
const dbState = {
  brands: [] as Array<{ id: string; userId: string; name: string; styleProfile?: unknown }>,
  contents: [] as Array<any>,
  contentMediaAssets: [] as Array<any>,
};

// Mock Prisma client used by the API
vi.mock('../../config/database.js', () => {
  const prisma = {
    brand: {
      findFirst: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        const id: string | undefined = where.id;
        const userId: string | undefined = where.userId;
        return (
          dbState.brands.find((b) => (!id || b.id === id) && (!userId || b.userId === userId)) ??
          null
        );
      }),
      findUnique: vi.fn(async (args: any) => {
        const id = args?.where?.id as string | undefined;
        return dbState.brands.find((b) => b.id === id) ?? null;
      }),
    },
    content: {
      create: vi.fn(async (args: any) => {
        const data = args?.data ?? {};
        const now = new Date();
        const record = {
          id: data.id ?? `content-${dbState.contents.length + 1}`,
          caption: data.caption,
          hashtags: data.hashtags ?? [],
          status: data.status ?? 'draft',
          brandId: data.brandId,
          campaignId: data.campaignId ?? null,
          scheduledAt: data.scheduledAt ?? null,
          createdAt: now,
          updatedAt: now,
          contentType: data.contentType ?? 'post',
          shareToFeed: data.shareToFeed ?? null,
          generationParams: data.generationParams ?? null,
        };
        dbState.contents.push(record);

        const select = args?.select;
        if (!select) return record;
        const picked: any = {};
        for (const key of Object.keys(select)) {
          if (select[key]) picked[key] = (record as any)[key];
        }
        return picked;
      }),
      update: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        const data = args?.data ?? {};
        const existing = dbState.contents.find((c) => c.id === id);
        if (!existing) {
          throw new Error(`Content ${id} not found`);
        }
        Object.assign(existing, data, { updatedAt: new Date() });
        return existing;
      }),
      findUnique: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        return dbState.contents.find((c) => c.id === id) ?? null;
      }),
    },
    contentMediaAsset: {
      upsert: vi.fn(async (args: any) => {
        const where = args?.where?.contentId_displayOrder;
        const contentId = where?.contentId as string;
        const displayOrder = where?.displayOrder as number;
        const existingIndex = dbState.contentMediaAssets.findIndex(
          (p) => p.contentId === contentId && p.displayOrder === displayOrder
        );
        if (existingIndex >= 0) {
          dbState.contentMediaAssets[existingIndex] = {
            ...dbState.contentMediaAssets[existingIndex],
            ...args.update,
          };
          return dbState.contentMediaAssets[existingIndex];
        }
        const created = {
          ...args.create,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        dbState.contentMediaAssets.push(created);
        return created;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma)),
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

// Mock generator to avoid hitting OpenAI in tests
vi.mock('../../services/content-generator.js', () => ({
  generateInstagramContent: vi.fn(async () => [
    {
      caption: 'Test generated caption',
      hashtags: ['test', 'generated'],
      imageUrl: 'https://example.com/generated-image.jpg',
      imageMetadata: {
        source: 'ai',
        originalPrompt: 'A beautiful sunset over the ocean',
      },
      imagePrompt: 'A beautiful sunset over the ocean',
    },
  ]),
}));

// Use real attachAssetToContent implementation but stub importImageFromExternalUrl
vi.mock('../../services/assets-media.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/assets-media.js')>(
    '../../services/assets-media.js'
  );
  return {
    ...actual,
    importImageFromExternalUrl: vi.fn(async (_imageUrl: string, _metadata: any) => {
      return {
        id: 'asset-1',
        url: 'https://cdn.example.com/assets/asset-1.jpg',
        width: 1080,
        height: 1080,
      } as any;
    }),
  };
});

const { buildFastify } = await import('../../server.js');

describe('Content generation + asset attach integration', () => {
  let app: FastifyInstance;
  let authHeader: string;

  beforeEach(async () => {
    // Reset in-memory DB between tests
    dbState.brands.length = 0;
    dbState.contents.length = 0;
    dbState.contentMediaAssets.length = 0;

    dbState.brands.push({
      id: 'brand-1',
      userId: 'user-123',
      name: 'Test Brand',
      styleProfile: null,
    });

    app = buildFastify();
    await app.ready();

    // Generate a valid JWT for tests using the app's jwt decorator
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - jwt decorator is added by @fastify/jwt
    const token = await (app as any).jwt.sign({
      id: 'user-123',
      email: 'test-user@example.com',
    });
    authHeader = `Bearer ${token}`;
  });

  it('attaches an asset synchronously when the generator returns an imageUrl', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/content/generate',
      headers: {
        authorization: authHeader,
      },
      payload: {
        brandId: 'brand-1',
        count: 1,
        theme: 'test-theme',
        style: 'test-style',
      },
    });

    expect(response.statusCode).toBe(201);

    // One content record should have been created
    expect(dbState.contents.length).toBe(1);
    const created = dbState.contents[0];

    // Synchronous asset import + attach should have created a ContentMediaAsset row for displayOrder 0
    const primaryMedia = dbState.contentMediaAssets.find(
      (p) => p.contentId === created.id && p.displayOrder === 0
    );
    expect(primaryMedia).toBeDefined();
    expect(primaryMedia?.assetId).toBe('asset-1');
  });
});
