import type { FastifyInstance } from 'fastify';

import { recommendationEngine, resolveSocialAccountForUser } from './shared.js';

export function registerSocialAccountRecommendationsRoute(fastify: FastifyInstance) {
  fastify.get(
    '/analytics/social-accounts/:socialAccountId/recommendations',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { socialAccountId } = request.params as { socialAccountId: string };
      const { days = '90' } = request.query as { days?: string };

      const account = await resolveSocialAccountForUser({ userId, socialAccountId });
      const report = await recommendationEngine.generateRecommendations(
        account.brandId,
        Math.max(7, parseInt(days, 10) || 90),
        { socialAccountId }
      );

      return reply.send({ success: true, data: report });
    }
  );
}
