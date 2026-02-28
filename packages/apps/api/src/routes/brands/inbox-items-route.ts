import type { FastifyInstance } from 'fastify';

import { assertBrandOwnership } from '../../services/ownership.js';
import { parseBoundedInt, parseQueryList, prisma, requireInboxFeature } from './shared.js';

type InboxItemsQuery = {
  socialAccountId?: string | string[];
  channel?: string | string[];
  platform?: string | string[];
  view?: 'to_review' | 'all';
  limit?: string;
};

type InboxFilters = {
  socialAccountIds: string[];
  channels: Set<string> | null;
  platforms: Set<string> | null;
  view: 'to_review' | 'all';
  limit: number;
};

function normalizePlatform(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'ig') {
    return 'instagram';
  }
  if (normalized === 'fb') {
    return 'facebook';
  }
  return normalized;
}

function parseInboxFilters(query: InboxItemsQuery): InboxFilters {
  const socialAccountIds = parseQueryList(query.socialAccountId);
  const channelsRaw = parseQueryList(query.channel);
  const platformsRaw = parseQueryList(query.platform);
  const view = query.view === 'all' ? 'all' : 'to_review';
  const limit = parseBoundedInt(query.limit, 50, 1, 100);

  const platformAllowList = new Set([
    'instagram',
    'facebook',
    'linkedin',
    'x',
    'youtube',
    'tiktok',
  ]);
  const normalizedPlatforms = platformsRaw
    .map(normalizePlatform)
    .filter((platform) => platformAllowList.has(platform));

  return {
    socialAccountIds,
    channels: channelsRaw.length ? new Set(channelsRaw) : null,
    platforms: normalizedPlatforms.length ? new Set(normalizedPlatforms) : null,
    view,
    limit,
  };
}

function shouldIncludeComments(channels: Set<string> | null): boolean {
  return !channels || channels.has('comments') || channels.has('comment');
}

function shouldIncludeDMs(channels: Set<string> | null): boolean {
  return !channels || channels.has('dms') || channels.has('dm');
}

function resolveCommentPlatforms(platforms: Set<string> | null): Array<'instagram' | 'facebook'> {
  const supported = ['instagram', 'facebook'] as const;
  if (!platforms) {
    return [...supported];
  }
  return supported.filter((platform) => platforms.has(platform));
}

async function loadCommentCounts(publicationIds: string[]) {
  const grouped = publicationIds.length
    ? await prisma.publicationComment.groupBy({
        by: ['publicationId', 'status'],
        where: { publicationId: { in: publicationIds } },
        _count: { _all: true },
      })
    : [];

  const countsByPublicationId = new Map<
    string,
    { open: number; resolved: number; archived: number }
  >();
  for (const row of grouped) {
    const entry = countsByPublicationId.get(row.publicationId) || {
      open: 0,
      resolved: 0,
      archived: 0,
    };
    if (row.status === 'open') {
      entry.open = row._count._all;
    }
    if (row.status === 'resolved') {
      entry.resolved = row._count._all;
    }
    if (row.status === 'archived') {
      entry.archived = row._count._all;
    }
    countsByPublicationId.set(row.publicationId, entry);
  }

  return countsByPublicationId;
}

async function loadLatestComments(publicationIds: string[], view: 'to_review' | 'all') {
  const rows = publicationIds.length
    ? await prisma.publicationComment.findMany({
        where: {
          publicationId: { in: publicationIds },
          ...(view === 'to_review' ? { status: 'open' } : {}),
        },
        orderBy: [{ publicationId: 'asc' }, { createdAt: 'desc' }],
        distinct: ['publicationId'],
        select: {
          publicationId: true,
          text: true,
          authorUsername: true,
          createdAt: true,
        },
      })
    : [];

  return new Map(
    rows.map((row) => [
      row.publicationId,
      {
        text: row.text,
        authorUsername: row.authorUsername,
        createdAt: row.createdAt,
      },
    ])
  );
}

async function buildCommentItems(params: {
  brandId: string;
  socialAccountIds: string[];
  view: 'to_review' | 'all';
  platforms: Set<string> | null;
}) {
  const commentPlatforms = resolveCommentPlatforms(params.platforms);
  if (commentPlatforms.length === 0) {
    return [];
  }

  const publications = await prisma.contentPublication.findMany({
    where: {
      platform: { in: commentPlatforms as any },
      socialAccount: { brandId: params.brandId, platform: { in: commentPlatforms as any } },
      ...(params.socialAccountIds.length
        ? { socialAccountId: { in: params.socialAccountIds } }
        : {}),
    },
    orderBy: { publishedAt: 'desc' },
    take: 200,
    select: {
      id: true,
      platform: true,
      socialAccountId: true,
      permalink: true,
      publishedAt: true,
      metricsLatest: { select: { comments: true } },
      content: {
        select: {
          id: true,
          caption: true,
          postedAt: true,
          mediaAssets: {
            select: { assetId: true, displayOrder: true },
            orderBy: { displayOrder: 'asc' },
            take: 1,
          },
        },
      },
    },
  });

  const publicationIds = publications.map((publication) => publication.id).filter(Boolean);
  const countsByPublicationId = await loadCommentCounts(publicationIds);
  const latestCommentByPublicationId = await loadLatestComments(publicationIds, params.view);

  const items: any[] = [];
  for (const publication of publications) {
    const counts = countsByPublicationId.get(publication.id) || {
      open: 0,
      resolved: 0,
      archived: 0,
    };
    const persistedTotal = counts.open + counts.resolved + counts.archived;
    const metricsTotal = Number.isFinite(publication.metricsLatest?.comments)
      ? publication.metricsLatest?.comments || 0
      : 0;
    const totalComments = Math.max(persistedTotal, metricsTotal);
    if (totalComments <= 0) {
      continue;
    }

    const newCount = persistedTotal > 0 ? counts.open : totalComments;
    if (params.view === 'to_review' && (!publication.content?.id || newCount <= 0)) {
      continue;
    }

    const latest = latestCommentByPublicationId.get(publication.id) || null;
    const lastActivityAt =
      latest?.createdAt || publication.content?.postedAt || publication.publishedAt || null;

    items.push({
      type: 'comment_thread',
      platform: publication.platform,
      socialAccountId: publication.socialAccountId,
      publicationId: publication.id,
      postId: publication.content?.id || '',
      caption: publication.content?.caption || null,
      primaryAssetId: publication.content?.mediaAssets?.[0]?.assetId ?? null,
      permalink: publication.permalink || null,
      postedAt: publication.content?.postedAt || publication.publishedAt || null,
      totalComments,
      resolvedCount: counts.resolved,
      newCount,
      lastActivityAt,
      previewText: latest?.text || null,
      previewAuthorUsername: latest?.authorUsername || null,
    });
  }

  return items;
}

async function buildDmItems(params: {
  brandId: string;
  socialAccountIds: string[];
  view: 'to_review' | 'all';
  platforms: Set<string> | null;
}) {
  const where: any = { brandId: params.brandId };
  if (params.socialAccountIds.length) {
    where.socialAccountId = { in: params.socialAccountIds };
  }
  if (params.view === 'to_review') {
    where.state = 'active';
  }
  if (params.platforms) {
    where.platform = { in: Array.from(params.platforms) } as any;
  }

  const conversations = await prisma.dMConversation.findMany({
    where,
    orderBy: { lastMessageAt: 'desc' },
    take: 200,
    include: { _count: { select: { messages: true } } },
  });

  const conversationIds = conversations.map((conversation) => conversation.id);
  const lastMessages = conversationIds.length
    ? await prisma.dMMessage.findMany({
        where: { conversationId: { in: conversationIds } },
        orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }],
        distinct: ['conversationId'],
        select: {
          conversationId: true,
          messageText: true,
          direction: true,
          createdAt: true,
        },
      })
    : [];

  const lastMessageByConversationId = new Map(
    lastMessages.map((message) => [
      message.conversationId,
      {
        text: message.messageText,
        direction: message.direction,
        createdAt: message.createdAt,
      },
    ])
  );

  const items: any[] = [];
  for (const conversation of conversations) {
    if (conversation._count.messages <= 0) {
      continue;
    }

    const last = lastMessageByConversationId.get(conversation.id) || null;
    if (params.view === 'to_review' && last?.direction !== 'inbound') {
      continue;
    }

    items.push({
      type: 'dm_conversation',
      platform: conversation.platform,
      socialAccountId: conversation.socialAccountId,
      conversationId: conversation.id,
      state: conversation.state,
      participantUsername: conversation.participantUsername,
      lastMessageAt: conversation.lastMessageAt,
      lastMessageText: last?.text || null,
      lastMessageDirection: last?.direction || null,
      messageCount: conversation._count.messages,
    });
  }

  return items;
}

function sortInboxItems(items: any[]): any[] {
  items.sort((left, right) => {
    const leftTime = left.lastActivityAt
      ? new Date(left.lastActivityAt).getTime()
      : left.lastMessageAt
        ? new Date(left.lastMessageAt).getTime()
        : 0;

    const rightTime = right.lastActivityAt
      ? new Date(right.lastActivityAt).getTime()
      : right.lastMessageAt
        ? new Date(right.lastMessageAt).getTime()
        : 0;

    return rightTime - leftTime;
  });

  return items;
}

export function registerBrandInboxItemsRoute(fastify: FastifyInstance): void {
  fastify.get<{ Params: { id: string }; Querystring: InboxItemsQuery }>(
    '/:id/inbox/items',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId } = request.params;

        await assertBrandOwnership(userId, brandId);

        const filters = parseInboxFilters(request.query);
        const items: any[] = [];

        if (shouldIncludeComments(filters.channels)) {
          items.push(
            ...(await buildCommentItems({
              brandId,
              socialAccountIds: filters.socialAccountIds,
              view: filters.view,
              platforms: filters.platforms,
            }))
          );
        }

        if (shouldIncludeDMs(filters.channels)) {
          items.push(
            ...(await buildDmItems({
              brandId,
              socialAccountIds: filters.socialAccountIds,
              view: filters.view,
              platforms: filters.platforms,
            }))
          );
        }

        return reply.send({ items: sortInboxItems(items).slice(0, filters.limit) });
      } catch (error) {
        request.log.error({ err: error }, 'Inbox items error');
        return reply.code(500).send({ error: 'Failed to retrieve inbox items' });
      }
    }
  );
}
