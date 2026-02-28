import type { FastifyInstance } from 'fastify';

import { prisma } from './shared.js';

function mapHistoryItem(item: any) {
  const publications = item.publications || [];
  const instagramPublication = publications.find(
    (publication: any) => publication.platform === 'instagram'
  );
  const permalink = instagramPublication?.permalink || publications[0]?.permalink || null;

  return {
    id: item.id,
    caption: item.caption,
    hashtags: item.hashtags,
    primaryAssetId: item.mediaAssets?.[0]?.assetId ?? null,
    status: item.status,
    scheduledAt: item.scheduledAt,
    postedAt: item.postedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    permalink,
    shareToFeed: item.shareToFeed,
  };
}

export function registerBrandContentHistoryRoute(fastify: FastifyInstance): void {
  fastify.get<{ Params: { id: string } }>(
    '/:id/content/history',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId } = request.params;

        const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        const contentHistory = await prisma.content.findMany({
          where: {
            brandId,
            status: { in: ['draft', 'scheduled', 'published', 'failed', 'skipped'] },
          },
          select: {
            id: true,
            caption: true,
            hashtags: true,
            status: true,
            scheduledAt: true,
            postedAt: true,
            createdAt: true,
            updatedAt: true,
            shareToFeed: true,
            mediaAssets: {
              select: { assetId: true, displayOrder: true },
              orderBy: { displayOrder: 'asc' },
              take: 1,
            },
            publications: { select: { platform: true, permalink: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        });

        return { content: contentHistory.map((item) => mapHistoryItem(item)) };
      } catch (error) {
        request.log.error({ err: error }, 'Content history error');
        return reply.code(500).send({ error: 'Failed to retrieve content history' });
      }
    }
  );
}
