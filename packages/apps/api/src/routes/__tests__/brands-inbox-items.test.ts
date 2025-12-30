import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Keep CSRF behavior out of unit tests; mock these plugins as no-ops.
vi.mock('@fastify/csrf-protection', () => ({
  default: (async () => {}) as any,
}));

vi.mock('../../plugins/csrf-auto-protect.js', () => ({
  default: (async () => {}) as any,
}));

// Avoid starting real Bull workers/Redis connections during tests.
vi.mock('../../services/background-jobs.js', () => ({
  JobType: {
    INBOX_COMMENTS_INGEST: 'inbox-comments-ingest',
    INBOX_COMMENTS_BACKFILL: 'inbox-comments-backfill',
    INBOX_DMS_INGEST: 'inbox-dms-ingest',
  },
  backgroundJobs: {
    scheduleJob: vi.fn(async () => ({ id: 'job-1' })),
    scheduleRecurringJobs: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
  },
}));

vi.mock('../../services/regeneration-queue.js', () => ({
  regenerationService: {
    startRegeneration: vi.fn(),
    getJobProgress: vi.fn(),
    cancelJob: vi.fn(),
  },
}));

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

vi.mock('../../config/database.js', () => {
  const pubs: any[] = [];
  const commentCountsByPubId = new Map<
    string,
    { open: number; resolved: number; archived: number }
  >();
  const latestCommentByPubId = new Map<
    string,
    { text: string | null; authorUsername: string | null; createdAt: Date }
  >();

  const conversations: any[] = [];
  const lastMessageByConversationId = new Map<
    string,
    { messageText: string | null; direction: string | null; createdAt: Date }
  >();

  const prisma = {
    contentPublication: {
      findMany: vi.fn(async () => pubs.slice()),
    },
    publicationComment: {
      groupBy: vi.fn(async (args: any) => {
        const pubIds = Array.isArray(args?.where?.publicationId?.in)
          ? args.where.publicationId.in
          : [];
        const rows: any[] = [];
        for (const id of pubIds) {
          const counts = commentCountsByPubId.get(id);
          if (!counts) continue;
          for (const [status, count] of Object.entries(counts)) {
            if (!count) continue;
            rows.push({ publicationId: id, status, _count: { _all: count } });
          }
        }
        return rows;
      }),
      findMany: vi.fn(async (args: any) => {
        const pubIds = Array.isArray(args?.where?.publicationId?.in)
          ? args.where.publicationId.in
          : [];
        const out: any[] = [];
        for (const id of pubIds) {
          const row = latestCommentByPubId.get(id);
          if (!row) continue;
          out.push({ publicationId: id, ...row });
        }
        return out;
      }),
    },
    dMConversation: {
      findMany: vi.fn(async () => conversations.slice()),
    },
    dMMessage: {
      findMany: vi.fn(async (args: any) => {
        const ids = Array.isArray(args?.where?.conversationId?.in)
          ? args.where.conversationId.in
          : [];
        return ids
          .map((id: string) => {
            const row = lastMessageByConversationId.get(id);
            return row
              ? {
                  conversationId: id,
                  messageText: row.messageText,
                  direction: row.direction,
                  createdAt: row.createdAt,
                }
              : null;
          })
          .filter(Boolean);
      }),
    },
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
    __test: {
      pubs,
      conversations,
      commentCountsByPubId,
      latestCommentByPubId,
      lastMessageByConversationId,
    },
  };
});

describe('Brands inbox items', () => {
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

    const db = await import('../../config/database.js');
    const now = new Date('2025-01-10T00:00:00.000Z');

    db.__test.pubs.length = 0;
    db.__test.pubs.push(
      {
        id: 'pub-1',
        platform: 'instagram',
        socialAccountId: 'sa-1',
        permalink: null,
        publishedAt: now,
        metricsLatest: { comments: 0 },
        content: {
          id: 'post-1',
          caption: 'No comments',
          postedAt: now,
          mediaAssets: [{ assetId: 'asset-1', displayOrder: 0 }],
        },
      },
      {
        id: 'pub-2',
        platform: 'instagram',
        socialAccountId: 'sa-1',
        permalink: null,
        publishedAt: now,
        metricsLatest: { comments: 2 },
        content: {
          id: 'post-2',
          caption: 'Has comments',
          postedAt: now,
          mediaAssets: [{ assetId: 'asset-2', displayOrder: 0 }],
        },
      },
      {
        id: 'pub-3',
        platform: 'instagram',
        socialAccountId: 'sa-2',
        permalink: null,
        publishedAt: now,
        metricsLatest: { comments: 0 },
        content: {
          id: 'post-3',
          caption: 'Persisted comment',
          postedAt: now,
          mediaAssets: [{ assetId: 'asset-3', displayOrder: 0 }],
        },
      }
    );

    db.__test.commentCountsByPubId.clear();
    db.__test.commentCountsByPubId.set('pub-3', { open: 1, resolved: 0, archived: 0 });

    db.__test.latestCommentByPubId.clear();
    db.__test.latestCommentByPubId.set('pub-3', {
      text: 'hello',
      authorUsername: 'alice',
      createdAt: now,
    });

    db.__test.conversations.length = 0;
    db.__test.conversations.push(
      {
        id: 'conv-1',
        brandId: 'brand-1',
        socialAccountId: 'sa-1',
        platform: 'instagram',
        state: 'active',
        participantUsername: 'bob',
        lastMessageAt: now,
        _count: { messages: 0 },
      },
      {
        id: 'conv-2',
        brandId: 'brand-1',
        socialAccountId: 'sa-1',
        platform: 'instagram',
        state: 'active',
        participantUsername: 'charlie',
        lastMessageAt: now,
        _count: { messages: 2 },
      }
    );

    db.__test.lastMessageByConversationId.clear();
    db.__test.lastMessageByConversationId.set('conv-2', {
      messageText: 'hi',
      direction: 'inbound',
      createdAt: now,
    });
  });

  it('only returns comment threads with activity and DM conversations with messages', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/brands/brand-1/inbox/items?view=all&limit=100',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(Array.isArray(body.items)).toBe(true);

    const types = body.items.map((i: any) => i.type);
    expect(types).toContain('comment_thread');
    expect(types).toContain('dm_conversation');

    const commentThreads = body.items.filter((i: any) => i.type === 'comment_thread');
    const pubIds = commentThreads.map((i: any) => i.publicationId);

    // pub-1 has 0 comments and no persisted rows; it should not appear.
    expect(pubIds).not.toContain('pub-1');
    expect(pubIds).toContain('pub-2');
    expect(pubIds).toContain('pub-3');

    const pub2 = commentThreads.find((i: any) => i.publicationId === 'pub-2');
    expect(pub2.totalComments).toBe(2);
    expect(pub2.newCount).toBe(2);

    const pub3 = commentThreads.find((i: any) => i.publicationId === 'pub-3');
    expect(pub3.totalComments).toBe(1);
    expect(pub3.newCount).toBe(1);
    expect(pub3.previewText).toBe('hello');
    expect(pub3.previewAuthorUsername).toBe('alice');

    const dmConversations = body.items.filter((i: any) => i.type === 'dm_conversation');
    const convIds = dmConversations.map((i: any) => i.conversationId);
    expect(convIds).toEqual(['conv-2']);
  });
});
