import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { forecastingService } from '../services/forecasting.js';
import { assertBrandOwnership } from '../services/ownership.js';

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

        await assertBrandOwnership(request.user.id, brandId);

        // Generate forecast
        const forecastDays = days ? parseInt(days) : 30;
        const historicalDays = historical ? parseInt(historical) : 90;

        const forecast = await forecastingService.generateForecast(
          brandId,
          forecastDays,
          historicalDays
        );

        return reply.send({
          success: true,
          data: forecast,
        });
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Error generating forecast');
        throw error;
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

        // Generate campaign forecast (service is responsible for ownership checks)
        const prediction = await forecastingService.predictCampaignPerformance(campaignId);

        return reply.send({
          success: true,
          data: prediction,
        });
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Error predicting campaign performance');
        throw error;
      }
    }
  );
};

export default forecastingRoutes;
