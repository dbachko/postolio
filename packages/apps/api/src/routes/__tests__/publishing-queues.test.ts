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

vi.mock('../../services/ownership.js', () => ({
  assertSocialAccountAccess: vi.fn(async () => {}),
  assertPublishingQueueAccess: vi.fn(async (_userId: string, queueId: string) => ({
    id: queueId,
    socialAccountId: 'sa-1',
    paused: false,
    isDefault: true,
    socialAccount: { brandId: 'brand-1' },
  })),
}));

vi.mock('../../services/publishing-queue/queue-scheduler.js', () => ({
  publishingQueueScheduler: {
    recomputeBrandWindow: vi.fn(async () => ({
      success: true,
      windowSize: 10,
      assigned: 0,
      scheduled: 0,
      rescheduled: 0,
      cancelled: 0,
      errors: [],
    })),
  },
}));

vi.mock('../../services/scheduler.js', () => ({
  schedulerService: {
    cancelScheduledPost: vi.fn(async () => ({ success: true })),
  },
}));

// Minimal Prisma mock for publishing-queues routes (in-memory).
vi.mock('../../config/database.js', () => {
  let queueIdSeq = 1;
  const queues: any[] = [];
  const slots: any[] = [];

  const prisma = {
    publishingQueue: {
      findMany: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        let out = queues.slice();
        if (where.socialAccountId)
          out = out.filter((q) => q.socialAccountId === where.socialAccountId);
        return out.map((q) => ({
          ...q,
          _count: {
            slots: slots.filter((s) => s.queueId === q.id).length,
            items: 0,
          },
        }));
      }),
      create: vi.fn(async (args: any) => {
        const data = args?.data ?? {};
        const record = {
          id: `queue-${queueIdSeq++}`,
          socialAccountId: data.socialAccountId,
          name: data.name,
          paused: data.paused ?? false,
          isDefault: data.isDefault ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        queues.push(record);
        return {
          ...record,
          _count: { slots: 0, items: 0 },
        };
      }),
    },
    publishingQueueSlot: {
      findMany: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        let out = slots.slice();
        if (where.queueId) out = out.filter((s) => s.queueId === where.queueId);
        return out.map((s) => ({ ...s }));
      }),
      deleteMany: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        if (!where.queueId) return { count: 0 };
        const before = slots.length;
        for (let i = slots.length - 1; i >= 0; i--) {
          if (slots[i]?.queueId === where.queueId) slots.splice(i, 1);
        }
        return { count: before - slots.length };
      }),
      createMany: vi.fn(async (args: any) => {
        const data = Array.isArray(args?.data) ? args.data : [];
        for (const rec of data) {
          slots.push({
            id: `slot-${slots.length + 1}`,
            queueId: rec.queueId,
            socialAccountId: rec.socialAccountId,
            dayOfWeek: rec.dayOfWeek,
            localTime: rec.localTime,
            laneKey: rec.laneKey,
            enabled: rec.enabled ?? true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        return { count: data.length };
      }),
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

describe('Publishing queues routes', () => {
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

  it('lazy-creates the Default queue on first list', async () => {
    const first = await app.inject({
      method: 'GET',
      url: '/api/social-accounts/sa-1/queues',
      headers: { authorization: authHeader },
    });

    expect(first.statusCode).toBe(200);
    const payload1 = first.json() as any;
    expect(payload1?.success).toBe(true);
    expect(payload1?.data?.socialAccountId).toBe('sa-1');
    expect(payload1?.data?.queues).toHaveLength(1);
    expect(payload1.data.queues[0]?.name).toBe('Default');
    expect(payload1.data.queues[0]?.isDefault).toBe(true);

    const second = await app.inject({
      method: 'GET',
      url: '/api/social-accounts/sa-1/queues',
      headers: { authorization: authHeader },
    });

    expect(second.statusCode).toBe(200);
    const payload2 = second.json() as any;
    expect(payload2?.data?.queues).toHaveLength(1);
    expect(payload2.data.queues[0]?.id).toBe(payload1.data.queues[0]?.id);
  });

  it('replaces slot schedule and triggers a recompute', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/social-accounts/sa-1/queues',
      headers: { authorization: authHeader },
    });
    const queueId = (list.json() as any)?.data?.queues?.[0]?.id;
    expect(typeof queueId).toBe('string');

    const save = await app.inject({
      method: 'PUT',
      url: `/api/queues/${queueId}/slots`,
      headers: { authorization: authHeader },
      payload: {
        slots: [
          { dayOfWeek: 1, localTime: '11:00', laneKey: 'post', enabled: true },
          { dayOfWeek: 1, localTime: '11:30', laneKey: 'reel', enabled: true },
          { dayOfWeek: 1, localTime: '12:00', laneKey: 'any', enabled: true },
        ],
      },
    });

    expect(save.statusCode).toBe(200);

    const { publishingQueueScheduler } =
      await import('../../services/publishing-queue/queue-scheduler.js');
    expect(vi.mocked(publishingQueueScheduler.recomputeBrandWindow)).toHaveBeenCalledWith(
      'brand-1'
    );

    const getSlots = await app.inject({
      method: 'GET',
      url: `/api/queues/${queueId}/slots`,
      headers: { authorization: authHeader },
    });
    expect(getSlots.statusCode).toBe(200);
    const slotsPayload = getSlots.json() as any;
    expect(slotsPayload?.success).toBe(true);
    expect(slotsPayload?.data?.slots).toHaveLength(3);
  });
});
