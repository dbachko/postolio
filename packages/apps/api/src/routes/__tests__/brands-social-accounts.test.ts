import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Keep CSRF behavior out of unit tests; mock these plugins as no-ops.
vi.mock('@fastify/csrf-protection', () => ({
  default: (async () => {}) as any,
}));

vi.mock('../../plugins/csrf-auto-protect.js', () => ({
  default: (async () => {}) as any,
}));

// Avoid starting real BullMQ workers during tests.
vi.mock('../../services/regeneration-queue.js', () => ({
  regenerationService: {
    startRegeneration: vi.fn(),
    getJobProgress: vi.fn(),
    cancelJob: vi.fn(),
  },
}));

// Disable Redis-backed rate limiting in these tests.
vi.mock('../../services/redis.js', () => {
  const redisService = {
    increment: vi.fn(async () => null),
    del: vi.fn(async () => true),
    getClient: vi.fn(() => null),
    get: vi.fn(async () => null),
    set: vi.fn(async () => true),
    setex: vi.fn(async () => true),
    disconnect: vi.fn(async () => {}),
    isConnected: vi.fn(() => false),
  };

  return {
    redisService,
    getRedisClient: vi.fn(() => null),
    createRedisClient: vi.fn(() => null),
  };
});

vi.mock('../../services/publisher-credentials.js', () => ({
  PublisherCredentialsService: {
    invalidateCredentialsCache: vi.fn(async () => {}),
  },
}));

vi.mock('../../services/service-clients.js', () => {
  const tokenServiceMock = {
    storeTokenForSocialAccount: vi.fn(async () => ({ success: true })),
    deleteTokenForSocialAccount: vi.fn(async () => ({ success: true })),
  };

  return {
    getTokenService: vi.fn(async () => tokenServiceMock),
    tokenServiceMock,
  };
});

vi.mock('../../services/ownership.js', () => ({
  assertBrandOwnership: vi.fn(async (userId: string, brandId: string) => ({
    id: brandId,
    userId,
    preferences: {},
  })),
}));

// Minimal Prisma mock for social-accounts routes.
vi.mock('../../config/database.js', () => {
  const brands: any[] = [{ id: 'brand-1', userId: 'user-123', preferences: {} }];
  const socialAccounts: any[] = [];

  const prisma = {
    brand: {
      findFirst: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        return brands.find((b) => b.id === where.id && b.userId === where.userId) ?? null;
      }),
      update: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        const idx = brands.findIndex((b) => b.id === id);
        if (idx < 0) throw new Error('brand_not_found');
        const next = { ...brands[idx], ...args?.data };
        brands[idx] = next;
        return next;
      }),
    },
    socialAccount: {
      findMany: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        const select = args?.select ?? null;
        const orderBy = Array.isArray(args?.orderBy) ? args.orderBy : [];

        let out = socialAccounts.slice();
        if (where.brandId) out = out.filter((sa) => sa.brandId === where.brandId);
        if (where.id?.in && Array.isArray(where.id.in)) {
          const allowed = new Set(where.id.in);
          out = out.filter((sa) => allowed.has(sa.id));
        }

        if (orderBy.length) {
          out.sort((a, b) => {
            for (const rule of orderBy) {
              const key = Object.keys(rule)[0];
              const dir = (rule as any)[key];
              const va = a[key];
              const vb = b[key];
              if (va === vb) continue;
              const cmp = va > vb ? 1 : -1;
              return dir === 'desc' ? -cmp : cmp;
            }
            return 0;
          });
        }

        if (!select) return out.map((r) => ({ ...r }));
        return out.map((r) => {
          const picked: any = {};
          for (const [k, v] of Object.entries(select)) {
            if (v) picked[k] = r[k];
          }
          return picked;
        });
      }),
      findFirst: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        let out = socialAccounts.slice();
        if (where.id) out = out.filter((sa) => sa.id === where.id);
        if (where.brandId) out = out.filter((sa) => sa.brandId === where.brandId);
        return out[0] ?? null;
      }),
      update: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        const data = args?.data ?? {};
        const idx = socialAccounts.findIndex((sa) => sa.id === id);
        if (idx < 0) throw new Error('social_account_not_found');
        socialAccounts[idx] = { ...socialAccounts[idx], ...data, updatedAt: new Date() };
        return socialAccounts[idx];
      }),
      create: vi.fn(async (args: any) => {
        const data = args?.data ?? {};
        const record = {
          id: `sa-${socialAccounts.length + 1}`,
          brandId: data.brandId,
          platform: data.platform,
          externalAccountId: data.externalAccountId,
          externalPageId: data.externalPageId ?? null,
          username: data.username ?? null,
          displayName: data.displayName ?? null,
          metadata: data.metadata ?? null,
          sortOrder: data.sortOrder ?? socialAccounts.length,
          createdAt: data.createdAt ?? new Date(),
          updatedAt: data.updatedAt ?? new Date(),
        };
        socialAccounts.push(record);
        return record;
      }),
    },
    content: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      if (typeof arg === 'function') return arg(prisma);
      return null;
    }),
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

describe('Brand social-accounts routes', () => {
  let app: FastifyInstance;
  let authHeader: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.JWT_SECRET = '01234567890123456789012345678901';
    process.env.COOKIE_SECRET = 'test-cookie-secret';

    const { buildFastify } = await import('../../server.js');
    app = buildFastify();
    await app.ready();

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - jwt decorator is added by @fastify/jwt
    const token = await (app as any).jwt.sign({ id: 'user-123', email: 'test@example.com' });
    authHeader = `Bearer ${token}`;

    const { prisma } = await import('../../config/database.js');

    const now = Date.now();
    await prisma.socialAccount.create({
      data: {
        brandId: 'brand-1',
        platform: 'instagram',
        externalAccountId: 'ig-1',
        sortOrder: 0,
        metadata: { tokenExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString() },
      },
    });
    await prisma.socialAccount.create({
      data: {
        brandId: 'brand-1',
        platform: 'facebook',
        externalAccountId: 'fb-1',
        sortOrder: 1,
        metadata: { tokenExpiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString() },
      },
    });
    await prisma.socialAccount.create({
      data: {
        brandId: 'brand-1',
        platform: 'instagram',
        externalAccountId: 'ig-expired',
        sortOrder: 2,
        metadata: { tokenExpiresAt: new Date(now - 60 * 60 * 1000).toISOString() },
      },
    });
    await prisma.socialAccount.create({
      data: {
        brandId: 'brand-1',
        platform: 'facebook',
        externalAccountId: 'fb-disconnected',
        sortOrder: 3,
        metadata: {
          disconnected: true,
          tokenExpiresAt: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('lists social accounts with computed token status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/brands/brand-1/social-accounts',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as any;
    expect(payload?.brandId).toBe('brand-1');
    expect(payload?.primarySocialAccountId).toBeTruthy();
    expect(payload?.socialAccounts).toHaveLength(4);

    const byExternal = new Map(payload.socialAccounts.map((a: any) => [a.externalAccountId, a]));

    expect(byExternal.get('ig-1')?.tokenStatus).toBe('healthy');
    expect(byExternal.get('fb-1')?.tokenStatus).toBe('expiring');
    expect(byExternal.get('ig-expired')?.tokenStatus).toBe('expired');
    expect(byExternal.get('fb-disconnected')?.tokenStatus).toBe('disconnected');
  });

  it('filters disconnected accounts from defaultPostSocialAccountIds', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/brands/brand-1/social-accounts',
      headers: { authorization: authHeader },
    });
    const accounts = (list.json() as any).socialAccounts as any[];
    const connected = accounts.find((a) => a.externalAccountId === 'ig-1');
    const disconnected = accounts.find((a) => a.externalAccountId === 'fb-disconnected');

    const setDefaults = await app.inject({
      method: 'POST',
      url: '/api/brands/brand-1/social-accounts/default-post-social-accounts',
      headers: { authorization: authHeader },
      payload: { socialAccountIds: [disconnected.id, connected.id] },
    });

    expect(setDefaults.statusCode).toBe(200);
    const payload = setDefaults.json() as any;
    expect(payload?.defaultPostSocialAccountIds).toEqual([connected.id]);
  });

  it('reorders connected accounts and ignores disconnected', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/brands/brand-1/social-accounts',
      headers: { authorization: authHeader },
    });
    const accounts = (list.json() as any).socialAccounts as any[];
    const connectedIds = accounts.filter((a) => !a.disconnected).map((a) => a.id);

    const order = await app.inject({
      method: 'POST',
      url: '/api/brands/brand-1/social-accounts/order',
      headers: { authorization: authHeader },
      payload: { orderedIds: connectedIds.slice().reverse() },
    });

    expect(order.statusCode).toBe(200);
    const payload = order.json() as any;
    expect(payload?.orderedIds).toEqual(connectedIds.slice().reverse());
  });

  it('disconnects an account and deletes its token (best-effort)', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/brands/brand-1/social-accounts',
      headers: { authorization: authHeader },
    });
    const accounts = (list.json() as any).socialAccounts as any[];
    const target = accounts.find((a) => a.externalAccountId === 'fb-1');

    const response = await app.inject({
      method: 'POST',
      url: `/api/brands/brand-1/social-accounts/${target.id}/disconnect`,
      headers: { authorization: authHeader },
      payload: { removeImportedPosts: false },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as any;
    expect(payload?.success).toBe(true);

    const { tokenServiceMock } = await import('../../services/service-clients.js');
    expect(tokenServiceMock.deleteTokenForSocialAccount).toHaveBeenCalledTimes(1);
  });
});
