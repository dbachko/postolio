import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { aiInsightsService } from '../services/ai-insights.js';
import { getDatabaseClient } from '../config/database.js';

interface BrandParams {
  brandId: string;
}

interface InsightsQuery {
  days?: string;
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

const aiInsightsRoutes: FastifyPluginAsync = async function (fastify) {
  /**
   * GET /api/ai-insights/:brandId
   * Generate AI-powered insights for a brand
   */
  fastify.get<{ Params: BrandParams; Querystring: InsightsQuery }>(
    '/:brandId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const { brandId } = request.params;
        const { days } = request.query;

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

        // Generate insights
        const period = days ? parseInt(days) : 30;
        const report = await aiInsightsService.generateInsights(brandId, period);

        reply.send({
          success: true,
          data: report,
        });
      } catch (error: unknown) {
        fastify.log.error({ error }, 'Error generating AI insights');
        reply.code(500).send({
          error: 'Failed to generate insights',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * GET /api/ai-insights/:brandId/summary
   * Get a quick summary of insights without full details
   */
  fastify.get<{ Params: BrandParams }>(
    '/:brandId/summary',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;

        const { brandId } = request.params;

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

        // Generate insights and return only summary
        const report = await aiInsightsService.generateInsights(brandId, 30);

        reply.send({
          success: true,
          data: {
            summary: report.summary,
            topInsights: report.insights.slice(0, 3).map((insight) => ({
              id: insight.id,
              type: insight.type,
              priority: insight.priority,
              title: insight.title,
            })),
          },
        });
      } catch (error: unknown) {
        fastify.log.error({ error }, 'Error generating insights summary');
        reply.code(500).send({
          error: 'Failed to generate insights summary',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
};

export default aiInsightsRoutes;
