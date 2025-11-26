import { FastifyInstance } from 'fastify';
import { RecommendationEngine } from '../services/recommendations.js';

const recommendationEngine = new RecommendationEngine();

export default async function recommendationsRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/recommendations/:brandId
   * Get comprehensive recommendations for a brand
   */
  fastify.get<{
    Params: { brandId: string };
    Querystring: { days?: string };
  }>('/:brandId', async (request, reply) => {
    try {
      const { brandId } = request.params;
      const days = request.query.days ? parseInt(request.query.days) : 90;

      // Validate days parameter
      if (isNaN(days) || days < 7 || days > 365) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid days parameter. Must be between 7 and 365.',
        });
      }

      const report = await recommendationEngine.generateRecommendations(brandId, days);

      return reply.send({
        success: true,
        data: report,
      });
    } catch (error: any) {
      fastify.log.error('Failed to generate recommendations:', error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to generate recommendations',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/recommendations/:brandId/posting-times
   * Get only posting time recommendations
   */
  fastify.get<{
    Params: { brandId: string };
    Querystring: { days?: string };
  }>('/:brandId/posting-times', async (request, reply) => {
    try {
      const { brandId } = request.params;
      const days = request.query.days ? parseInt(request.query.days) : 90;

      const report = await recommendationEngine.generateRecommendations(brandId, days);

      return reply.send({
        success: true,
        data: {
          postingTimes: report.postingTimes,
          generatedAt: report.generatedAt,
        },
      });
    } catch (error: any) {
      fastify.log.error('Failed to generate posting time recommendations:', error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to generate posting time recommendations',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/recommendations/:brandId/content
   * Get only content optimization recommendations
   */
  fastify.get<{
    Params: { brandId: string };
    Querystring: { days?: string };
  }>('/:brandId/content', async (request, reply) => {
    try {
      const { brandId } = request.params;
      const days = request.query.days ? parseInt(request.query.days) : 90;

      const report = await recommendationEngine.generateRecommendations(brandId, days);

      return reply.send({
        success: true,
        data: {
          contentOptimizations: report.contentOptimizations,
          summary: report.summary,
          generatedAt: report.generatedAt,
        },
      });
    } catch (error: any) {
      fastify.log.error('Failed to generate content recommendations:', error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to generate content recommendations',
        message: error.message,
      });
    }
  });
}
