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

vi.mock('../../services/ownership.js', () => ({
  assertBrandOwnership: vi.fn(async (userId: string, brandId: string) => ({
    id: brandId,
    userId,
    preferences: {},
  })),
}));

vi.mock('../../services/timezone.js', () => ({
  TimezoneService: {
    getBrandTimezone: vi.fn(async () => 'UTC'),
    createDateInBrandTimezone: vi.fn((date: string, time: string) => {
      return new Date(`${date}T${time}:00.000Z`);
    }),
  },
}));

vi.mock('../../config/database.js', () => {
  const publishedAt = new Date('2025-01-10T12:34:56.000Z');
  const contentRecord = {
    id: 'content-1',
    caption: 'hello',
    hashtags: [],
    status: 'published',
    scheduledAt: null,
    postedAt: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    brandId: 'brand-1',
    publications: [
      {
        platform: 'instagram',
        permalink: 'https://www.instagram.com/p/DSi7KB9DUXC/',
        publishedAt,
      },
    ],
    mediaAssets: [],
    _count: { mediaAssets: 0 },
  };

  const prisma = {
    content: {
      findMany: vi.fn(async (args: any) => {
        const hasPublicationsOr =
          Array.isArray(args?.where?.OR) &&
          args.where.OR.some(
            (entry: any) => entry && typeof entry === 'object' && entry.publications
          );

        const selectsPublishedAt = args?.include?.publications?.select?.publishedAt === true;

        if (!hasPublicationsOr || !selectsPublishedAt) {
          return [];
        }

        return [contentRecord];
      }),
    },
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

describe('Brand calendar route', () => {
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
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('includes published posts based on publication date and surfaces postedAt', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/brands/brand-1/calendar/2025-01',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as any;
    expect(payload?.success).toBe(true);
    expect(payload?.data?.content).toHaveLength(1);
    expect(payload.data.content[0]?.id).toBe('content-1');
    expect(payload.data.content[0]?.postedAt).toBe('2025-01-10T12:34:56.000Z');
    expect(payload.data.content[0]?.permalink).toBe('https://www.instagram.com/p/DSi7KB9DUXC/');
  });
});
