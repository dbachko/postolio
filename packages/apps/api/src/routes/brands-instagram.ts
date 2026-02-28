import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { assertBrandOwnership, assertInstagramConnected } from '../services/ownership.js';
import { instagramBestTimeService, type BestTimePayload } from '../services/instagram-best-time.js';
import { getRedisClient, redisService } from '../services/redis.js';

function parseCount(count: string | undefined): number | undefined {
  return typeof count === 'string' && count.trim() ? Math.max(1, parseInt(count, 10)) : undefined;
}

function registerSyncStatusRoute(fastify: FastifyInstance): void {
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

          const cooldownTtl = await redis.ttl(cooldownKey);
          if (typeof cooldownTtl === 'number' && cooldownTtl > 0) {
            cooldownRemaining = cooldownTtl;
          }
        }
      } catch (error) {
        request.log.warn({ err: error }, 'Failed to query sync status');
      }

      let lastSync: any = null;
      try {
        const metadataJson = await redisService.get(`instagram_sync_metadata:${brandId}`);
        if (metadataJson) {
          const metadata = JSON.parse(metadataJson);
          lastSync = {
            timestamp: metadata.timestamp,
            duration: metadata.duration,
            results: metadata.results,
            options: metadata.options,
          };
        }
      } catch {
        // best-effort metadata lookup
      }

      return reply.send({ inProgress, lockTtl, cooldownRemaining, lastSync });
    }
  );
}

function registerBestTimeRoutes(fastify: FastifyInstance): void {
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
        const recommendations = await instagramBestTimeService.getRecommendations(
          brand.id,
          force === 'true',
          parseCount(count)
        );
        return reply.send(recommendations);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to get best-time recommendations');
        throw error;
      }
    }
  );

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
        const recommendations = await instagramBestTimeService.getRecommendations(
          brand.id,
          true,
          parseCount(count)
        );
        return reply.send({ success: true, recommendations });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to refresh best-time recommendations');
        throw error;
      }
    }
  );

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
      let payload: BestTimePayload | null = null;

      try {
        if (redis) {
          ttl = await redis.ttl(key);
        }

        const cached = await redisService.get(key);
        if (cached) {
          payload = JSON.parse(cached) as BestTimePayload;
        }
      } catch (error) {
        request.log.warn({ err: error }, 'Failed to read cache status');
      }

      return reply.send({
        cacheTTL: ttl,
        cached: Boolean(payload),
        source: payload?.source,
        confidence: payload?.confidence,
        generatedAt: payload?.generatedAt,
        nextRefreshAt: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null,
      });
    }
  );
}

const brandsInstagramRoutes: FastifyPluginAsync = async (fastify) => {
  registerSyncStatusRoute(fastify);
  registerBestTimeRoutes(fastify);
};

export default brandsInstagramRoutes;
