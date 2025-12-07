import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../../config/database.js';
import { getRedisClient } from '../../services/redis.js';

const prisma = getDatabaseClient();

export const publicationsAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
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
      throw error;
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
      throw error;
    }
  });
};
