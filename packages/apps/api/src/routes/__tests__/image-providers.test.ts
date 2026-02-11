import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Keep CSRF behavior out of unit tests; mock these plugins as no-ops.
vi.mock('@fastify/csrf-protection', () => ({
  default: (async () => {}) as any,
}));

vi.mock('../../plugins/csrf-auto-protect.js', () => ({
  default: (async () => {}) as any,
}));

// Disable Redis-backed rate limiting in these tests to avoid stateful 429 responses.
vi.mock('../../services/redis.js', () => {
  const redisService = {
    increment: vi.fn(async () => null),
    del: vi.fn(async () => true),
    getClient: vi.fn(() => null),
    get: vi.fn(async () => null),
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

const dbState = {
  brands: [] as Array<{ id: string; userId: string; preferences?: unknown }>,
  imageGenerationLogs: [] as Array<any>,
};

vi.mock('../../config/database.js', () => {
  const prisma = {
    brand: {
      findUnique: vi.fn(async (args: any) => {
        const id = args?.where?.id as string | undefined;
        const brand = dbState.brands.find((b) => b.id === id) ?? null;
        if (!brand) return null;
        const select = args?.select as Record<string, boolean> | undefined;
        if (!select) return brand;
        const picked: any = {};
        for (const key of Object.keys(select)) {
          if (select[key]) picked[key] = (brand as any)[key];
        }
        return picked;
      }),
      update: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        const data = args?.data ?? {};
        const brand = dbState.brands.find((b) => b.id === id);
        if (!brand) throw new Error('Brand not found');
        if (Object.prototype.hasOwnProperty.call(data, 'preferences')) {
          brand.preferences = data.preferences;
        }
        return brand;
      }),
    },
    imageGenerationLog: {
      findMany: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        const brandId = where.brandId as string | undefined;
        const createdAt = where.createdAt as { gte?: Date; lte?: Date } | undefined;

        return dbState.imageGenerationLogs
          .filter((log) => (brandId ? log.brandId === brandId : true))
          .filter((log) => {
            if (!createdAt) return true;
            const ts = new Date(log.createdAt).getTime();
            const gte = createdAt.gte ? createdAt.gte.getTime() : undefined;
            const lte = createdAt.lte ? createdAt.lte.getTime() : undefined;
            if (gte !== undefined && ts < gte) return false;
            if (lte !== undefined && ts > lte) return false;
            return true;
          })
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }),
    },
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

const { buildFastify } = await import('../../server.js');

describe('Image Providers Routes', () => {
  let app: FastifyInstance;
  let authHeader: string;
  let brandId: string;

  describe('GET /api/image-providers', () => {
    it('returns list of configured providers', async () => {
      process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';

      const response = await app.inject({
        method: 'GET',
        url: '/api/image-providers',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data).toHaveProperty('providers');
      expect(data).toHaveProperty('default');
      expect(Array.isArray(data.providers)).toBe(true);
    });

    it('returns providers with required properties', async () => {
      process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';

      const response = await app.inject({
        method: 'GET',
        url: '/api/image-providers',
      });

      const data = JSON.parse(response.body);
      if (data.providers.length > 0) {
        const provider = data.providers[0];
        expect(provider).toHaveProperty('name');
        expect(provider).toHaveProperty('displayName');
        expect(provider).toHaveProperty('isConfigured');
        expect(provider).toHaveProperty('pricing');
        expect(provider.pricing).toHaveProperty('standard');
        expect(provider.pricing).toHaveProperty('speedEstimate');
        expect(provider.pricing).toHaveProperty('features');
      }
    });

    it('does not require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/image-providers',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /api/image-providers/:brandId/preference', () => {
    it('returns brand preference when authenticated', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/image-providers/${brandId}/preference`,
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data).toHaveProperty('imageProvider');
      expect(data).toHaveProperty('defaultProvider');
    });

    it('returns 401 when not authenticated', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/image-providers/${brandId}/preference`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 for non-existent brand', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/image-providers/non-existent-id/preference',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns null imageProvider when not set', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/image-providers/${brandId}/preference`,
        headers: {
          authorization: authHeader,
        },
      });

      const data = JSON.parse(response.body);
      expect(data.imageProvider).toBeNull();
    });
  });

  describe('POST /api/image-providers/:brandId/preference', () => {
    it('updates brand preference successfully', async () => {
      process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';

      const response = await app.inject({
        method: 'POST',
        url: `/api/image-providers/${brandId}/preference`,
        headers: {
          authorization: authHeader,
        },
        payload: {
          imageProvider: 'dalle-3',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.success).toBe(true);
      expect(data.imageProvider).toBe('dalle-3');
    });

    it('persists preference to database', async () => {
      process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';

      await app.inject({
        method: 'POST',
        url: `/api/image-providers/${brandId}/preference`,
        headers: {
          authorization: authHeader,
        },
        payload: {
          imageProvider: 'dalle-3',
        },
      });

      // Verify by fetching
      const getResponse = await app.inject({
        method: 'GET',
        url: `/api/image-providers/${brandId}/preference`,
        headers: {
          authorization: authHeader,
        },
      });

      const data = JSON.parse(getResponse.body);
      expect(data.imageProvider).toBe('dalle-3');
    });

    it('returns 401 when not authenticated', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/image-providers/${brandId}/preference`,
        payload: {
          imageProvider: 'dalle-3',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 for invalid provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/image-providers/${brandId}/preference`,
        headers: {
          authorization: authHeader,
        },
        payload: {
          imageProvider: 'invalid-provider',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 for non-existent brand', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/image-providers/non-existent-id/preference',
        headers: {
          authorization: authHeader,
        },
        payload: {
          imageProvider: 'dalle-3',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('validates request body schema', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/image-providers/${brandId}/preference`,
        headers: {
          authorization: authHeader,
        },
        payload: {
          // Missing imageProvider field
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/image-providers/:brandId/analytics', () => {
    it('returns analytics data when authenticated', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/image-providers/${brandId}/analytics`,
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data).toHaveProperty('overall');
      expect(data).toHaveProperty('byProvider');
      expect(data).toHaveProperty('recentLogs');
      expect(data.overall).toHaveProperty('totalGenerated');
      expect(data.overall).toHaveProperty('totalCost');
      expect(data.overall).toHaveProperty('avgCostPerImage');
    });

    it('returns empty analytics for new brand', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/image-providers/${brandId}/analytics`,
        headers: {
          authorization: authHeader,
        },
      });

      const data = JSON.parse(response.body);
      expect(data.overall.totalGenerated).toBe(0);
      expect(data.overall.totalCost).toBe(0);
      expect(data.recentLogs).toHaveLength(0);
    });

    it('supports date range filtering', async () => {
      const startDate = '2024-01-01';
      const endDate = '2024-12-31';
      const response = await app.inject({
        method: 'GET',
        url: `/api/image-providers/${brandId}/analytics?startDate=${startDate}&endDate=${endDate}`,
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 401 when not authenticated', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/image-providers/${brandId}/analytics`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 for non-existent brand', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/image-providers/non-existent-id/analytics',
        headers: {
          authorization: authHeader,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  beforeEach(async () => {
    // Reset in-memory DB between tests
    dbState.brands.length = 0;
    dbState.imageGenerationLogs.length = 0;

    brandId = 'brand-1';
    dbState.brands.push({ id: brandId, userId: 'user-123', preferences: null });

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

  afterEach(async () => {
    await app.close();
  });
});
