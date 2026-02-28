import type { FastifyInstance } from 'fastify';

import { calculateAccountHealthScore } from '../../../services/account-health-score.js';
import { resolveSocialAccountForUser } from './shared.js';

export function registerSocialAccountHealthRoute(fastify: FastifyInstance) {
  fastify.get(
    '/analytics/social-accounts/:socialAccountId/health',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { socialAccountId } = request.params as { socialAccountId: string };
      const { period = '30d' } = request.query as { period?: '7d' | '30d' | '90d' };

      await resolveSocialAccountForUser({ userId, socialAccountId });
      const healthScore = await calculateAccountHealthScore(socialAccountId, period);
      return reply.send({ success: true, data: healthScore });
    }
  );
}
