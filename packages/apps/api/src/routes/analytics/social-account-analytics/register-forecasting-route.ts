import type { FastifyInstance } from 'fastify';

import { forecastingService } from '../../../services/forecasting.js';
import { resolveSocialAccountForUser } from './shared.js';

export function registerSocialAccountForecastingRoute(fastify: FastifyInstance) {
  fastify.get(
    '/analytics/social-accounts/:socialAccountId/forecasting',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { socialAccountId } = request.params as { socialAccountId: string };
      const { days = '30', historical = '90' } = request.query as {
        days?: string;
        historical?: string;
      };

      const account = await resolveSocialAccountForUser({ userId, socialAccountId });
      const forecastDays = Math.max(7, parseInt(days, 10) || 30);
      const historicalDays = Math.max(30, parseInt(historical, 10) || 90);
      const report = await forecastingService.generateForecast(
        account.brandId,
        forecastDays,
        historicalDays,
        { socialAccountId }
      );

      return reply.send({ success: true, data: report });
    }
  );
}
