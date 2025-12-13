import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../../config/database.js';
import { campaignAnalyticsService } from '../../services/campaign-analytics.js';

const prisma = getDatabaseClient();

export const campaignAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  // Campaign aggregates by platform
  fastify.get(
    '/analytics/campaigns/:campaignId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const { campaignId } = request.params as { campaignId: string };
        const contents = await prisma.content.findMany({
          where: { campaignId },
          select: { id: true },
        });
        if (!contents.length) return reply.send({ success: true, data: { totalPosts: 0 } });
        const contentIds = contents.map((c) => c.id);
        const pubs = await prisma.contentPublication.findMany({
          where: { contentId: { in: contentIds } },
          select: { id: true, platform: true, metricsLatest: true },
        });
        const byPlatform: Record<string, any> = {};
        let totalImpressions = 0;
        let totalEngagement = 0;
        let totalReach = 0;
        for (const p of pubs) {
          const m = p.metricsLatest;
          if (!m) continue;
          const key = p.platform;
          byPlatform[key] ||= { posts: 0, impressions: 0, engagement: 0, reach: 0 };
          byPlatform[key].posts += 1;
          byPlatform[key].impressions += m.impressions || 0;
          byPlatform[key].engagement += m.engagement || 0;
          byPlatform[key].reach += m.reach || 0;
          totalImpressions += m.impressions || 0;
          totalEngagement += m.engagement || 0;
          totalReach += m.reach || 0;
        }
        const averageEngagementRate =
          totalImpressions > 0 ? (totalEngagement / totalImpressions) * 100 : 0;
        return reply.send({
          success: true,
          data: {
            totalPosts: pubs.length,
            totalImpressions,
            totalEngagement,
            reach: totalReach,
            averageEngagementRate,
            breakdown: byPlatform,
          },
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to get campaign aggregates');
        throw error;
      }
    }
  );

  // Campaign-level detailed metrics (legacy-compatible shape, v2 path)
  fastify.get(
    '/analytics/campaigns/:campaignId/metrics',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const { campaignId } = request.params as { campaignId: string };
        const userId = (request.user as { id: string }).id;

        const metrics = await campaignAnalyticsService.getCampaignMetrics(campaignId, userId);

        return reply.send({
          success: true,
          data: metrics,
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to get campaign metrics (analytics v2)');
        throw error;
      }
    }
  );

  // Campaign optimization recommendations (v2 path)
  fastify.get(
    '/analytics/campaigns/:campaignId/recommendations',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const { campaignId } = request.params as { campaignId: string };
        const userId = (request.user as { id: string }).id;

        const recommendations = await campaignAnalyticsService.getOptimizationRecommendations(
          campaignId,
          userId
        );

        return reply.send({
          success: true,
          data: recommendations,
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to get campaign recommendations (analytics v2)');
        throw error;
      }
    }
  );

  // Campaign ROI metrics (v2 path)
  fastify.get(
    '/analytics/campaigns/:campaignId/roi',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const { campaignId } = request.params as { campaignId: string };
        const userId = (request.user as { id: string }).id;

        const roi = await campaignAnalyticsService.calculateROI(campaignId, userId);

        return reply.send({
          success: true,
          data: roi,
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to get campaign ROI (analytics v2)');
        throw error;
      }
    }
  );
};
