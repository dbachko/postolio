import type { FastifyInstance } from 'fastify';

import { prisma } from './shared.js';

type HashtagStats = {
  uses: number;
  totalReach: number;
  totalEngagement: number;
  totalImpressions: number;
  bestPost: { contentId: string; engagementRate: number } | null;
};

function getInitialHashtagStats(): HashtagStats {
  return {
    uses: 0,
    totalReach: 0,
    totalEngagement: 0,
    totalImpressions: 0,
    bestPost: null,
  };
}

export function registerBrandHashtagsRoute(fastify: FastifyInstance) {
  fastify.get('/analytics/brands/:brandId/hashtags', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
      const contents = await prisma.content.findMany({
        where: { brandId, status: 'published' },
        select: {
          id: true,
          hashtags: true,
          publications: {
            select: {
              id: true,
              metricsLatest: true,
            },
          },
        },
      });

      const hashtagMap = new Map<string, HashtagStats>();
      for (const content of contents) {
        for (const rawHashtag of content.hashtags || []) {
          const hashtag = rawHashtag.toLowerCase();
          const stats = hashtagMap.get(hashtag) || getInitialHashtagStats();
          stats.uses += 1;

          for (const publication of content.publications) {
            if (!publication.metricsLatest) {
              continue;
            }
            stats.totalReach += publication.metricsLatest.reach || 0;
            stats.totalEngagement += publication.metricsLatest.engagement || 0;
            stats.totalImpressions += publication.metricsLatest.impressions || 0;
            const engagementRate = Number(publication.metricsLatest.engagementRate || 0);
            if (!stats.bestPost || engagementRate > stats.bestPost.engagementRate) {
              stats.bestPost = { contentId: content.id, engagementRate };
            }
          }

          hashtagMap.set(hashtag, stats);
        }
      }

      const hashtags = Array.from(hashtagMap.entries()).map(([hashtag, stats]) => ({
        hashtag,
        uses: stats.uses,
        avgReach: stats.uses > 0 ? Math.round(stats.totalReach / stats.uses) : 0,
        avgEngagement: stats.uses > 0 ? Math.round(stats.totalEngagement / stats.uses) : 0,
        avgImpressions: stats.uses > 0 ? Math.round(stats.totalImpressions / stats.uses) : 0,
        bestPost: stats.bestPost,
      }));

      hashtags.sort((left, right) => right.avgEngagement - left.avgEngagement);
      return reply.send({ success: true, data: hashtags.slice(0, 50) });
    } catch (error) {
      request.log.error({ error }, 'Failed to get hashtag analysis');
      throw error;
    }
  });
}
