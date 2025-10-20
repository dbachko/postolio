import { FastifyPluginAsync } from 'fastify';
import { campaignAnalyticsService } from '../services/campaign-analytics.js';
import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

interface CampaignMetricsParams {
  campaignId: string;
}
interface CampaignMetricsQuery {
  timeRange?: '7d' | '30d' | '90d';
}

interface OptimizationParams {
  campaignId: string;
}

interface ROIParams {
  campaignId: string;
}

const campaignAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get campaign performance metrics
  fastify.get<{
    Params: CampaignMetricsParams;
    Querystring: CampaignMetricsQuery;
  }>(
    '/campaigns/:campaignId/analytics',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { campaignId } = request.params;

        const metrics = await campaignAnalyticsService.getCampaignMetrics(campaignId, userId);

        reply.send({
          success: true,
          data: metrics,
          lastUpdated: new Date().toISOString(),
          fromCache: false,
        });
      } catch (error) {
        console.error('Get campaign metrics error:', error);
        reply.status(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get campaign metrics',
        });
      }
    }
  );

  // Get optimization recommendations
  fastify.get<{ Params: OptimizationParams }>(
    '/campaigns/:campaignId/analytics/recommendations',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { campaignId } = request.params;

        const recommendations = await campaignAnalyticsService.getOptimizationRecommendations(
          campaignId,
          userId
        );

        reply.send({
          success: true,
          data: recommendations,
          count: recommendations.length,
          lastUpdated: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Get optimization recommendations error:', error);
        reply.status(500).send({
          success: false,
          error:
            error instanceof Error ? error.message : 'Failed to get optimization recommendations',
        });
      }
    }
  );

  // Calculate campaign ROI
  fastify.get<{ Params: ROIParams }>(
    '/campaigns/:campaignId/analytics/roi',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { campaignId } = request.params;

        const roi = await campaignAnalyticsService.calculateROI(campaignId, userId);

        reply.send({
          success: true,
          data: roi,
          lastUpdated: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Calculate ROI error:', error);
        reply.status(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to calculate ROI',
        });
      }
    }
  );

  // Get analytics summary for all campaigns of a brand
  fastify.get<{ Params: { brandId: string } }>(
    '/brands/:brandId/analytics/summary',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { brandId } = request.params;

        // Get all campaigns for the brand
        const campaigns = await prisma.campaign.findMany({
          where: {
            brandId,
            brand: { userId },
            status: { in: ['active', 'completed'] },
          },
          select: { id: true, name: true, status: true },
        });

        if (campaigns.length === 0) {
          reply.send({
            success: true,
            data: {
              totalCampaigns: 0,
              summary: {
                totalPosts: 0,
                totalImpressions: 0,
                totalEngagement: 0,
                averageEngagementRate: 0,
              },
              topPerformingCampaign: null,
            },
          });
          return;
        }

        // Get metrics for all campaigns
        const campaignMetrics = [];
        let bestPerformingCampaign = null;
        let bestEngagementRate = 0;

        for (const campaign of campaigns) {
          try {
            const metrics = await campaignAnalyticsService.getCampaignMetrics(campaign.id, userId);
            campaignMetrics.push({
              campaignId: campaign.id,
              campaignName: campaign.name,
              metrics,
            });

            if (metrics.averageEngagementRate > bestEngagementRate) {
              bestEngagementRate = metrics.averageEngagementRate;
              bestPerformingCampaign = {
                id: campaign.id,
                name: campaign.name,
                engagementRate: metrics.averageEngagementRate,
              };
            }
          } catch (error) {
            console.warn(`Failed to get metrics for campaign ${campaign.id}:`, error);
          }
        }

        // Calculate summary
        const summary = campaignMetrics.reduce(
          (acc, { metrics }) => ({
            totalPosts: acc.totalPosts + metrics.totalPosts,
            totalImpressions: acc.totalImpressions + metrics.totalImpressions,
            totalEngagement: acc.totalEngagement + metrics.totalEngagement,
            averageEngagementRate: acc.averageEngagementRate + metrics.averageEngagementRate,
          }),
          {
            totalPosts: 0,
            totalImpressions: 0,
            totalEngagement: 0,
            averageEngagementRate: 0,
          }
        );

        summary.averageEngagementRate =
          campaignMetrics.length > 0 ? summary.averageEngagementRate / campaignMetrics.length : 0;

        reply.send({
          success: true,
          data: {
            totalCampaigns: campaigns.length,
            summary,
            topPerformingCampaign: bestPerformingCampaign,
            campaignBreakdown: campaignMetrics,
          },
          lastUpdated: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Get brand analytics summary error:', error);
        reply.status(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get brand analytics summary',
        });
      }
    }
  );

  // No legacy paths; use only RESTful endpoints above
};

export default campaignAnalyticsRoutes;
