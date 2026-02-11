import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildFastify } from '../../../server.js';

// Keep CSRF behavior out of unit tests; mock these plugins as no-ops.
vi.mock('@fastify/csrf-protection', () => ({
  default: (async () => {}) as any,
}));

vi.mock('../../../plugins/csrf-auto-protect.js', () => ({
  default: (async () => {}) as any,
}));

// Disable Redis-backed rate limiting in these tests to avoid
// stateful 429 responses when hitting endpoints repeatedly.
vi.mock('../../../services/redis.js', () => {
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

// Force publish-now to always authorize for these tests.
vi.mock('../../../services/content-operations/authorization.js', async () => {
  const actual = await vi.importActual<any>(
    '../../../services/content-operations/authorization.js'
  );

  return {
    ...actual,
    verifyContentEditable: vi.fn(async () => ({
      authorized: true,
      data: {},
    })),
  };
});

// Scheduler adapter is the only piece we need to fake for publish-now routes.
vi.mock('../../../services/scheduler-adapter.js', () => {
  const schedulerAdapter = {
    setBroadcaster: vi.fn(),
    scheduleContent: vi.fn(),
    cancelSchedule: vi.fn(),
    rescheduleContent: vi.fn(),
    updateScheduledContent: vi.fn(),
    getScheduledContent: vi.fn(async () => []),
    getSchedulingStats: vi.fn(async () => ({ totalScheduled: 0, upcoming: 0 })),
    healthCheck: vi.fn(async () => true),
    publishNow: vi.fn(async (contentId: string) => ({
      success: true,
      scheduleId: `schedule-${contentId}`,
    })),
  };

  return {
    SchedulerAdapter: class {},
    deriveScheduleMediaType: vi.fn(),
    schedulerAdapter,
  };
});

// Minimal in-memory Prisma mock for this suite.
vi.mock('../../../config/database.js', () => {
  const contentGroups: any[] = [];
  const contents: any[] = [];

  const prisma = {
    contentGroup: {
      create: vi.fn(async (args: any) => {
        const id = `cg-${contentGroups.length + 1}`;
        const record = {
          id,
          brandId: args?.data?.brandId,
          createdAt: new Date(),
          updatedAt: new Date(),
          templateInitialized: false,
          templateCaption: null,
          templateContentType: null,
          templateShareToFeed: null,
          templateFirstComment: null,
          templateThumbOffset: null,
          templateAssetIds: [],
        };
        contentGroups.push(record);
        const select = args?.select;
        if (select?.id) return { id };
        return record;
      }),
      findUnique: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        const group = contentGroups.find((g) => g.id === id) ?? null;
        if (!group) return null;

        const include = args?.include;
        const base: any = { ...group };
        if (include?.brand) {
          base.brand = { id: group.brandId, userId: 'user-123' };
        }
        if (include?.contents) {
          base.contents = contents
            .filter((c) => c.contentGroupId === group.id)
            .map((c) => ({ ...c }));
        }
        return base;
      }),
    },
    content: {
      create: vi.fn(async (args: any) => {
        const data = args?.data ?? {};
        const record = {
          id: `content-${contents.length + 1}`,
          status: data.status ?? 'draft',
          brandId: data.brandId,
          contentGroupId: data.contentGroupId ?? null,
          targetSocialAccountId: data.targetSocialAccountId ?? null,
          caption: data.caption ?? null,
          hashtags: data.hashtags ?? [],
          scheduledAt: data.scheduledAt ?? null,
          postedAt: data.postedAt ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        contents.push(record);
        return record;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    brand: {
      findFirst: vi.fn(async () => ({
        id: 'brand-1',
        userId: 'user-123',
        name: 'Test Brand',
        preferences: {},
        postingTimezone: null,
      })),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma)),
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

import { schedulerAdapter } from '../../../services/scheduler-adapter.js';
import { prisma } from '../../../config/database.js';

describe('Content publish-now routes', () => {
  let app: FastifyInstance;
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = buildFastify();
    await app.ready();

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - jwt decorator is added by @fastify/jwt
    const token = await (app as any).jwt.sign({
      id: 'user-123',
      email: 'test-user@example.com',
    });
    authHeader = `Bearer ${token}`;

    (schedulerAdapter as any).publishNow.mockImplementation(async (contentId: string) => ({
      success: true,
      scheduleId: `schedule-${contentId}`,
    }));
  });

  it('publishes a single content item via scheduler pipeline', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/content/content-1/publish-now',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload?.success).toBe(true);
    expect(payload?.scheduleId).toBe('schedule-content-1');
  });

  it('publishes all non-published destinations in a content group', async () => {
    const group = await prisma.contentGroup.create({ data: { brandId: 'brand-1' } });
    const draft = await prisma.content.create({
      data: { brandId: 'brand-1', status: 'draft', contentGroupId: group.id },
    });
    await prisma.content.create({
      data: { brandId: 'brand-1', status: 'published', contentGroupId: group.id },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/content/groups/${group.id}/publish-now`,
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload?.success).toBe(true);
    expect(payload?.results).toHaveLength(1);
    expect(payload?.results?.[0]?.contentId).toBe(draft.id);
    expect(payload?.results?.[0]?.ok).toBe(true);

    expect((schedulerAdapter as any).publishNow).toHaveBeenCalledTimes(1);
    expect((schedulerAdapter as any).publishNow).toHaveBeenCalledWith(draft.id, 'user-123');
  });

  it('returns an error when a group is already fully published', async () => {
    const group = await prisma.contentGroup.create({ data: { brandId: 'brand-1' } });
    await prisma.content.create({
      data: { brandId: 'brand-1', status: 'published', contentGroupId: group.id },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/content/groups/${group.id}/publish-now`,
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(400);
    const payload = response.json();
    expect(payload?.error).toBe('content_group_already_published');
  });

  it('returns a 502 when any destination publish fails', async () => {
    const group = await prisma.contentGroup.create({ data: { brandId: 'brand-1' } });
    await prisma.content.create({
      data: { brandId: 'brand-1', status: 'draft', contentGroupId: group.id },
    });
    const failing = await prisma.content.create({
      data: { brandId: 'brand-1', status: 'draft', contentGroupId: group.id },
    });

    (schedulerAdapter as any).publishNow.mockImplementation(async (contentId: string) => {
      if (contentId === failing.id) {
        return { success: false, error: 'publisher_failed' };
      }
      return { success: true, scheduleId: `schedule-${contentId}` };
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/content/groups/${group.id}/publish-now`,
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(502);
    const payload = response.json();
    expect(payload?.success).toBe(false);
    expect(payload?.results).toHaveLength(2);
    expect(payload?.results?.some((r: any) => r.ok === false)).toBe(true);
  });
});
