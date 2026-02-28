import type { FastifyInstance } from 'fastify';

import { assertBrandOwnershipIfAuthenticated, parseWindowDays, prisma } from './shared.js';

export function registerBrandAccountSeriesRoute(fastify: FastifyInstance) {
  fastify.get('/analytics/brands/:brandId/account/series', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
      await assertBrandOwnershipIfAuthenticated(request, brandId);

      const { window = '30d' } = request.query as { window?: '7d' | '30d' | '90d' };
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - parseWindowDays(window));

      const samples = await prisma.accountMetricSample.findMany({
        where: {
          socialAccount: { brandId },
          asOf: { gte: start, lte: end },
          period: 'day',
          metricName: { in: ['impressions', 'reach', 'profile_views'] as any },
        },
        orderBy: { asOf: 'asc' },
        select: { asOf: true, metricName: true, value: true },
      });

      const byDate: Record<string, { impressions: number; reach: number; profile_views: number }> =
        {};
      for (const sample of samples) {
        const date = sample.asOf.toISOString().split('T')[0];
        byDate[date] ||= { impressions: 0, reach: 0, profile_views: 0 };
        const value = Number(sample.value || 0);
        if ((sample.metricName as any) === 'impressions') {
          byDate[date].impressions += value;
        } else if ((sample.metricName as any) === 'reach') {
          byDate[date].reach += value;
        } else if ((sample.metricName as any) === 'profile_views') {
          byDate[date].profile_views += value;
        }
      }

      const series = Object.keys(byDate)
        .sort()
        .map((date) => ({ date, ...byDate[date] }));

      return reply.send({ success: true, data: { series } });
    } catch (error) {
      request.log.error({ error }, 'Failed to get account series');
      throw error;
    }
  });
}
