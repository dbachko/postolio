import { FastifyPluginAsync } from 'fastify';
import { suggestThemes } from '../services/theme-suggester.js';
import { assertBrandOwnership } from '../services/ownership.js';

const themeSuggestionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Params: { brandId: string };
    Querystring: { limit?: string };
  }>(
    '/:brandId/theme-suggestions',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;
      const { limit } = request.query || {};

      // Validate ownership (centralized invariant)
      await assertBrandOwnership(userId, brandId);

      try {
        const res = await suggestThemes({
          brandId,
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
