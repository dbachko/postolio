import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../../config/database.js';
import { getRedisClient } from '../../services/redis.js';
import { assertBrandOwnership } from '../../services/ownership.js';
import { getAssetsClient } from '../../services/assets-media.js';
import { aiInsightsService } from '../../services/ai-insights.js';
import { forecastingService } from '../../services/forecasting.js';
import { RecommendationEngine } from '../../services/recommendations.js';
import { calculateAccountHealthScore } from '../../services/account-health-score.js';

const prisma = getDatabaseClient();
const recommendationEngine = new RecommendationEngine();

function periodToDays(period: string | undefined): number {
  if (period === '7d') return 7;
  if (period === '90d') return 90;
  return 30;
}

function windowToDays(window: string | undefined): number {
  if (window === '7d') return 7;
  if (window === '90d') return 90;
  return 30;
}

async function resolveSocialAccountForUser(params: {
  userId: string;
  socialAccountId: string;
}): Promise<{
  id: string;
  brandId: string;
  platform: string;
  externalAccountId: string;
  externalPageId: string | null;
  username: string | null;
  displayName: string | null;
  profilePictureUrl: string | null;
}> {
  const { userId, socialAccountId } = params;
  const sa = await prisma.socialAccount.findUnique({
    where: { id: socialAccountId },
    select: {
      id: true,
      brandId: true,
      platform: true,
      externalAccountId: true,
      externalPageId: true,
      username: true,
      displayName: true,
      metadata: true,
      brand: { select: { userId: true } },
    },
  });

  if (!sa || sa.brand.userId !== userId) {
    throw Object.assign(new Error('social_account_not_found'), { statusCode: 404 });
  }

  await assertBrandOwnership(userId, sa.brandId);

  const meta = (sa.metadata || {}) as Record<string, unknown>;
  const profileData =
    meta.profileData && typeof meta.profileData === 'object' && !Array.isArray(meta.profileData)
      ? (meta.profileData as Record<string, unknown>)
      : null;
  const profilePictureUrl = (() => {
    const direct = meta.profile_picture_url;
    if (typeof direct === 'string' && direct) return direct;
    const nested = profileData?.profile_picture_url;
    if (typeof nested === 'string' && nested) return nested;
    return null;
  })();

  return {
    id: sa.id,
    brandId: sa.brandId,
    platform: String(sa.platform),
    externalAccountId: sa.externalAccountId,
    externalPageId: sa.externalPageId ?? null,
    username: sa.username ?? null,
    displayName: sa.displayName ?? null,
    profilePictureUrl,
  };
}

function computeEngagementRate(
  totalEngagement: number,
  totalImpressions: number,
  totalReach: number
) {
  const denom = totalImpressions > 0 ? totalImpressions : totalReach > 0 ? totalReach : 0;
  return denom > 0 ? (totalEngagement / denom) * 100 : 0;
}

export const socialAccountAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/analytics/social-accounts/:socialAccountId/summary?period=30d
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

      const pubs = await prisma.contentPublication.findMany({
        where: { socialAccountId, publishedAt: { gte: currentStart, lte: now } },
        select: { metricsLatest: true },
      });

      let totalImpressions = 0;
      let totalReach = 0;
      let totalEngagement = 0;

      for (const p of pubs) {
        const m = p.metricsLatest;
        if (!m) continue;
        totalImpressions += m.impressions || 0;
        totalReach += m.reach || 0;
        totalEngagement += m.engagement || 0;
      }

      const averageEngagementRate = computeEngagementRate(
        totalEngagement,
        totalImpressions,
        totalReach
      );

      // Previous period comparisons
      const previousStart = new Date();
      previousStart.setDate(previousStart.getDate() - days * 2);

      const previousPubs = await prisma.contentPublication.findMany({
        where: { socialAccountId, publishedAt: { gte: previousStart, lt: currentStart } },
        select: { metricsLatest: true },
      });

      let prevImpressions = 0;
      let prevReach = 0;
      let prevEngagement = 0;
      for (const p of previousPubs) {
        const m = p.metricsLatest;
        if (!m) continue;
        prevImpressions += m.impressions || 0;
        prevReach += m.reach || 0;
        prevEngagement += m.engagement || 0;
      }
      const prevEngagementRate = computeEngagementRate(prevEngagement, prevImpressions, prevReach);

      const pct = (current: number, previous: number) =>
        previous > 0 ? ((current - previous) / previous) * 100 : 0;

      const postsCurrent = pubs.length;
      const postsPrevious = previousPubs.length;

      return reply.send({
        success: true,
        data: {
          account,
          period,
          totalPosts: postsCurrent,
          totalImpressions,
          totalReach,
          totalEngagement,
          averageEngagementRate,
          previousPeriodComparison: {
            totalPosts: {
              current: postsCurrent,
              previous: postsPrevious,
              change: pct(postsCurrent, postsPrevious),
            },
            impressions: {
              current: totalImpressions,
              previous: prevImpressions,
              change: pct(totalImpressions, prevImpressions),
            },
            reach: { current: totalReach, previous: prevReach, change: pct(totalReach, prevReach) },
            engagement: {
              current: totalEngagement,
              previous: prevEngagement,
              change: pct(totalEngagement, prevEngagement),
            },
            engagementRate: {
              current: averageEngagementRate,
              previous: prevEngagementRate,
              change: pct(averageEngagementRate, prevEngagementRate),
            },
          },
        },
      });
    }
  );

  // GET /api/analytics/social-accounts/:socialAccountId/series?window=30d&metrics=impressions,reach
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

      const metricList = (metrics || 'impressions,reach,profile_views,followers')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);

      // Prefer account_metric_samples when present (generated by analytics-ingestor)
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
      const pushSample = (date: string, name: string, value: number) => {
        byDate[date] ||= {};
        byDate[date][name] = (byDate[date][name] || 0) + value;
      };

      if (samples.length > 0) {
        for (const s of samples) {
          const date = s.asOf.toISOString().split('T')[0];
          const name = String(s.metricName);
          const val = Number(s.value || 0);
          pushSample(date, name, val);
        }
      } else {
        // Fallback: derive from publication metrics grouped by publishedAt day
        const pubs = await prisma.contentPublication.findMany({
          where: {
            socialAccountId,
            publishedAt: { gte: start, lte: end },
          },
          select: { publishedAt: true, metricsLatest: true },
        });
        for (const p of pubs) {
          if (!p.publishedAt || !p.metricsLatest) continue;
          const date = p.publishedAt.toISOString().split('T')[0];
          const m = p.metricsLatest;
          if (metricList.includes('impressions'))
            pushSample(date, 'impressions', m.impressions || 0);
          if (metricList.includes('reach')) pushSample(date, 'reach', m.reach || 0);
          if (metricList.includes('profile_views'))
            pushSample(date, 'profile_views', (m as any).profileViews || 0);
        }
      }

      const series = Object.keys(byDate)
        .sort()
        .map((date) => ({ date, metrics: byDate[date] }));

      return reply.send({ success: true, data: { window, metrics: metricList, series } });
    }
  );

  // GET /api/analytics/social-accounts/:socialAccountId/posts?period=30d&sortBy=publishedAt&order=desc&limit=20&offset=0
  fastify.get(
    '/analytics/social-accounts/:socialAccountId/posts',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { socialAccountId } = request.params as { socialAccountId: string };
      const {
        period = '30d',
        sortBy = 'publishedAt',
        order = 'desc',
        limit = '20',
        offset = '0',
      } = request.query as {
        period?: '7d' | '30d' | '90d';
        sortBy?: string;
        order?: 'asc' | 'desc';
        limit?: string;
        offset?: string;
      };

      await resolveSocialAccountForUser({ userId, socialAccountId });

      const days = periodToDays(period);
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - days);

      const take = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const skip = Math.max(parseInt(offset, 10) || 0, 0);

      const where: any = {
        socialAccountId,
        publishedAt: { gte: start, lte: end },
      };

      let orderByClause: any = {};
      if (sortBy === 'publishedAt') {
        orderByClause = { publishedAt: order };
      } else if (['impressions', 'reach', 'engagement', 'engagementRate'].includes(sortBy)) {
        orderByClause = { metricsLatest: { [sortBy]: order } };
      } else {
        orderByClause = { publishedAt: 'desc' };
      }

      const [posts, total] = await Promise.all([
        prisma.contentPublication.findMany({
          where,
          orderBy: orderByClause,
          take,
          skip,
          select: {
            id: true,
            platform: true,
            contentId: true,
            permalink: true,
            publishedAt: true,
            metricsLatest: true,
            content: {
              select: {
                caption: true,
                mediaAssets: {
                  select: { assetId: true, displayOrder: true },
                  orderBy: { displayOrder: 'asc' },
                  take: 1,
                },
              },
            },
          },
        }),
        prisma.contentPublication.count({ where }),
      ]);

      const primaryAssetIds = posts
        .map((p) => p.content.mediaAssets?.[0]?.assetId)
        .filter((id): id is string => Boolean(id));
      const uniquePrimaryAssetIds = Array.from(new Set(primaryAssetIds));
      const assetsById = new Map<string, any>();
      if (uniquePrimaryAssetIds.length > 0) {
        try {
          const assetsClient = getAssetsClient();
          const assets = await assetsClient.getBatchAssets(uniquePrimaryAssetIds);
          assets.forEach((asset) => {
            if (asset?.id) assetsById.set(asset.id, asset);
          });
        } catch {
          // ignore thumbnails failures
        }
      }

      const data = posts.map((p) => {
        const m = p.metricsLatest || {
          impressions: 0,
          reach: 0,
          likes: 0,
          comments: 0,
          saves: 0,
          shares: 0,
          engagement: 0,
          engagementRate: 0,
        };
        const primaryAssetId = p.content.mediaAssets?.[0]?.assetId;
        const asset = primaryAssetId ? assetsById.get(primaryAssetId) : null;
        const thumbnailCandidate = asset?.thumbnailUrl;
        const thumbnailUrl =
          typeof thumbnailCandidate === 'string' && thumbnailCandidate.length > 0
            ? thumbnailCandidate
            : asset?.fileType === 'image' && typeof asset?.url === 'string'
              ? asset.url
              : null;

        return {
          publicationId: p.id,
          contentId: p.contentId,
          platform: p.platform,
          caption: p.content.caption,
          thumbnailUrl,
          permalink: p.permalink,
          publishedAt: p.publishedAt,
          metrics: m,
        };
      });

      return reply.send({
        success: true,
        data,
        pagination: { total, limit: take, offset: skip, hasMore: skip + take < total },
      });
    }
  );

  // POST /api/analytics/social-accounts/:socialAccountId/refresh
  fastify.post(
    '/analytics/social-accounts/:socialAccountId/refresh',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { socialAccountId } = request.params as { socialAccountId: string };
      const { includePublications = true } = (request.body || {}) as {
        includePublications?: boolean;
      };

      await resolveSocialAccountForUser({ userId, socialAccountId });

      const redis = getRedisClient();
      const throttleKey = `ingest:account:socialAccount:${socialAccountId}`;
      const throttleSeconds = 15 * 60;
      if (redis) {
        const ttl = await redis.ttl(throttleKey);
        if (ttl > 0) {
          return reply.code(429).send({
            success: false,
            error: 'Refresh recently requested',
            nextRefreshAllowed: new Date(Date.now() + ttl * 1000).toISOString(),
          });
        }
        await redis.setex(throttleKey, throttleSeconds, '1');
        await redis.lpush('ingest:queue:accounts', socialAccountId);

        if (includePublications) {
          const recent = await prisma.contentPublication.findMany({
            where: { socialAccountId, publishedAt: { not: null } },
            orderBy: [{ updatedAt: 'desc' }],
            take: 25,
            select: { id: true },
          });
          for (const p of recent) {
            await redis.lpush('ingest:queue:publications', p.id);
          }
        }
      }

      return reply.send({
        success: true,
        nextRefreshAllowed: new Date(Date.now() + throttleSeconds * 1000).toISOString(),
        enqueued: true,
      });
    }
  );

  // GET /api/analytics/social-accounts/:socialAccountId/health?period=30d
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

  // GET /api/analytics/social-accounts/:socialAccountId/ai-insights?days=30
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
        {
          socialAccountId,
        }
      );

      return reply.send({ success: true, data: report });
    }
  );

  // GET /api/analytics/social-accounts/:socialAccountId/forecasting?days=30&historical=90
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
        {
          socialAccountId,
        }
      );

      return reply.send({ success: true, data: report });
    }
  );

  // GET /api/analytics/social-accounts/:socialAccountId/recommendations?days=90
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
};
