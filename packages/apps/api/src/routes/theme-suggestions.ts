import { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import { suggestThemes, type CampaignType } from '../services/theme-suggester.js';

const prisma = getDatabaseClient();

const themeSuggestionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Params: { brandId: string };
    Querystring: { campaignType?: CampaignType; goals?: string; limit?: string };
  }>(
    '/:brandId/theme-suggestions',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const { campaignType, goals, limit } = request.query || {};

      // Validate ownership
      const brand = await prisma.brand.findFirst({
        where: { id: brandId, userId: request.user!.id },
      });
      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      try {
        const res = await suggestThemes({
          brandId,
          campaignType: (campaignType || null) as CampaignType | null,
          goals: goals || null,
          limit: limit ? Number(limit) : 8,
        });
        return reply.send(res);
      } catch (e) {
        request.log.error({ err: e }, 'Failed to suggest themes');
        return reply.code(500).send({ error: 'Failed to suggest themes' });
      }
    }
  );
};

export default themeSuggestionRoutes;
