import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../../config/database.js';
import { assertBrandOwnership } from '../../services/ownership.js';

const prisma = getDatabaseClient();

export const brandHashtagsAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/analytics/brands/:brandId/hashtags
  fastify.get(
    '/analytics/brands/:brandId/hashtags',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { brandId } = request.params as { brandId: string };

      await assertBrandOwnership(userId, brandId);

      const contents = await prisma.content.findMany({
        where: { brandId, status: 'published' },
        select: {
          id: true,
          hashtags: true,
          publications: {
            select: {
              metricsLatest: true,
            },
          },
        },
      });

      const hashtagMap = new Map<
        string,
        {
          uses: number;
          totalReach: number;
          totalEngagement: number;
          totalImpressions: number;
          bestPost: { contentId: string; engagementRate: number } | null;
        }
      >();

      for (const content of contents) {
        for (const hashtag of content.hashtags || []) {
          const tag = hashtag.toLowerCase();
          const existing = hashtagMap.get(tag) || {
            uses: 0,
            totalReach: 0,
            totalEngagement: 0,
            totalImpressions: 0,
            bestPost: null,
          };

          existing.uses += 1;

          for (const pub of content.publications) {
            if (!pub.metricsLatest) continue;
            existing.totalReach += pub.metricsLatest.reach || 0;
            existing.totalEngagement += pub.metricsLatest.engagement || 0;
            existing.totalImpressions += pub.metricsLatest.impressions || 0;

            const engRate = Number(pub.metricsLatest.engagementRate || 0);
            if (!existing.bestPost || engRate > existing.bestPost.engagementRate) {
              existing.bestPost = { contentId: content.id, engagementRate: engRate };
            }
          }

          hashtagMap.set(tag, existing);
        }
      }

      const hashtags = Array.from(hashtagMap.entries()).map(([tag, stats]) => ({
        hashtag: tag,
        uses: stats.uses,
        avgReach: stats.uses > 0 ? Math.round(stats.totalReach / stats.uses) : 0,
        avgEngagement: stats.uses > 0 ? Math.round(stats.totalEngagement / stats.uses) : 0,
        avgImpressions: stats.uses > 0 ? Math.round(stats.totalImpressions / stats.uses) : 0,
        bestPost: stats.bestPost,
      }));

      hashtags.sort((a, b) => b.avgEngagement - a.avgEngagement);
      return reply.send({ success: true, data: hashtags.slice(0, 50) });
    }
  );
};
