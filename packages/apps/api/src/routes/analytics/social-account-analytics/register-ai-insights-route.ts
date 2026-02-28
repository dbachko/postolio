import type { FastifyInstance } from 'fastify';

import { aiInsightsService } from '../../../services/ai-insights.js';
import { resolveSocialAccountForUser } from './shared.js';

export function registerSocialAccountAiInsightsRoute(fastify: FastifyInstance) {
  fastify.get(
    '/analytics/social-accounts/:socialAccountId/ai-insights',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { socialAccountId } = request.params as { socialAccountId: string };
      const { days = '30' } = request.query as { days?: string };

      const account = await resolveSocialAccountForUser({ userId, socialAccountId });
      const report = await aiInsightsService.generateInsights(
        account.brandId,
        Math.max(1, parseInt(days, 10) || 30),
        { socialAccountId }
      );

      return reply.send({ success: true, data: report });
    }
  );
}
