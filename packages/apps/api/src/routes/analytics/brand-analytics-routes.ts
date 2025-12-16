import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../../config/database.js';
import { getRedisClient } from '../../services/redis.js';
import { calculateBrandHealthScore } from '../../services/brand-health-score.js';
import { assertBrandOwnership } from '../../services/ownership.js';
import { getAssetsClient } from '../../services/assets-media.js';
import { instagramService } from '../../services/instagram.js';

const prisma = getDatabaseClient();

export const brandAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  // Brand summary aggregates (period-aware with account-series fallback)
  fastify.get('/analytics/brands/:brandId/summary', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
      const userId = (request.user as { id: string } | undefined)?.id;

      if (userId) {
        await assertBrandOwnership(userId, brandId);
      }
      const { period = '30d' } = request.query as { period?: '7d' | '30d' | '90d' };

      // Determine current window start based on period
      const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
      const now = new Date();
      const currentStart = new Date();
      currentStart.setDate(now.getDate() - days);

      // Aggregate latest metrics from publications within the current window
      const pubs = await prisma.contentPublication.findMany({
        where: { content: { brandId }, publishedAt: { gte: currentStart, lte: now } },
        select: { id: true, platform: true, metricsLatest: true, publishedAt: true },
      });

      const byPlatform: Record<string, any> = {};
      let totalImpressions = 0;
      let totalEngagement = 0;
      let totalReach = 0;

      for (const p of pubs) {
        const m = p.metricsLatest;
        if (!m) continue;
        const key = p.platform;
        byPlatform[key] ||= { posts: 0, impressions: 0, engagement: 0, reach: 0 };
        byPlatform[key].posts += 1;
        byPlatform[key].impressions += m.impressions || 0;
        byPlatform[key].engagement += m.engagement || 0;
        byPlatform[key].reach += m.reach || 0;
        totalImpressions += m.impressions || 0;
        totalEngagement += m.engagement || 0;
        totalReach += m.reach || 0;
      }

      // Fallback to account-level daily series when post metrics are missing
      if (totalImpressions === 0 || totalReach === 0) {
        const samples = await prisma.accountMetricSample.findMany({
          where: {
            socialAccount: { brandId },
            asOf: { gte: currentStart, lte: now },
            period: 'day',
            metricName: { in: ['impressions', 'reach'] as any },
          },
          select: { metricName: true, value: true },
        });
        let seriesImpressions = 0;
        let seriesReach = 0;
        for (const s of samples) {
          const val = Number(s.value || 0);
          if ((s.metricName as any) === 'impressions') seriesImpressions += val;
          if ((s.metricName as any) === 'reach') seriesReach += val;
        }
        if (totalImpressions === 0) totalImpressions = seriesImpressions;
        if (totalReach === 0) totalReach = seriesReach;
      }

      const averageEngagementRate =
        totalImpressions > 0 ? (totalEngagement / totalImpressions) * 100 : 0;

      // Calculate health score
      const healthScore = await calculateBrandHealthScore(brandId, period);

      // Get previous period for comparison
      const previousStart = new Date();
      previousStart.setDate(previousStart.getDate() - days * 2);

      const previousPubs = await prisma.contentPublication.findMany({
        where: {
          content: { brandId },
          publishedAt: { gte: previousStart, lt: currentStart },
        },
        select: { metricsLatest: true },
      });

      let prevImpressions = 0;
      let prevEngagement = 0;
      let prevReach = 0;

      for (const p of previousPubs) {
        const m = p.metricsLatest;
        if (!m) continue;
        prevImpressions += m.impressions || 0;
        prevEngagement += m.engagement || 0;
        prevReach += m.reach || 0;
      }

      const prevEngagementRate = prevImpressions > 0 ? (prevEngagement / prevImpressions) * 100 : 0;

      // Calculate changes
      const impressionsChange =
        prevImpressions > 0 ? ((totalImpressions - prevImpressions) / prevImpressions) * 100 : 0;
      const reachChange = prevReach > 0 ? ((totalReach - prevReach) / prevReach) * 100 : 0;
      const engagementChange =
        prevEngagement > 0 ? ((totalEngagement - prevEngagement) / prevEngagement) * 100 : 0;
      const engagementRateChange =
        prevEngagementRate > 0
          ? ((averageEngagementRate - prevEngagementRate) / prevEngagementRate) * 100
          : 0;

      return reply.send({
        success: true,
        data: {
          totalPosts: pubs.length,
          totalImpressions,
          totalEngagement,
          reach: totalReach,
          averageEngagementRate,
          breakdown: byPlatform,
          healthScore,
          previousPeriodComparison: {
            impressions: {
              current: totalImpressions,
              previous: prevImpressions,
              change: impressionsChange,
            },
            reach: {
              current: totalReach,
              previous: prevReach,
              change: reachChange,
            },
            engagement: {
              current: totalEngagement,
              previous: prevEngagement,
              change: engagementChange,
            },
            engagementRate: {
              current: averageEngagementRate,
              previous: prevEngagementRate,
              change: engagementRateChange,
            },
          },
        },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to get brand summary');
      throw error;
    }
  });

  // Brand account-level daily series (aggregated across accounts per platform)
  fastify.get('/analytics/brands/:brandId/account/series', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
      const userId = (request.user as { id: string } | undefined)?.id;

      if (userId) {
        await assertBrandOwnership(userId, brandId);
      }
      const { window = '30d' } = request.query as { window?: '7d' | '30d' | '90d' };
      const end = new Date();
      const days = window === '7d' ? 7 : window === '90d' ? 90 : 30;
      const start = new Date();
      start.setDate(end.getDate() - days);

      // Load samples within window
      const samples = await prisma.accountMetricSample.findMany({
        where: {
          socialAccount: { brandId },
          asOf: { gte: start, lte: end },
          period: 'day',
          metricName: { in: ['impressions', 'reach', 'profile_views'] as any },
        },
        orderBy: { asOf: 'asc' },
        select: {
          asOf: true,
          metricName: true,
          value: true,
        },
      });

      // Aggregate by day
      const byDate: Record<string, { impressions: number; reach: number; profile_views: number }> =
        {};
      for (const s of samples) {
        const date = s.asOf.toISOString().split('T')[0];
        byDate[date] ||= { impressions: 0, reach: 0, profile_views: 0 };
        const val = Number(s.value || 0);
        if ((s.metricName as any) === 'impressions') byDate[date].impressions += val;
        else if ((s.metricName as any) === 'reach') byDate[date].reach += val;
        else if ((s.metricName as any) === 'profile_views') byDate[date].profile_views += val;
      }

      const series = Object.keys(byDate)
        .sort()
        .map((d) => ({ date: d, ...byDate[d] }));

      return reply.send({ success: true, data: { series } });
    } catch (error) {
      request.log.error({ error }, 'Failed to get account series');
      throw error;
    }
  });

  // Top performing publications for a brand (by engagementRate)
  fastify.get('/analytics/brands/:brandId/top-publications', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
      const userId = (request.user as { id: string } | undefined)?.id;

      if (userId) {
        await assertBrandOwnership(userId, brandId);
      }
      const { limit = '10' } = request.query as { limit?: string };
      const take = Math.min(Math.max(parseInt(String(limit), 10) || 10, 1), 50);

      const pubs = await prisma.contentPublication.findMany({
        where: { content: { brandId } },
        orderBy: { metricsLatest: { engagementRate: 'desc' } },
        take,
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
      });

      const primaryAssetIds = pubs
        .map((p) => p.content?.mediaAssets?.[0]?.assetId)
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
        } catch (error) {
          fastify.log.warn(
            { err: error, brandId },
            'Failed to fetch asset thumbnails for analytics'
          );
        }
      }

      const data = pubs
        .filter((p) => p.metricsLatest)
        .map((p) => {
          const primaryAssetId = p.content?.mediaAssets?.[0]?.assetId;
          const asset = primaryAssetId ? assetsById.get(primaryAssetId) : null;
          const thumbnailCandidate = asset?.thumbnailUrl;
          const thumbnailUrl =
            typeof thumbnailCandidate === 'string' && thumbnailCandidate.length > 0
              ? thumbnailCandidate
              : asset?.fileType === 'image' && typeof asset?.url === 'string'
                ? asset.url
                : undefined;
          const imageUrl =
            asset?.fileType === 'image' && typeof asset?.url === 'string' ? asset.url : undefined;

          return {
            publicationId: p.id,
            platform: p.platform,
            contentId: p.contentId,
            permalink: p.permalink,
            publishedAt: p.publishedAt,
            metrics: p.metricsLatest,
            caption: p.content?.caption || undefined,
            thumbnailUrl,
            imageUrl,
          };
        });

      return reply.send({ success: true, data });
    } catch (error) {
      request.log.error({ error }, 'Failed to get top publications');
      throw error;
    }
  });

  // Enqueue account-level refresh for all social accounts under a brand (throttled)
  fastify.post('/analytics/brands/:brandId/account/refresh', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
      const userId = (request.user as { id: string } | undefined)?.id;

      if (userId) {
        await assertBrandOwnership(userId, brandId);
      }
      const redis = getRedisClient();
      const throttleKey = `ingest:account:brand:${brandId}`;
      const throttleSeconds = 15 * 60;
      let nextAllowed: string | null = null;
      if (redis) {
        const ttl = await redis.ttl(throttleKey);
        if (ttl > 0) {
          nextAllowed = new Date(Date.now() + ttl * 1000).toISOString();
          return reply.code(429).send({
            success: false,
            error: 'Refresh recently requested',
            nextRefreshAllowed: nextAllowed,
          });
        }
        await redis.setex(throttleKey, throttleSeconds, '1');

        const accounts = await prisma.socialAccount.findMany({
          where: { brandId },
          select: { id: true },
        });
        for (const sa of accounts) {
          await redis.lpush('ingest:queue:accounts', sa.id);
        }
      }
      nextAllowed = new Date(Date.now() + throttleSeconds * 1000).toISOString();
      return reply.send({ success: true, nextRefreshAllowed: nextAllowed, enqueued: true });
    } catch (error) {
      request.log.error({ error }, 'Failed to enqueue account refresh');
      throw error;
    }
  });

  // Hashtag Analysis - Get performance metrics for each hashtag used
  fastify.get('/analytics/brands/:brandId/hashtags', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };

      const contents = await prisma.content.findMany({
        where: { brandId, status: 'published' },
        select: {
          id: true,
          hashtags: true,
          publications: {
            select: {
              id: true,
              metricsLatest: true,
            },
          },
        },
      });

      const hashtagMap = new Map<
        string,
        {
          uses: number;
          totalReach: number;
          totalEngagement: number;
          totalImpressions: number;
          bestPost: { contentId: string; engagementRate: number } | null;
        }
      >();

      for (const content of contents) {
        for (const hashtag of content.hashtags || []) {
          const tag = hashtag.toLowerCase();
          const existing = hashtagMap.get(tag) || {
            uses: 0,
            totalReach: 0,
            totalEngagement: 0,
            totalImpressions: 0,
            bestPost: null,
          };

          existing.uses += 1;

          for (const pub of content.publications) {
            if (pub.metricsLatest) {
              existing.totalReach += pub.metricsLatest.reach || 0;
              existing.totalEngagement += pub.metricsLatest.engagement || 0;
              existing.totalImpressions += pub.metricsLatest.impressions || 0;

              const engRate = Number(pub.metricsLatest.engagementRate || 0);
              if (!existing.bestPost || engRate > existing.bestPost.engagementRate) {
                existing.bestPost = {
                  contentId: content.id,
                  engagementRate: engRate,
                };
              }
            }
          }

          hashtagMap.set(tag, existing);
        }
      }

      const hashtags = Array.from(hashtagMap.entries()).map(([tag, stats]) => ({
        hashtag: tag,
        uses: stats.uses,
        avgReach: stats.uses > 0 ? Math.round(stats.totalReach / stats.uses) : 0,
        avgEngagement: stats.uses > 0 ? Math.round(stats.totalEngagement / stats.uses) : 0,
        avgImpressions: stats.uses > 0 ? Math.round(stats.totalImpressions / stats.uses) : 0,
        bestPost: stats.bestPost,
      }));

      hashtags.sort((a, b) => b.avgEngagement - a.avgEngagement);

      return reply.send({ success: true, data: hashtags.slice(0, 50) });
    } catch (error) {
      request.log.error({ error }, 'Failed to get hashtag analysis');
      throw error;
    }
  });

  // Audience Insights - Demographics and activity patterns
  fastify.get('/analytics/brands/:brandId/audience', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
      const userId = (request.user as { id: string } | undefined)?.id;

      if (userId) {
        await assertBrandOwnership(userId, brandId);
      }

      // Get social accounts for the brand
      const accounts = await prisma.socialAccount.findMany({
        where: { brandId },
        include: { accountMetricsLatest: true },
      });

      // Get follower growth timeline (last 30 days)
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const followerSamples = await prisma.accountMetricSample.findMany({
        where: {
          socialAccount: { brandId },
          metricName: 'followers',
          asOf: { gte: startDate },
        },
        orderBy: { asOf: 'asc' },
        select: {
          asOf: true,
          value: true,
        },
      });

      // Calculate follower growth timeline
      const followerTimeline = followerSamples.map((s) => ({
        date: s.asOf.toISOString().split('T')[0],
        followers: Number(s.value),
      }));

      // Activity patterns - analyze best posting times from published content
      const publications = await prisma.contentPublication.findMany({
        where: {
          content: { brandId },
          publishedAt: { not: null },
        },
        select: {
          publishedAt: true,
          metricsLatest: true,
        },
      });

      // Build heatmap data (day of week × hour)
      const activityMap: number[][] = Array(7)
        .fill(0)
        .map(() => Array(24).fill(0));
      const countMap: number[][] = Array(7)
        .fill(0)
        .map(() => Array(24).fill(0));

      for (const pub of publications) {
        if (pub.publishedAt && pub.metricsLatest) {
          const date = new Date(pub.publishedAt);
          const day = date.getDay(); // 0 = Sunday
          const hour = date.getHours();
          const engagement = Number(pub.metricsLatest.engagement || 0);

          activityMap[day][hour] += engagement;
          countMap[day][hour] += 1;
        }
      }

      // Calculate average engagement per time slot
      const heatmap = activityMap.map((dayData, day) =>
        dayData.map((totalEngagement, hour) => {
          const count = countMap[day][hour];
          return count > 0 ? Math.round(totalEngagement / count) : 0;
        })
      );

      // Find best posting times (top 5)
      const bestTimes: Array<{ day: number; hour: number; avgEngagement: number }> = [];
      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          if (countMap[day][hour] > 0) {
            bestTimes.push({
              day,
              hour,
              avgEngagement: heatmap[day][hour],
            });
          }
        }
      }
      bestTimes.sort((a, b) => b.avgEngagement - a.avgEngagement);

      // Current follower count
      const totalFollowers = accounts.reduce(
        (sum, acc) => sum + (acc.accountMetricsLatest?.followers || 0),
        0
      );

      // Calculate follower growth
      const firstFollowerCount = followerTimeline[0]?.followers || totalFollowers;
      const followerGrowth = totalFollowers - firstFollowerCount;
      const followerGrowthRate =
        firstFollowerCount > 0 ? ((followerGrowth / firstFollowerCount) * 100).toFixed(1) : '0.0';

      // Instagram audience demographics (best-effort; do not fail the endpoint on permissions/token issues)
      const demographicsResult = await instagramService.getAudienceDemographics(brandId);

      return reply.send({
        success: true,
        data: {
          demographics: demographicsResult.demographics || null,
          demographicsStatus: demographicsResult.status,
          demographicsError: demographicsResult.errorMessage || null,
          activityHeatmap: heatmap,
          bestPostingTimes: bestTimes.slice(0, 5).map((bt) => ({
            day: bt.day,
            dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
              bt.day
            ],
            hour: bt.hour,
            timeFormatted: `${bt.hour}:00`,
            avgEngagement: bt.avgEngagement,
          })),
          followerGrowth: {
            current: totalFollowers,
            change: followerGrowth,
            changeRate: followerGrowthRate,
            timeline: followerTimeline,
          },
        },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to get audience insights');
      throw error;
    }
  });

  // Posts Performance - Enhanced endpoint with filtering and sorting
  fastify.get('/analytics/brands/:brandId/posts', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
      const userId = (request.user as { id: string } | undefined)?.id;

      if (userId) {
        await assertBrandOwnership(userId, brandId);
      }
      const {
        platform,
        sortBy = 'publishedAt',
        order = 'desc',
        limit = '20',
        offset = '0',
      } = request.query as {
        platform?: string;
        sortBy?: string;
        order?: 'asc' | 'desc';
        limit?: string;
        offset?: string;
      };

      const take = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const skip = Math.max(parseInt(offset, 10) || 0, 0);

      // Build where clause
      const where: any = {
        content: { brandId },
      };

      if (platform) {
        where.platform = platform;
      }

      // Determine sort field
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
        } catch (error) {
          fastify.log.warn(
            { err: error, brandId },
            'Failed to fetch asset thumbnails for analytics'
          );
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
        pagination: {
          total,
          limit: take,
          offset: skip,
          hasMore: skip + take < total,
        },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to get posts performance');
      throw error;
    }
  });
};
