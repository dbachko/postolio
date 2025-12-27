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

// Avoid touching a real database when building the Fastify app in tests.
vi.mock('../../config/database.js', () => {
  const prisma = {
    auditLog: {
      create: vi.fn(async () => ({})),
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
    },
    session: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({})),
    },
    user: {
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

// Force refresh rotation to fail so we can validate cookie behavior.
vi.mock('../../services/refresh-token.js', () => ({
  RefreshTokenService: {
    rotateRefreshToken: vi.fn(async () => null),
  },
}));

describe('Auth refresh route', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.JWT_SECRET = '01234567890123456789012345678901';
    process.env.COOKIE_SECRET = 'test-cookie-secret';

    const { buildFastify } = await import('../../server.js');
    app = buildFastify();
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('does not clear auth_token cookie when refresh rotation fails', async () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - jwt decorator is added by @fastify/jwt
    const accessToken = await (app as any).jwt.sign({
      id: 'user-123',
      email: 'test@example.com',
      sid: 'session-1',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: {
        cookie: `auth_token=${accessToken}; refresh_token=dummy-refresh-token`,
      },
    });

    expect(response.statusCode).toBe(401);

    const setCookieHeader = response.headers['set-cookie'];
    const setCookieValues = (() => {
      if (!setCookieHeader) return [];
      return Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    })();

    // We should clear refresh_token on multiple paths, but should not clear auth_token.
    expect(setCookieValues.some((value) => value.startsWith('auth_token='))).toBe(false);
    expect(setCookieValues.filter((value) => value.startsWith('refresh_token='))).toHaveLength(3);
    expect(setCookieValues.some((value) => value.includes('Path=/api/auth'))).toBe(true);
    expect(setCookieValues.some((value) => value.includes('Path=/api/auth/refresh'))).toBe(true);
    expect(setCookieValues.some((value) => value.includes('Path=/'))).toBe(true);
  });
});
