import type { FastifyInstance } from 'fastify';

import {
  assertBrandOwnershipIfAuthenticated,
  loadAssetMapByIds,
  prisma,
  resolveAssetThumbnail,
} from './shared.js';

function resolveLimit(limit: string | undefined) {
  return Math.min(Math.max(parseInt(String(limit), 10) || 10, 1), 50);
}

export function registerBrandTopPublicationsRoute(fastify: FastifyInstance) {
  fastify.get('/analytics/brands/:brandId/top-publications', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
      await assertBrandOwnershipIfAuthenticated(request, brandId);
      const { limit = '10' } = request.query as { limit?: string };

      const pubs = await prisma.contentPublication.findMany({
        where: { content: { brandId } },
        orderBy: { metricsLatest: { engagementRate: 'desc' } },
        take: resolveLimit(limit),
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
      });

      const primaryAssetIds = pubs
        .map((publication) => publication.content?.mediaAssets?.[0]?.assetId)
        .filter((id): id is string => Boolean(id));
      const assetsById = await loadAssetMapByIds({
        assetIds: primaryAssetIds,
        logger: fastify.log,
        brandId,
      });

      const data = pubs
        .filter((publication) => publication.metricsLatest)
        .map((publication) => {
          const primaryAssetId = publication.content?.mediaAssets?.[0]?.assetId;
          const asset = primaryAssetId ? assetsById.get(primaryAssetId) : null;

          return {
            publicationId: publication.id,
            platform: publication.platform,
            contentId: publication.contentId,
            permalink: publication.permalink,
            publishedAt: publication.publishedAt,
            metrics: publication.metricsLatest,
            caption: publication.content?.caption || undefined,
            thumbnailUrl: resolveAssetThumbnail(asset),
            imageUrl:
              asset?.fileType === 'image' && typeof asset?.url === 'string' ? asset.url : undefined,
          };
        });

      return reply.send({ success: true, data });
    } catch (error) {
      request.log.error({ error }, 'Failed to get top publications');
      throw error;
    }
  });
}
