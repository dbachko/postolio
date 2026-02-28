import type { FastifyInstance } from 'fastify';

import { prisma, resolveSocialAccountForUser, windowToDays } from './shared.js';

function parseMetricList(metrics: string | undefined) {
  return (metrics || 'impressions,reach,profile_views,followers')
    .split(',')
    .map((metric) => metric.trim())
    .filter(Boolean);
}

function pushSample(
  store: Record<string, Record<string, number>>,
  date: string,
  name: string,
  value: number
) {
  store[date] ||= {};
  store[date][name] = (store[date][name] || 0) + value;
}

async function buildSeriesFromPublications(params: {
  socialAccountId: string;
  start: Date;
  end: Date;
  metricList: string[];
  byDate: Record<string, Record<string, number>>;
}) {
  const publications = await prisma.contentPublication.findMany({
    where: {
      socialAccountId: params.socialAccountId,
      publishedAt: { gte: params.start, lte: params.end },
    },
    select: { publishedAt: true, metricsLatest: true },
  });

  for (const publication of publications) {
    if (!publication.publishedAt || !publication.metricsLatest) {
      continue;
    }
    const date = publication.publishedAt.toISOString().split('T')[0];
    const metrics = publication.metricsLatest;
    if (params.metricList.includes('impressions')) {
      pushSample(params.byDate, date, 'impressions', metrics.impressions || 0);
    }
    if (params.metricList.includes('reach')) {
      pushSample(params.byDate, date, 'reach', metrics.reach || 0);
    }
    if (params.metricList.includes('profile_views')) {
      pushSample(params.byDate, date, 'profile_views', (metrics as any).profileViews || 0);
    }
  }
}

export function registerSocialAccountSeriesRoute(fastify: FastifyInstance) {
  fastify.get(
    '/analytics/social-accounts/:socialAccountId/series',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { socialAccountId } = request.params as { socialAccountId: string };
      const { window = '30d', metrics } = request.query as {
        window?: '7d' | '30d' | '90d';
        metrics?: string;
      };

      await resolveSocialAccountForUser({ userId, socialAccountId });
      const days = windowToDays(window);
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - days);
      const metricList = parseMetricList(metrics);

      const samples = await prisma.accountMetricSample.findMany({
        where: {
          socialAccountId,
          asOf: { gte: start, lte: end },
          period: 'day',
          metricName: { in: metricList as any },
        },
        orderBy: { asOf: 'asc' },
        select: { asOf: true, metricName: true, value: true },
      });

      const byDate: Record<string, Record<string, number>> = {};
      if (samples.length > 0) {
        for (const sample of samples) {
          const date = sample.asOf.toISOString().split('T')[0];
          pushSample(byDate, date, String(sample.metricName), Number(sample.value || 0));
        }
      } else {
        await buildSeriesFromPublications({
          socialAccountId,
          start,
          end,
          metricList,
          byDate,
        });
      }

      const series = Object.keys(byDate)
        .sort()
        .map((date) => ({ date, metrics: byDate[date] }));

      return reply.send({ success: true, data: { window, metrics: metricList, series } });
    }
  );
}
