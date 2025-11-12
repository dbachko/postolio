import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { forecastingService } from '../services/forecasting.js';
import { getDatabaseClient } from '../config/database.js';

interface BrandParams {
  brandId: string;
}

interface CampaignParams {
  campaignId: string;
}

interface ForecastQuery {
  days?: string;
  historical?: string;
}

function ensureAuth(
  request: FastifyRequest,
  reply: FastifyReply
): request is FastifyRequest & { user: { id: string; email: string } } {
  if (!request.user || !request.user.id) {
    reply.code(401).send({ error: 'Authentication required' });
    return false;
  }
  return true;
}

const forecastingRoutes: FastifyPluginAsync = async function (fastify) {
  /**
   * GET /api/forecasting/:brandId
   * Generate performance forecasts for a brand
   */
  fastify.get<{ Params: BrandParams; Querystring: ForecastQuery }>(
    '/:brandId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const { brandId } = request.params;
        const { days, historical } = request.query;

        // Verify brand ownership
        const brand = await getDatabaseClient().brand.findFirst({
          where: {
            id: brandId,
            userId: request.user.id,
          },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        // Generate forecast
        const forecastDays = days ? parseInt(days) : 30;
        const historicalDays = historical ? parseInt(historical) : 90;

        const forecast = await forecastingService.generateForecast(
          brandId,
          forecastDays,
          historicalDays
        );

        reply.send({
          success: true,
          data: forecast,
        });
      } catch (error: unknown) {
        fastify.log.error({ error }, 'Error generating forecast');
        reply.code(500).send({
          error: 'Failed to generate forecast',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * GET /api/forecasting/campaign/:campaignId
   * Predict campaign performance
   */
  fastify.get<{ Params: CampaignParams }>(
    '/campaign/:campaignId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const { campaignId } = request.params;

        // Get campaign and verify ownership
        const campaign = await getDatabaseClient().campaign.findFirst({
          where: { id: campaignId },
          include: { brand: true },
        });

        if (!campaign) {
          return reply.code(404).send({ error: 'Campaign not found' });
        }

        if (campaign.brand.userId !== request.user.id) {
          return reply.code(403).send({ error: 'Not authorized' });
        }

        // Generate campaign forecast
        const prediction = await forecastingService.predictCampaignPerformance(
          campaignId,
          campaign.brandId
        );

        reply.send({
          success: true,
          data: prediction,
        });
      } catch (error: unknown) {
        fastify.log.error({ error }, 'Error predicting campaign performance');
        reply.code(500).send({
          error: 'Failed to predict campaign performance',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
};

export default forecastingRoutes;
