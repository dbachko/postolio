import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../middleware/error-handler.js';

// Keep CSRF behavior and global plugins out of this focused route test.
// We build a minimal Fastify instance and register only the campaign routes.

// Disable Redis-backed rate limiting; have the rate limiter fail open.
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

// Avoid instantiating real BullMQ workers in tests.
vi.mock('../../services/regeneration-queue.js', () => ({
  regenerationService: {
    startRegeneration: vi.fn(),
    getJobProgress: vi.fn(),
    cancelJob: vi.fn(),
  },
}));

// In-memory campaign store for this suite
const dbState = {
  campaigns: [] as Array<{
    id: string;
    brandId: string;
    status: string;
    config: {
      duration?: { start?: string; end?: string };
      frequency?: string;
    };
    brand: {
      id: string;
      name: string;
      userId: string;
    };
  }>,
};

// Minimal Prisma mock used by ownership + campaign services
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
    campaign: {
      findFirst: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        const id: string | undefined = where.id;
        const brandId: string | undefined = where.brandId;
        const brandUserId: string | undefined = where.brand?.userId;

        const match = dbState.campaigns.find((c) => {
          if (id && c.id !== id) return false;
          if (brandId && c.brandId !== brandId) return false;
          if (brandUserId && c.brand.userId !== brandUserId) return false;
          return true;
        });

        if (!match) return null;

        if (args?.select) {
          return pickSelected(match, args.select);
        }

        if (args?.include) {
          const included: any = { ...match };
          if (!args.include.brand) {
            delete included.brand;
          }
          return included;
        }

        return match;
      }),
      update: vi.fn(async (args: any) => {
        const id = args?.where?.id as string | undefined;
        if (!id) {
          throw new Error('Missing campaign id in update');
        }
        const existing = dbState.campaigns.find((c) => c.id === id);
        if (!existing) {
          throw new Error(`Campaign ${id} not found`);
        }

        Object.assign(existing, args.data ?? {});

        if (args?.include?.brand !== undefined && !args.include.brand) {
          const { brand, ...rest } = existing as any;
          return rest;
        }

        return existing;
      }),
    },
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

// Import campaign routes after mocks so they see the mocked dependencies.
const { default: campaignRoutes } = await import('../campaign.js');

describe('Campaign routes – APIError contract', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    dbState.campaigns.length = 0;

    // Seed a single completed campaign owned by user-123
    dbState.campaigns.push({
      id: 'camp-1',
      brandId: 'brand-1',
      status: 'completed',
      config: {
        duration: {
          start: '2025-01-10T00:00:00.000Z',
          end: '2025-01-20T00:00:00.000Z',
        },
        frequency: 'daily',
      },
      brand: {
        id: 'brand-1',
        name: 'Test Brand',
        userId: 'user-123',
      },
    });

    app = Fastify();
    app.setErrorHandler(errorHandler as any);

    // Minimal auth decorator to satisfy campaign route preHandlers.
    app.decorate('authenticate', async (request: any, _reply: any) => {
      request.user = {
        id: 'user-123',
        email: 'test-user@example.com',
      };
    });

    await app.register(campaignRoutes, { prefix: '/api/campaigns' });
    await app.ready();
  });

  it('returns CAMPAIGN_UPDATE_VALIDATION_FAILED when editing a completed campaign', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/campaigns/camp-1',
      payload: {
        // Completed campaigns are read-only; even name changes are invalid
        name: 'Updated name',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as {
      error: string;
      code: string;
      details?: Record<string, unknown>;
    };

    expect(body.code).toBe('CAMPAIGN_UPDATE_VALIDATION_FAILED');
    expect(body.error).toBe('Validation failed for campaign update');
    expect(body.details).toMatchObject({
      campaignId: 'camp-1',
      userId: 'user-123',
    });
  });
});
