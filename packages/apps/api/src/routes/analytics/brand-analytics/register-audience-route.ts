import type { FastifyInstance } from 'fastify';

import { instagramService } from '../../../services/instagram.js';
import { assertBrandOwnershipIfAuthenticated, prisma } from './shared.js';

function buildFollowerTimeline(samples: Array<{ asOf: Date; value: unknown }>) {
  return samples.map((sample) => ({
    date: sample.asOf.toISOString().split('T')[0],
    followers: Number(sample.value),
  }));
}

function buildActivityMaps(publications: Array<{ publishedAt: Date | null; metricsLatest: any }>) {
  const activityMap: number[][] = Array(7)
    .fill(0)
    .map(() => Array(24).fill(0));
  const countMap: number[][] = Array(7)
    .fill(0)
    .map(() => Array(24).fill(0));

  for (const publication of publications) {
    if (!publication.publishedAt || !publication.metricsLatest) {
      continue;
    }
    const date = new Date(publication.publishedAt);
    const day = date.getDay();
    const hour = date.getHours();
    const engagement = Number(publication.metricsLatest.engagement || 0);
    activityMap[day][hour] += engagement;
    countMap[day][hour] += 1;
  }

  return { activityMap, countMap };
}

function buildHeatmap(activityMap: number[][], countMap: number[][]) {
  return activityMap.map((dayData, day) =>
    dayData.map((totalEngagement, hour) => {
      const count = countMap[day][hour];
      return count > 0 ? Math.round(totalEngagement / count) : 0;
    })
  );
}

function buildBestPostingTimes(heatmap: number[][], countMap: number[][]) {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const bestTimes: Array<{ day: number; hour: number; avgEngagement: number }> = [];

  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      if (countMap[day][hour] > 0) {
        bestTimes.push({ day, hour, avgEngagement: heatmap[day][hour] });
      }
    }
  }
  bestTimes.sort((left, right) => right.avgEngagement - left.avgEngagement);

  return bestTimes.slice(0, 5).map((entry) => ({
    day: entry.day,
    dayName: dayNames[entry.day],
    hour: entry.hour,
    timeFormatted: `${entry.hour}:00`,
    avgEngagement: entry.avgEngagement,
  }));
}

function buildFollowerGrowth(
  totalFollowers: number,
  followerTimeline: Array<{ followers: number }>
) {
  const firstFollowerCount = followerTimeline[0]?.followers || totalFollowers;
  const followerGrowth = totalFollowers - firstFollowerCount;
  const followerGrowthRate =
    firstFollowerCount > 0 ? ((followerGrowth / firstFollowerCount) * 100).toFixed(1) : '0.0';

  return {
    current: totalFollowers,
    change: followerGrowth,
    changeRate: followerGrowthRate,
    timeline: followerTimeline,
  };
}

export function registerBrandAudienceRoute(fastify: FastifyInstance) {
  fastify.get('/analytics/brands/:brandId/audience', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
      await assertBrandOwnershipIfAuthenticated(request, brandId);

      const accounts = await prisma.socialAccount.findMany({
        where: { brandId },
        include: { accountMetricsLatest: true },
      });

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const followerSamples = await prisma.accountMetricSample.findMany({
        where: {
          socialAccount: { brandId },
          metricName: 'followers',
          asOf: { gte: startDate },
        },
        orderBy: { asOf: 'asc' },
        select: { asOf: true, value: true },
      });
      const followerTimeline = buildFollowerTimeline(followerSamples);

      const publications = await prisma.contentPublication.findMany({
        where: { content: { brandId }, publishedAt: { not: null } },
        select: { publishedAt: true, metricsLatest: true },
      });
      const { activityMap, countMap } = buildActivityMaps(publications);
      const heatmap = buildHeatmap(activityMap, countMap);
      const bestPostingTimes = buildBestPostingTimes(heatmap, countMap);

      const totalFollowers = accounts.reduce(
        (sum, account) => sum + (account.accountMetricsLatest?.followers || 0),
        0
      );
      const followerGrowth = buildFollowerGrowth(totalFollowers, followerTimeline);
      const demographicsResult = await instagramService.getAudienceDemographics(brandId);

      return reply.send({
        success: true,
        data: {
          demographics: demographicsResult.demographics || null,
          demographicsStatus: demographicsResult.status,
          demographicsError: demographicsResult.errorMessage || null,
          activityHeatmap: heatmap,
          bestPostingTimes,
          followerGrowth,
        },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to get audience insights');
      throw error;
    }
  });
}
