import type { FastifyInstance } from 'fastify';

import {
  loadAssetsById,
  periodToDays,
  prisma,
  resolveSocialAccountForUser,
  resolveThumbnail,
} from './shared.js';

type PostsQuery = {
  period?: '7d' | '30d' | '90d';
  sortBy?: string;
  order?: 'asc' | 'desc';
  limit?: string;
  offset?: string;
};

function parsePagination(query: PostsQuery) {
  const take = Math.min(Math.max(parseInt(query.limit || '20', 10) || 20, 1), 100);
  const skip = Math.max(parseInt(query.offset || '0', 10) || 0, 0);
  return { take, skip };
}

function buildOrderByClause(sortBy: string | undefined, order: 'asc' | 'desc') {
  if (sortBy === 'publishedAt' || !sortBy) {
    return { publishedAt: order };
  }
  if (['impressions', 'reach', 'engagement', 'engagementRate'].includes(sortBy)) {
    return { metricsLatest: { [sortBy]: order } };
  }
  return { publishedAt: 'desc' as const };
}

async function fetchSocialAccountPosts(params: {
  socialAccountId: string;
  period: '7d' | '30d' | '90d';
  sortBy?: string;
  order: 'asc' | 'desc';
  limit?: string;
  offset?: string;
}) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - periodToDays(params.period));
  const { take, skip } = parsePagination({ limit: params.limit, offset: params.offset });
  const where = { socialAccountId: params.socialAccountId, publishedAt: { gte: start, lte: end } };

  const [posts, total] = await Promise.all([
    prisma.contentPublication.findMany({
      where,
      orderBy: buildOrderByClause(params.sortBy, params.order) as any,
      take,
      skip,
      select: {
        id: true,
        platform: true,
        contentId: true,
        permalink: true,
        publishedAt: true,
        metricsLatest: true,
        content: {
          select: {
            caption: true,
            mediaAssets: {
              select: { assetId: true, displayOrder: true },
              orderBy: { displayOrder: 'asc' },
              take: 1,
            },
          },
        },
      },
    }),
    prisma.contentPublication.count({ where }),
  ]);

  return { posts, total, take, skip };
}

function mapSocialAccountPosts(posts: any[], assetsById: Map<string, any>) {
  return posts.map((post) => {
    const metrics = post.metricsLatest || {
      impressions: 0,
      reach: 0,
      likes: 0,
      comments: 0,
      saves: 0,
      shares: 0,
      engagement: 0,
      engagementRate: 0,
    };
    const primaryAssetId = post.content.mediaAssets?.[0]?.assetId;
    const asset = primaryAssetId ? assetsById.get(primaryAssetId) : null;

    return {
      publicationId: post.id,
      contentId: post.contentId,
      platform: post.platform,
      caption: post.content.caption,
      thumbnailUrl: resolveThumbnail(asset),
      permalink: post.permalink,
      publishedAt: post.publishedAt,
      metrics,
    };
  });
}

export function registerSocialAccountPostsRoute(fastify: FastifyInstance) {
  fastify.get(
    '/analytics/social-accounts/:socialAccountId/posts',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { socialAccountId } = request.params as { socialAccountId: string };
      const query = request.query as PostsQuery;

      await resolveSocialAccountForUser({ userId, socialAccountId });
      const { posts, total, take, skip } = await fetchSocialAccountPosts({
        socialAccountId,
        period: query.period || '30d',
        sortBy: query.sortBy || 'publishedAt',
        order: query.order === 'asc' ? 'asc' : 'desc',
        limit: query.limit,
        offset: query.offset,
      });
      const primaryAssetIds = posts
        .map((post) => post.content.mediaAssets?.[0]?.assetId)
        .filter((id): id is string => Boolean(id));
      const assetsById = await loadAssetsById(primaryAssetIds);
      const data = mapSocialAccountPosts(posts, assetsById);

      return reply.send({
        success: true,
        data,
        pagination: { total, limit: take, offset: skip, hasMore: skip + take < total },
      });
    }
  );
}
