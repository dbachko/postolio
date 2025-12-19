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

// Minimal in-memory Redis mock with TTL support (enough for Meta OAuth sessions).
vi.mock('../../services/redis.js', () => {
  const store = new Map<string, { value: string; expiresAt?: number }>();

  function isExpired(entry: { expiresAt?: number } | undefined): boolean {
    return !!(entry?.expiresAt && entry.expiresAt <= Date.now());
  }

  const redisService = {
    __store: store,
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (isExpired(entry)) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }),
    set: vi.fn(async (key: string, value: string, ttlSeconds?: number) => {
      store.set(key, {
        value,
        expiresAt:
          typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds)
            ? Date.now() + ttlSeconds * 1000
            : undefined,
      });
      return true;
    }),
    setex: vi.fn(async (key: string, ttlSeconds: number, value: string) => {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return true;
    }),
    del: vi.fn(async (key: string) => store.delete(key)),
    increment: vi.fn(async () => null),
    getClient: vi.fn(() => null),
    disconnect: vi.fn(async () => {}),
    isConnected: vi.fn(() => false),
  };

  return {
    redisService,
    getRedisClient: vi.fn(() => null),
    createRedisClient: vi.fn(() => null),
  };
});

vi.mock('../../services/ownership.js', () => ({
  assertBrandOwnership: vi.fn(async (userId: string, brandId: string) => ({
    id: brandId,
    userId,
    preferences: {},
  })),
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

vi.mock('../../services/publisher-credentials.js', () => ({
  PublisherCredentialsService: {
    invalidateCredentialsCache: vi.fn(async () => {}),
  },
}));

// Minimal Prisma mock for Meta OAuth finalize flow.
vi.mock('../../config/database.js', () => {
  const brands: any[] = [{ id: 'brand-1', userId: 'user-123', preferences: {} }];
  const socialAccounts: any[] = [];

  const prisma = {
    brand: {
      findUnique: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        return brands.find((b) => b.id === id) ?? null;
      }),
    },
    socialAccount: {
      aggregate: vi.fn(async (args: any) => {
        const brandId = args?.where?.brandId as string;
        const inBrand = socialAccounts.filter((sa) => sa.brandId === brandId);
        const max = inBrand.length ? Math.max(...inBrand.map((sa) => sa.sortOrder ?? 0)) : null;
        return { _max: { sortOrder: max } };
      }),
      findMany: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        const select = args?.select ?? null;
        const orderBy = Array.isArray(args?.orderBy) ? args.orderBy : [];

        let out = socialAccounts.slice();
        if (where.brandId) out = out.filter((sa) => sa.brandId === where.brandId);
        if (where.OR && Array.isArray(where.OR)) {
          out = out.filter((sa) =>
            where.OR.some(
              (cond: any) =>
                cond?.platform === sa.platform && cond?.externalAccountId === sa.externalAccountId
            )
          );
        }

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
      findUnique: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        if (where.id) {
          return socialAccounts.find((sa) => sa.id === where.id) ?? null;
        }
        const key = where.platform_externalAccountId;
        if (key?.platform && key?.externalAccountId) {
          return (
            socialAccounts.find(
              (sa) => sa.platform === key.platform && sa.externalAccountId === key.externalAccountId
            ) ?? null
          );
        }
        return null;
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
          sortOrder: data.sortOrder ?? 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        socialAccounts.push(record);
        const select = args?.select;
        if (select?.id) return { id: record.id };
        return record;
      }),
      update: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        const data = args?.data ?? {};
        const idx = socialAccounts.findIndex((sa) => sa.id === id);
        if (idx < 0) throw new Error('social_account_not_found');
        socialAccounts[idx] = { ...socialAccounts[idx], ...data, updatedAt: new Date() };
        const select = args?.select;
        if (select?.id) return { id };
        return socialAccounts[idx];
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

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any;
}

describe('Meta OAuth routes', () => {
  let app: FastifyInstance;
  let authHeader: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.FACEBOOK_APP_ID = 'test-app-id';
    process.env.FACEBOOK_APP_SECRET = 'test-app-secret';
    process.env.META_REDIRECT_URI = 'http://localhost:3000/api/auth/meta/callback';
    process.env.JWT_SECRET = '01234567890123456789012345678901';
    process.env.COOKIE_SECRET = 'test-cookie-secret';

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/oauth/access_token') && url.includes('grant_type=fb_exchange_token')) {
        return jsonResponse({
          access_token: 'long-lived-user-token',
          expires_in: 60 * 24 * 60 * 60,
        });
      }
      if (url.includes('/oauth/access_token') && url.includes('code=')) {
        return jsonResponse({ access_token: 'short-lived-user-token', expires_in: 3600 });
      }
      if (url.includes('/me/accounts')) {
        return jsonResponse({
          data: [
            {
              id: 'page-1',
              name: 'Page One',
              access_token: 'page-access-token-1',
              instagram_business_account: { id: 'ig-1' },
            },
          ],
        });
      }
      if (url.includes('/ig-1?fields=')) {
        return jsonResponse({
          id: 'ig-1',
          username: 'test_ig',
          name: 'Test IG',
          profile_picture_url: 'https://example.com/ig.png',
        });
      }
      return jsonResponse({ error: { message: `Unhandled URL: ${url}` } }, 500);
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const { buildFastify } = await import('../../server.js');
    app = buildFastify();
    await app.ready();

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - jwt decorator is added by @fastify/jwt
    const token = await (app as any).jwt.sign({ id: 'user-123', email: 'test@example.com' });
    authHeader = `Bearer ${token}`;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (app) await app.close();
  });

  it('runs authorize → callback → candidates → finalize and stores per-account token expiry metadata', async () => {
    const authorize = await app.inject({
      method: 'GET',
      url: '/api/auth/meta/authorize?brandId=brand-1&parentOrigin=http%3A%2F%2Flocalhost%3A5173',
      headers: { authorization: authHeader },
    });

    expect(authorize.statusCode).toBe(200);
    const authorizePayload = authorize.json() as any;
    expect(authorizePayload?.connectSessionId).toBeTruthy();
    expect(authorizePayload?.authUrl).toContain('client_id=test-app-id');

    const authUrl = new URL(authorizePayload.authUrl);
    const connectSessionId = String(authorizePayload.connectSessionId);
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/meta/callback?code=test-code&state=${encodeURIComponent(state!)}`,
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.headers['content-type']).toContain('text/html');
    expect(callback.body).toContain('const parentOrigin = "http://localhost:5173"');

    const candidates = await app.inject({
      method: 'GET',
      url: `/api/auth/meta/candidates?connectSessionId=${encodeURIComponent(connectSessionId)}`,
      headers: { authorization: authHeader },
    });

    expect(candidates.statusCode).toBe(200);
    const candidatesPayload = candidates.json() as any;
    expect(candidatesPayload?.brandId).toBe('brand-1');
    expect(Array.isArray(candidatesPayload?.candidates)).toBe(true);
    expect(candidatesPayload.candidates).toHaveLength(2);
    expect(candidatesPayload.expiresAt).toBeTruthy();

    const candidateIds = candidatesPayload.candidates.map((c: any) => c.candidateId);

    const finalize = await app.inject({
      method: 'POST',
      url: '/api/auth/meta/finalize',
      headers: { authorization: authHeader },
      payload: { connectSessionId, candidateIds },
    });

    expect(finalize.statusCode).toBe(200);
    const finalizePayload = finalize.json() as any;
    expect(finalizePayload?.success).toBe(true);
    expect(finalizePayload?.connected).toHaveLength(2);

    const { prisma } = await import('../../config/database.js');
    const stored = await prisma.socialAccount.findMany({ where: { brandId: 'brand-1' } });
    expect(stored).toHaveLength(2);
    for (const account of stored) {
      expect(account.metadata?.tokenExpiresAt).toBeTruthy();
      expect(account.metadata?.tokenUpdatedAt).toBeTruthy();
    }

    const { tokenServiceMock } = await import('../../services/service-clients.js');
    expect(tokenServiceMock.storeTokenForSocialAccount).toHaveBeenCalledTimes(2);

    const { redisService } = await import('../../services/redis.js');
    const store = (redisService as any).__store as Map<string, unknown>;
    expect(store.has(`meta:connect-session:${connectSessionId}`)).toBe(false);
    expect(store.has(`meta:connect-candidates:${connectSessionId}`)).toBe(false);
    expect(store.has(`meta:connect-tokens:${connectSessionId}`)).toBe(false);
    expect(store.has(`meta:connect-state:${state}`)).toBe(false);
  });
});
