import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const queue = vi.hoisted(() => ({ ttl: vi.fn(async () => -1), setex: vi.fn(), lpush: vi.fn() }));

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
    getRedisClient: vi.fn(() => queue),
    createRedisClient: vi.fn(() => null),
  };
});

// Avoid touching a real database when building the Fastify app in tests.
vi.mock('../../config/database.js', () => {
  const prisma = {
    contentPublication: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => ({ id: 'owned' })),
    },
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
    vi.clearAllMocks();
    const { prisma } = await import('../../config/database.js');
    vi.mocked(prisma.contentPublication.findFirst).mockResolvedValue(null);
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
      expect(queue.lpush).not.toHaveBeenCalled();
    }
  );
  it('lets the owner read metrics and enqueue a refresh', async () => {
    const { prisma } = await import('../../config/database.js');
    vi.mocked(prisma.contentPublication.findFirst).mockResolvedValue({ id: 'owned' } as any);
    vi.mocked(prisma.publicationMetricsLatest.findUnique).mockResolvedValue({
      publicationId: 'owned',
      impressions: 10,
    } as any);
    const token = app.jwt.sign({ id: 'owner', email: 'owner@example.test' });
    const headers = { authorization: `Bearer ${token}` };
    const read = await app.inject({
      method: 'GET',
      url: '/api/analytics/publications/owned',
      headers,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.impressions).toBe(10);
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/analytics/publications/owned/refresh',
      headers,
    });
    expect(refresh.statusCode).toBe(200);
    expect(queue.lpush).toHaveBeenCalledWith('ingest:queue:publications', 'owned');
  });
});
