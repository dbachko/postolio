import { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import { getRedisClient } from '../services/redis.js';

const prisma = getDatabaseClient();

const analyticsRoutesV2: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // Get latest metrics for a publication
  fastify.get('/analytics/publications/:publicationId', async (request, reply) => {
    try {
      const { publicationId } = request.params as { publicationId: string };
      const latest = await prisma.publicationMetricsLatest.findUnique({
        where: { publicationId },
      });
      if (!latest) return reply.code(404).send({ error: 'Not found' });
      return reply.send({ success: true, data: latest });
    } catch (error) {
      request.log.error({ error }, 'Failed to get publication metrics');
      return reply.code(500).send({ error: 'Failed to get publication metrics' });
    }
  });

  // Enqueue a refresh for a publication (throttled)
  fastify.post('/analytics/publications/:publicationId/refresh', async (request, reply) => {
    try {
      const { publicationId } = request.params as { publicationId: string };
      const pub = await prisma.contentPublication.findUnique({ where: { id: publicationId } });
      if (!pub) return reply.code(404).send({ error: 'Publication not found' });

      const redis = getRedisClient();
      const key = `ingest:publication:${publicationId}`;
      const throttleSeconds = 15 * 60; // 15 minutes
      let nextAllowed: string | null = null;

      if (redis) {
        const ttl = await redis.ttl(key);
        if (ttl > 0) {
          nextAllowed = new Date(Date.now() + ttl * 1000).toISOString();
          return reply.code(429).send({
            success: false,
            error: 'Refresh recently requested',
            nextRefreshAllowed: nextAllowed,
          });
        }
        await redis.setex(key, throttleSeconds, '1');
      }

      // Push to ingestion queue (best-effort)
      try {
        if (redis) {
          await redis.lpush('ingest:queue:publications', publicationId);
        }
      } catch (e) {
        request.log.warn({ err: e }, 'Failed to enqueue publication for ingestion');
      }

      nextAllowed = new Date(Date.now() + throttleSeconds * 1000).toISOString();
      return reply.send({ success: true, nextRefreshAllowed: nextAllowed, enqueued: true });
    } catch (error) {
      request.log.error({ error }, 'Failed to enqueue refresh');
      return reply.code(500).send({ error: 'Failed to enqueue refresh' });
    }
  });

  // Campaign aggregates by platform
  fastify.get('/analytics/campaigns/:campaignId', async (request, reply) => {
    try {
      const { campaignId } = request.params as { campaignId: string };
      const contents = await prisma.content.findMany({
        where: { campaignId },
        select: { id: true },
      });
      if (!contents.length) return reply.send({ success: true, data: { totalPosts: 0 } });
      const contentIds = contents.map((c) => c.id);
      const pubs = await prisma.contentPublication.findMany({
        where: { contentId: { in: contentIds } },
        select: { id: true, platform: true, metricsLatest: true },
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
      const averageEngagementRate =
        totalImpressions > 0 ? (totalEngagement / totalImpressions) * 100 : 0;
      return reply.send({
        success: true,
        data: {
          totalPosts: pubs.length,
          totalImpressions,
          totalEngagement,
          reach: totalReach,
          averageEngagementRate,
          breakdown: byPlatform,
        },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to get campaign aggregates');
      return reply.code(500).send({ error: 'Failed to get campaign aggregates' });
    }
  });

  // Brand summary aggregates
  fastify.get('/analytics/brands/:brandId/summary', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
      const pubs = await prisma.contentPublication.findMany({
        where: { content: { brandId } },
        select: { id: true, platform: true, metricsLatest: true },
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
      const averageEngagementRate =
        totalImpressions > 0 ? (totalEngagement / totalImpressions) * 100 : 0;
      return reply.send({
        success: true,
        data: {
          totalPosts: pubs.length,
          totalImpressions,
          totalEngagement,
          reach: totalReach,
          averageEngagementRate,
          breakdown: byPlatform,
        },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to get brand summary');
      return reply.code(500).send({ error: 'Failed to get brand summary' });
    }
  });

  // Brand account-level daily series (aggregated across accounts per platform)
  fastify.get('/analytics/brands/:brandId/account/series', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
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
      return reply.code(500).send({ error: 'Failed to get account series' });
    }
  });

  // Top performing publications for a brand (by engagementRate)
  fastify.get('/analytics/brands/:brandId/top-publications', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
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
        },
      });

      const data = pubs
        .filter((p) => p.metricsLatest)
        .map((p) => ({
          publicationId: p.id,
          platform: p.platform,
          contentId: p.contentId,
          permalink: p.permalink,
          publishedAt: p.publishedAt,
          metrics: p.metricsLatest,
        }));

      return reply.send({ success: true, data });
    } catch (error) {
      request.log.error({ error }, 'Failed to get top publications');
      return reply.code(500).send({ error: 'Failed to get top publications' });
    }
  });

  // Enqueue account-level refresh for all social accounts under a brand (throttled)
  fastify.post('/analytics/brands/:brandId/account/refresh', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
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
      return reply.code(500).send({ error: 'Failed to enqueue account refresh' });
    }
  });
};

export default analyticsRoutesV2;
