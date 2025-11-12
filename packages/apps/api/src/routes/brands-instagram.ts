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
      const lockKey = `instagram_sync_lock:${brandId}`;
      const redis = getRedisClient();

      // If a lock exists, indicate in-progress and return 429 with TTL
      if (redis) {
        try {
          const ttl = await redis.ttl(lockKey);
          if (typeof ttl === 'number' && ttl > 0) {
            return reply.status(429).send({
              error: 'Sync already in progress',
              retryAfterSeconds: ttl,
            });
          }
        } catch (e) {
          request.log.warn({ err: e }, 'Failed to check sync lock');
        }
      }

      // Check recent cooldown (avoid rapid repeated manual triggers)
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

      // Set cooldown prior to starting sync; the service will enforce lock too
      await redisService.set(cooldownKey, Date.now().toString(), 900);

      try {
        const results = await instagramService.syncPublishedPosts(brand, {
          maxPosts: maxPosts || 100,
          maxDays: maxDays || 30,
        });
        reply.send({
          success: true,
          results,
          message: `Synced ${results.synced} posts, skipped ${results.skipped}, failed ${results.failed}`,
        });
      } catch (e) {
        const msg = (e as Error)?.message || '';
        if (/already in progress/i.test(msg)) {
          let ttl: number | null = null;
          if (redis) {
            try {
              const t = await redis.ttl(lockKey);
              ttl = typeof t === 'number' ? t : null;
            } catch {}
          }
          return reply.status(429).send({
            error: 'Sync already in progress',
            retryAfterSeconds: ttl,
          });
        }
        request.log.error({ err: e }, 'Sync posts endpoint error');
        reply
          .status(500)
          .send({ error: 'Failed to sync Instagram posts', message: msg || 'Unknown error' });
      }
    }
  );

  // GET /api/brands/:brandId/instagram/sync-status
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/instagram/sync-status',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const brand = await prisma.brand.findFirst({
        where: { id: brandId, userId: request.user!.id },
      });
      if (!brand) return reply.code(404).send({ error: 'Brand not found' });

      const redis = getRedisClient();
      const lockKey = `instagram_sync_lock:${brandId}`;
      const cooldownKey = `ig-sync-${brandId}`;

      let inProgress = false;
      let lockTtl: number | null = null;
      let cooldownRemaining = 0;

      try {
        if (redis) {
          const ttl = await redis.ttl(lockKey);
          if (typeof ttl === 'number' && ttl > 0) {
            inProgress = true;
            lockTtl = ttl;
          }
          const cdTtl = await redis.ttl(cooldownKey);
          if (typeof cdTtl === 'number' && cdTtl > 0) {
            cooldownRemaining = cdTtl;
          }
        }
      } catch (e) {
        request.log.warn({ err: e }, 'Failed to query sync status');
      }

      // Get last sync metadata
      const metadataKey = `instagram_sync_metadata:${brandId}`;
      let lastSync: any = null;
      try {
        const metadataJson = await redisService.get(metadataKey);
        if (metadataJson) {
          const metadata = JSON.parse(metadataJson);
          lastSync = {
            timestamp: metadata.timestamp,
            duration: metadata.duration,
            results: metadata.results,
            options: metadata.options,
          };
        }
      } catch {}

      return reply.send({ inProgress, lockTtl, cooldownRemaining, lastSync });
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

  // Instagram DMs API
  fastify.get<{ Params: { brandId: string }; Querystring: { limit?: number; after?: string } }>(
    '/:brandId/instagram/dms/threads',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const { limit, after } = request.query || {};
      const userId = request.user!.id;
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      if (!brand) return reply.code(404).send({ error: 'Brand not found' });
      try {
        const configured = instagramService.isConfigured(brand);
        if (!configured) {
          return reply.code(501).send({ supported: false, threads: [] });
        }

        const res = await instagramService.listDmThreads(brand, { limit, after });
        if (!res.supported) {
          return reply.code(501).send({ supported: false, threads: [] });
        }
        return reply.send(res);
      } catch (e: any) {
        return reply
          .code(500)
          .send({ error: 'Failed to fetch threads', message: e?.message || 'Unknown error' });
      }
    }
  );

  fastify.get<{
    Params: { brandId: string; threadId: string };
    Querystring: { limit?: number; before?: string };
  }>(
    '/:brandId/instagram/dms/threads/:threadId/messages',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId, threadId } = request.params;
      const { limit, before } = request.query || {};
      const userId = request.user!.id;
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      if (!brand) return reply.code(404).send({ error: 'Brand not found' });
      try {
        const configured = instagramService.isConfigured(brand);
        if (!configured) {
          return reply.code(501).send({ supported: false, messages: [] });
        }

        const res = await instagramService.getDmThreadMessages(brand, threadId, { limit, before });
        if (!res.supported) {
          return reply.code(501).send({ supported: false, messages: [] });
        }
        return reply.send(res);
      } catch (e: any) {
        return reply
          .code(500)
          .send({ error: 'Failed to fetch messages', message: e?.message || 'Unknown error' });
      }
    }
  );

  fastify.post<{ Params: { brandId: string; threadId: string }; Body: { text: string } }>(
    '/:brandId/instagram/dms/threads/:threadId/messages',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId, threadId } = request.params;
      const userId = request.user!.id;
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      if (!brand) return reply.code(404).send({ error: 'Brand not found' });
      const { text } = (request.body || {}) as { text?: string };
      if (!text || !text.trim())
        return reply.code(400).send({ error: 'Message must not be empty' });
      try {
        const configured = instagramService.isConfigured(brand);
        if (!configured) {
          return reply
            .code(501)
            .send({ supported: false, message: 'Instagram messaging not configured' });
        }

        const res = await instagramService.sendDmMessage(brand, threadId, text);
        if (!res.supported)
          return reply
            .code(501)
            .send({ supported: false, message: res.message || 'Not supported' });
        if (!res.success && res.errorCode === 'WINDOW_CLOSED') {
          return reply.code(403).send({ supported: true, success: false, error: 'WINDOW_CLOSED' });
        }
        return reply.send({ supported: true, success: true });
      } catch (e: any) {
        return reply
          .code(500)
          .send({ error: 'Failed to send message', message: e?.message || 'Unknown error' });
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
