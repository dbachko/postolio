import type { FastifyInstance } from 'fastify';

import { calculateBrandHealthScore } from '../../../services/brand-health-score.js';
import { assertBrandOwnershipIfAuthenticated, parseWindowDays, prisma } from './shared.js';

type SummaryAggregate = {
  byPlatform: Record<
    string,
    { posts: number; impressions: number; engagement: number; reach: number }
  >;
  totalImpressions: number;
  totalEngagement: number;
  totalReach: number;
};

function resolveSummaryWindow(period: '7d' | '30d' | '90d') {
  const days = parseWindowDays(period);
  const now = new Date();
  const currentStart = new Date();
  currentStart.setDate(now.getDate() - days);
  const previousStart = new Date();
  previousStart.setDate(previousStart.getDate() - days * 2);
  return { days, now, currentStart, previousStart };
}

function aggregatePublicationMetrics(
  pubs: Array<{ platform: string; metricsLatest: any }>
): SummaryAggregate {
  const byPlatform: SummaryAggregate['byPlatform'] = {};
  let totalImpressions = 0;
  let totalEngagement = 0;
  let totalReach = 0;

  for (const publication of pubs) {
    const metrics = publication.metricsLatest;
    if (!metrics) {
      continue;
    }
    byPlatform[publication.platform] ||= {
      posts: 0,
      impressions: 0,
      engagement: 0,
      reach: 0,
    };
    byPlatform[publication.platform].posts += 1;
    byPlatform[publication.platform].impressions += metrics.impressions || 0;
    byPlatform[publication.platform].engagement += metrics.engagement || 0;
    byPlatform[publication.platform].reach += metrics.reach || 0;
    totalImpressions += metrics.impressions || 0;
    totalEngagement += metrics.engagement || 0;
    totalReach += metrics.reach || 0;
  }

  return { byPlatform, totalImpressions, totalEngagement, totalReach };
}

async function fallbackAggregateFromAccountSamples(params: {
  brandId: string;
  currentStart: Date;
  now: Date;
  totalImpressions: number;
  totalReach: number;
}) {
  if (params.totalImpressions > 0 && params.totalReach > 0) {
    return {
      totalImpressions: params.totalImpressions,
      totalReach: params.totalReach,
    };
  }

  const samples = await prisma.accountMetricSample.findMany({
    where: {
      socialAccount: { brandId: params.brandId },
      asOf: { gte: params.currentStart, lte: params.now },
      period: 'day',
      metricName: { in: ['impressions', 'reach'] as any },
    },
    select: { metricName: true, value: true },
  });

  let seriesImpressions = 0;
  let seriesReach = 0;
  for (const sample of samples) {
    const value = Number(sample.value || 0);
    if ((sample.metricName as any) === 'impressions') {
      seriesImpressions += value;
    }
    if ((sample.metricName as any) === 'reach') {
      seriesReach += value;
    }
  }

  return {
    totalImpressions: params.totalImpressions || seriesImpressions,
    totalReach: params.totalReach || seriesReach,
  };
}

async function loadPreviousPeriodTotals(params: {
  brandId: string;
  previousStart: Date;
  currentStart: Date;
}) {
  const previousPubs = await prisma.contentPublication.findMany({
    where: {
      content: { brandId: params.brandId },
      publishedAt: { gte: params.previousStart, lt: params.currentStart },
    },
    select: { metricsLatest: true },
  });

  let prevImpressions = 0;
  let prevEngagement = 0;
  let prevReach = 0;
  for (const publication of previousPubs) {
    const metrics = publication.metricsLatest;
    if (!metrics) {
      continue;
    }
    prevImpressions += metrics.impressions || 0;
    prevEngagement += metrics.engagement || 0;
    prevReach += metrics.reach || 0;
  }

  return { prevImpressions, prevEngagement, prevReach };
}

function calculatePercentChange(current: number, previous: number) {
  if (previous <= 0) {
    return 0;
  }
  return ((current - previous) / previous) * 100;
}

export function registerBrandSummaryRoute(fastify: FastifyInstance) {
  fastify.get('/analytics/brands/:brandId/summary', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
      await assertBrandOwnershipIfAuthenticated(request, brandId);
      const { period = '30d' } = request.query as { period?: '7d' | '30d' | '90d' };

      const window = resolveSummaryWindow(period);
      const pubs = await prisma.contentPublication.findMany({
        where: { content: { brandId }, publishedAt: { gte: window.currentStart, lte: window.now } },
        select: { id: true, platform: true, metricsLatest: true, publishedAt: true },
      });

      const current = aggregatePublicationMetrics(pubs);
      const fallback = await fallbackAggregateFromAccountSamples({
        brandId,
        currentStart: window.currentStart,
        now: window.now,
        totalImpressions: current.totalImpressions,
        totalReach: current.totalReach,
      });
      const healthScore = await calculateBrandHealthScore(brandId, period);
      const previous = await loadPreviousPeriodTotals({
        brandId,
        previousStart: window.previousStart,
        currentStart: window.currentStart,
      });

      const averageEngagementRate =
        fallback.totalImpressions > 0
          ? (current.totalEngagement / fallback.totalImpressions) * 100
          : 0;
      const prevEngagementRate =
        previous.prevImpressions > 0
          ? (previous.prevEngagement / previous.prevImpressions) * 100
          : 0;

      return reply.send({
        success: true,
        data: {
          totalPosts: pubs.length,
          totalImpressions: fallback.totalImpressions,
          totalEngagement: current.totalEngagement,
          reach: fallback.totalReach,
          averageEngagementRate,
          breakdown: current.byPlatform,
          healthScore,
          previousPeriodComparison: {
            impressions: {
              current: fallback.totalImpressions,
              previous: previous.prevImpressions,
              change: calculatePercentChange(fallback.totalImpressions, previous.prevImpressions),
            },
            reach: {
              current: fallback.totalReach,
              previous: previous.prevReach,
              change: calculatePercentChange(fallback.totalReach, previous.prevReach),
            },
            engagement: {
              current: current.totalEngagement,
              previous: previous.prevEngagement,
              change: calculatePercentChange(current.totalEngagement, previous.prevEngagement),
            },
            engagementRate: {
              current: averageEngagementRate,
              previous: prevEngagementRate,
              change: calculatePercentChange(averageEngagementRate, prevEngagementRate),
            },
          },
        },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to get brand summary');
      throw error;
    }
  });
}
