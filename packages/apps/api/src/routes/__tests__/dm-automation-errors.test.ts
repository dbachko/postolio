import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../middleware/error-handler.js';

// In-memory brand store for ownership checks
const dbState = {
  brands: [] as Array<{ id: string; userId: string; name: string; preferences?: unknown }>,
};

// Mock Prisma client used by ownership + dm-automation routes
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
    dMAutomationRule: {
      findMany: vi.fn(async (_args: any) => {
        // For this test we only care about the error path;
        // return an empty list when not simulating failures.
        return [];
      }),
    },
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

// Avoid Redis/rate limiter interactions leaking into this focused test
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

// Import dm-automation routes *after* mocks so they see the mocked dependencies.
const { default: dmAutomationRoutes } = await import('../dm-automation.js');

describe('DM Automation routes – APIError contract', () => {
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

    // Minimal auth decorator
    app.decorate('authenticate', async (request: any, _reply: any) => {
      request.user = {
        id: 'user-123',
        email: 'test-user@example.com',
      };
    });

    await app.register(dmAutomationRoutes, { prefix: '/api' });
    await app.ready();
  });

  it('wraps unexpected rule fetch failures as DM_RULES_FETCH_FAILED', async () => {
    // Force dMAutomationRule.findMany to throw to hit the wrapper path
    const { getDatabaseClient } = await import('../../config/database.js');
    const prisma = getDatabaseClient() as any;
    prisma.dMAutomationRule.findMany.mockRejectedValueOnce(new Error('DB unavailable'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/brands/brand-1/dm-automation/rules',
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

    expect(body.code).toBe('DM_RULES_FETCH_FAILED');
    expect(body.error).toBeTruthy();
    expect(body.details).toMatchObject({
      brandId: 'brand-1',
      userId: 'user-123',
    });
  });
});
