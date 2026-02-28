import type { FastifyInstance } from 'fastify';

import {
  computeEngagementRate,
  periodToDays,
  prisma,
  resolveSocialAccountForUser,
} from './shared.js';

function percentChange(current: number, previous: number) {
  return previous > 0 ? ((current - previous) / previous) * 100 : 0;
}

async function loadPeriodPublicationTotals(params: {
  socialAccountId: string;
  start: Date;
  end: Date;
}) {
  const publications = await prisma.contentPublication.findMany({
    where: {
      socialAccountId: params.socialAccountId,
      publishedAt: { gte: params.start, lte: params.end },
    },
    select: { metricsLatest: true },
  });

  let totalImpressions = 0;
  let totalReach = 0;
  let totalEngagement = 0;
  for (const publication of publications) {
    const metrics = publication.metricsLatest;
    if (!metrics) {
      continue;
    }
    totalImpressions += metrics.impressions || 0;
    totalReach += metrics.reach || 0;
    totalEngagement += metrics.engagement || 0;
  }

  return {
    publications,
    totalImpressions,
    totalReach,
    totalEngagement,
    averageEngagementRate: computeEngagementRate(totalEngagement, totalImpressions, totalReach),
  };
}

export function registerSocialAccountSummaryRoute(fastify: FastifyInstance) {
  fastify.get(
    '/analytics/social-accounts/:socialAccountId/summary',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { socialAccountId } = request.params as { socialAccountId: string };
      const { period = '30d' } = request.query as { period?: '7d' | '30d' | '90d' };

      const account = await resolveSocialAccountForUser({ userId, socialAccountId });
      const days = periodToDays(period);
      const now = new Date();
      const currentStart = new Date();
      currentStart.setDate(now.getDate() - days);
      const previousStart = new Date();
      previousStart.setDate(previousStart.getDate() - days * 2);

      const current = await loadPeriodPublicationTotals({
        socialAccountId,
        start: currentStart,
        end: now,
      });
      const previous = await loadPeriodPublicationTotals({
        socialAccountId,
        start: previousStart,
        end: currentStart,
      });

      return reply.send({
        success: true,
        data: {
          account,
          period,
          totalPosts: current.publications.length,
          totalImpressions: current.totalImpressions,
          totalReach: current.totalReach,
          totalEngagement: current.totalEngagement,
          averageEngagementRate: current.averageEngagementRate,
          previousPeriodComparison: {
            totalPosts: {
              current: current.publications.length,
              previous: previous.publications.length,
              change: percentChange(current.publications.length, previous.publications.length),
            },
            impressions: {
              current: current.totalImpressions,
              previous: previous.totalImpressions,
              change: percentChange(current.totalImpressions, previous.totalImpressions),
            },
            reach: {
              current: current.totalReach,
              previous: previous.totalReach,
              change: percentChange(current.totalReach, previous.totalReach),
            },
            engagement: {
              current: current.totalEngagement,
              previous: previous.totalEngagement,
              change: percentChange(current.totalEngagement, previous.totalEngagement),
            },
            engagementRate: {
              current: current.averageEngagementRate,
              previous: previous.averageEngagementRate,
              change: percentChange(current.averageEngagementRate, previous.averageEngagementRate),
            },
          },
        },
      });
    }
  );
}
