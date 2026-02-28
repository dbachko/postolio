import type { FastifyInstance } from 'fastify';

import {
  assertBrandOwnershipIfAuthenticated,
  loadAssetMapByIds,
  prisma,
  resolveAssetThumbnail,
} from './shared.js';

type PostsQuery = {
  platform?: string;
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

function buildWhereClause(brandId: string, platform?: string) {
  const where: Record<string, unknown> = { content: { brandId } };
  if (platform) {
    where.platform = platform;
  }
  return where;
}

async function fetchBrandPosts(params: { brandId: string; query: PostsQuery }) {
  const order = params.query.order === 'asc' ? 'asc' : 'desc';
  const { take, skip } = parsePagination(params.query);
  const where = buildWhereClause(params.brandId, params.query.platform);
  const orderByClause = buildOrderByClause(params.query.sortBy, order);

  const [posts, total] = await Promise.all([
    prisma.contentPublication.findMany({
      where,
      orderBy: orderByClause as any,
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

function mapBrandPostsResponse(posts: any[], assetsById: Map<string, any>) {
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
      thumbnailUrl: resolveAssetThumbnail(asset) || null,
      permalink: post.permalink,
      publishedAt: post.publishedAt,
      metrics,
    };
  });
}

function createBrandPostsHandler(fastify: FastifyInstance) {
  return async (request: any, reply: any) => {
    try {
      const { brandId } = request.params as { brandId: string };
      await assertBrandOwnershipIfAuthenticated(request, brandId);
      const query = request.query as PostsQuery;
      const { posts, total, take, skip } = await fetchBrandPosts({ brandId, query });
      const primaryAssetIds = posts
        .map((post) => post.content.mediaAssets?.[0]?.assetId)
        .filter((id): id is string => Boolean(id));
      const assetsById = await loadAssetMapByIds({
        assetIds: primaryAssetIds,
        logger: fastify.log,
        brandId,
      });
      const data = mapBrandPostsResponse(posts, assetsById);

      return reply.send({
        success: true,
        data,
        pagination: { total, limit: take, offset: skip, hasMore: skip + take < total },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to get posts performance');
      throw error;
    }
  };
}

export function registerBrandPostsRoute(fastify: FastifyInstance) {
  fastify.get('/analytics/brands/:brandId/posts', createBrandPostsHandler(fastify));
}
