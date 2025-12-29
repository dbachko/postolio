import { FastifyPluginAsync } from 'fastify';
import { instagramBestTimeService } from '../services/instagram-best-time.js';
import type { BestTimePayload } from '../services/instagram-best-time.js';
import { getRedisClient, redisService } from '../services/redis.js';
import { assertBrandOwnership, assertInstagramConnected } from '../services/ownership.js';

/**
 * Instagram-specific features that don't have generic equivalents
 *
 * NOTE: Basic Instagram functionality (status, sync, disconnect, publish, insights)
 * is now handled by the generic social platform routes at /api/social/instagram/*
 *
 * This file contains ONLY Instagram-specific features:
 * - Sync status monitoring
 * - Best time to post analytics
 */
const brandsInstagramRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/brands/:brandId/instagram/sync-status
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/instagram/sync-status',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;

      await assertBrandOwnership(userId, brandId);

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
      const { force, count } = request.query as { force?: string; count?: string };

      const brand = await assertBrandOwnership(userId, brandId);
      await assertInstagramConnected(brand.id);

      try {
        const parsedCount =
          typeof count === 'string' && count.trim() ? Math.max(1, parseInt(count, 10)) : undefined;
        const rec = await instagramBestTimeService.getRecommendations(
          brand.id,
          force === 'true',
          parsedCount
        );
        return reply.send(rec);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to get best-time recommendations');
        throw error;
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
      const { count } = request.query as { count?: string };
      const brand = await assertBrandOwnership(userId, brandId);
      await assertInstagramConnected(brand.id);

      try {
        const parsedCount =
          typeof count === 'string' && count.trim() ? Math.max(1, parseInt(count, 10)) : undefined;
        const rec = await instagramBestTimeService.getRecommendations(brand.id, true, parsedCount);
        return reply.send({ success: true, recommendations: rec });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to refresh best-time recommendations');
        throw error;
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
      await assertBrandOwnership(userId, brandId);

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
