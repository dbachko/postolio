import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../middleware/error-handler.js';

// In-memory brand store for ownership checks
const dbState = {
  brands: [] as Array<{ id: string; userId: string; name: string; preferences?: unknown }>,
};

// Mock Prisma client used by ownership + rolling-content routes
vi.mock('../../config/database.js', () => {
  const pickSelected = (record: any, select: Record<string, boolean> | undefined) => {
    if (!select) return record;
    const picked: any = {};
    for (const key of Object.keys(select)) {
      if (select[key]) {
        picked[key] = record[key];
      }
    }
    return picked;
  };

  const prisma = {
    brand: {
      findFirst: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        const id: string | undefined = where.id;
        const userId: string | undefined = where.userId;
        const match = dbState.brands.find(
          (b) => (!id || b.id === id) && (!userId || b.userId === userId)
        );
        if (!match) return null;
        return pickSelected(match, args?.select);
      }),
    },
    socialAccount: {
      findMany: vi.fn(async () => []),
    },
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

// Stub rolling content service to throw on getQueueStatus
vi.mock('../../services/rolling-content.js', () => ({
  rollingContentService: {
    getQueueStatus: vi.fn(async () => {
      throw new Error('queue backend unavailable');
    }),
    triggerManual: vi.fn(),
    checkAndGenerateContent: vi.fn(),
  },
}));

// Avoid Redis-related side effects
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

const { default: rollingContentRoutes } = await import('../rolling-content.js');

describe('Rolling content routes – APIError contract', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    dbState.brands.length = 0;
    dbState.brands.push({
      id: 'brand-1',
      userId: 'user-123',
      name: 'Test Brand',
    });

    app = Fastify();
    app.setErrorHandler(errorHandler as any);

    app.decorate('authenticate', async (request: any, _reply: any) => {
      request.user = {
        id: 'user-123',
        email: 'test-user@example.com',
      };
    });

    await app.register(rollingContentRoutes, { prefix: '/api/rolling-content' });
    await app.ready();
  });

  it('wraps unexpected queue status failures as ROLLING_CONTENT_QUEUE_STATUS_FAILED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/rolling-content/queue-status/brand-1',
      headers: {
        authorization: 'Bearer test-token',
      },
    });

    expect(res.statusCode).toBe(500);
    const body = res.json() as {
      error: string;
      code: string;
      details?: Record<string, unknown>;
    };

    expect(body.code).toBe('ROLLING_CONTENT_QUEUE_STATUS_FAILED');
    expect(body.error).toBeTruthy();
    expect(body.details).toMatchObject({
      brandId: 'brand-1',
    });
  });
});
