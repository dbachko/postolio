import { FastifyPluginAsync } from 'fastify';
import { suggestThemes, type CampaignType } from '../services/theme-suggester.js';
import { assertBrandOwnership } from '../services/ownership.js';

const themeSuggestionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Params: { brandId: string };
    Querystring: { campaignType?: CampaignType; goals?: string; limit?: string };
  }>(
    '/:brandId/theme-suggestions',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;
      const { campaignType, goals, limit } = request.query || {};

      // Validate ownership (centralized invariant)
      await assertBrandOwnership(userId, brandId);

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
        throw e;
      }
    }
  );
};

export default themeSuggestionRoutes;
