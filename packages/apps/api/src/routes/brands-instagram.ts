import { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import { instagramService } from '../services/instagram.js';
import { instagramBestTimeService } from '../services/instagram-best-time.js';
import type { BestTimePayload } from '../services/instagram-best-time.js';
import { getRedisClient, redisService } from '../services/redis.js';

const prisma = getDatabaseClient();

// Brand-nested Instagram endpoints under /api/brands
// Mirrors functionality of instagram.ts without changing existing endpoints.
const brandsInstagramRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/brands/:brandId/instagram/status
  fastify.get(
    '/:brandId/instagram/status',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params as { brandId: string };
      const userId = request.user!.id;
      const { refresh } = request.query as { refresh?: string };
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      if (!brand) return reply.code(404).send({ error: 'Brand not found' });
      const connected = instagramService.isConfigured(brand);
      let profile = null;
      if (connected) {
        if (refresh === 'true') {
          try {
            const fresh = await instagramService.getProfile(brand);
            await prisma.brand.update({
              where: { id: brandId },
              data: { instagramProfileData: fresh ? JSON.parse(JSON.stringify(fresh)) : null },
            });
            profile = fresh;
          } catch (e) {
            request.log.warn({ err: e }, 'Failed to refresh IG profile; using cached');
            profile = brand.instagramProfileData;
          }
        } else {
          profile = brand.instagramProfileData;
        }
      }
      reply.send({ connected, profile });
    }
  );

  // POST /api/brands/:brandId/instagram/refresh-token
  fastify.post(
    '/:brandId/instagram/refresh-token',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params as { brandId: string };
      const userId = request.user!.id;
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      if (!brand) return reply.code(404).send({ error: 'Brand not found' });
      if (!brand.instagramAccountId)
        return reply.code(400).send({ error: 'Instagram not connected' });
      return reply.send({
        success: true,
        message: 'Token refresh is handled automatically by Token Service',
      });
    }
  );

  // POST /api/brands/:brandId/instagram/disconnect
  fastify.post(
    '/:brandId/instagram/disconnect',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params as { brandId: string };
      const userId = request.user!.id;
      const updated = await prisma.brand.updateMany({
        where: { id: brandId, userId },
        data: {
          instagramPageId: null,
          instagramAccountId: null,
          instagramProfileData: { set: null },
        },
      });
      if (updated.count === 0) return reply.code(404).send({ error: 'Brand not found' });
      reply.send({ success: true });
    }
  );

  // POST /api/brands/:brandId/instagram/sync
  fastify.post<{ Params: { brandId: string }; Body: { maxPosts?: number; maxDays?: number } }>(
    '/:brandId/instagram/sync',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const { maxPosts, maxDays } = request.body || {};
      const brand = await prisma.brand.findFirst({
        where: { id: brandId, userId: request.user!.id },
      });
      if (!brand) return reply.code(404).send({ error: 'Brand not found' });
      if (!instagramService.isConfigured(brand))
        return reply.code(400).send({ error: 'Instagram not connected' });

      const cooldownKey = `ig-sync-${brandId}`;
      const lastSync = await redisService.get(cooldownKey);
      if (lastSync) {
        const timeSince = Date.now() - parseInt(lastSync);
        const cooldownMs = 15 * 60 * 1000;
        if (timeSince < cooldownMs) {
          const remainingMinutes = Math.ceil((cooldownMs - timeSince) / 60000);
          return reply.status(429).send({
            error: 'Sync already in progress or completed recently',
            message: `Please wait ${remainingMinutes} more minutes before syncing again`,
            retryAfter: new Date(parseInt(lastSync) + cooldownMs).toISOString(),
          });
        }
      }
      await redisService.set(cooldownKey, Date.now().toString(), 900);

      const results = await instagramService.syncPublishedPosts(brand, {
        maxPosts: maxPosts || 100,
        maxDays: maxDays || 30,
      });
      reply.send({
        success: true,
        results,
        message: `Synced ${results.synced} posts, skipped ${results.skipped}, failed ${results.failed}`,
      });
    }
  );

  // GET /api/brands/:brandId/instagram/best-time
  fastify.get(
    '/:brandId/instagram/best-time',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params as { brandId: string };
      const userId = request.user!.id;
      const { force } = request.query as { force?: string };

      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      if (!brand) return reply.code(404).send({ error: 'Brand not found' });
      if (!instagramService.isConfigured(brand))
        return reply.code(400).send({ error: 'Instagram not connected' });

      try {
        const rec = await instagramBestTimeService.getRecommendations(brandId, force === 'true');
        reply.send(rec);
      } catch (e) {
        request.log.error({ err: e }, 'Failed to get best-time recommendations');
        reply.code(500).send({ error: 'Failed to compute recommendations' });
      }
    }
  );

  // POST /api/brands/:brandId/instagram/best-time/refresh
  fastify.post(
    '/:brandId/instagram/best-time/refresh',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params as { brandId: string };
      const userId = request.user!.id;
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      if (!brand) return reply.code(404).send({ error: 'Brand not found' });
      if (!instagramService.isConfigured(brand))
        return reply.code(400).send({ error: 'Instagram not connected' });

      try {
        const rec = await instagramBestTimeService.getRecommendations(brandId, true);
        reply.send({ success: true, recommendations: rec });
      } catch (e) {
        request.log.error({ err: e }, 'Failed to refresh best-time recommendations');
        reply.code(500).send({ success: false, error: 'Failed to recompute recommendations' });
      }
    }
  );

  // GET /api/brands/:brandId/instagram/best-time/status
  fastify.get(
    '/:brandId/instagram/best-time/status',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params as { brandId: string };
      const userId = request.user!.id;
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      if (!brand) return reply.code(404).send({ error: 'Brand not found' });

      const key = `ig_best_time:${brandId}`;
      const redis = getRedisClient();
      let ttl = -1;
      let meta: BestTimePayload | null = null;
      try {
        if (redis) ttl = await redis.ttl(key);
        const cached = await redisService.get(key);
        if (cached) meta = JSON.parse(cached) as BestTimePayload;
      } catch (e) {
        request.log.warn({ err: e }, 'Failed to read cache status');
      }
      reply.send({
        cacheTTL: ttl,
        cached: !!meta,
        source: meta?.source,
        confidence: meta?.confidence,
        generatedAt: meta?.generatedAt,
        nextRefreshAt: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null,
      });
    }
  );
};

export default brandsInstagramRoutes;
