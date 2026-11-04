import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Keep CSRF behavior out of unit tests; mock these plugins as no-ops.
vi.mock('@fastify/csrf-protection', () => ({
  default: (async () => {}) as any,
}));

vi.mock('../../plugins/csrf-auto-protect.js', () => ({
  default: (async () => {}) as any,
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
    contentPublication: { findFirst: vi.fn(async () => null) },
    publicationMetricsLatest: { findUnique: vi.fn() },
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

describe('Analytics authentication boundary', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    const { buildFastify } = await import('../../server.js');
    app = buildFastify();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });
  it.each([
    ['GET', '/api/publications'],
    ['GET', '/api/analytics/publications/some-id'],
    ['POST', '/api/analytics/publications/some-id/refresh'],
    ['GET', '/api/analytics/brands/brand-1/summary'],
    ['GET', '/api/analytics/brands/brand-1/account/series'],
    ['GET', '/api/analytics/brands/brand-1/top-publications'],
    ['POST', '/api/analytics/brands/brand-1/account/refresh'],
  ] as const)('rejects unauthenticated %s %s', async (method, url) => {
    expect((await app.inject({ method, url })).statusCode).toBe(401);
  });
  it.each(['GET', 'POST'] as const)(
    'rejects cross-account publication %s requests before reading metrics or enqueueing',
    async (method) => {
      const token = app.jwt.sign({ id: 'attacker', email: 'attacker@example.test' });
      const response = await app.inject({
        method,
        url: '/api/analytics/publications/victim' + (method === 'POST' ? '/refresh' : ''),
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
      const { prisma } = await import('../../config/database.js');
      expect(prisma.contentPublication.findFirst).toHaveBeenCalledWith({
        where: { id: 'victim', content: { brand: { userId: 'attacker' } } },
        select: { id: true },
      });
      expect(prisma.publicationMetricsLatest.findUnique).not.toHaveBeenCalled();
    }
  );
});
