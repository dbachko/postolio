import type { FastifyInstance } from 'fastify';

import { getRedisClient } from '../../../services/redis.js';
import { assertBrandOwnershipIfAuthenticated, prisma } from './shared.js';

const THROTTLE_SECONDS = 15 * 60;

export function registerBrandAccountRefreshRoute(fastify: FastifyInstance) {
  fastify.post('/analytics/brands/:brandId/account/refresh', async (request, reply) => {
    try {
      const { brandId } = request.params as { brandId: string };
      await assertBrandOwnershipIfAuthenticated(request, brandId);

      const redis = getRedisClient();
      const throttleKey = `ingest:account:brand:${brandId}`;
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

        await redis.setex(throttleKey, THROTTLE_SECONDS, '1');
        const accounts = await prisma.socialAccount.findMany({
          where: { brandId },
          select: { id: true },
        });
        for (const account of accounts) {
          await redis.lpush('ingest:queue:accounts', account.id);
        }
      }

      nextAllowed = new Date(Date.now() + THROTTLE_SECONDS * 1000).toISOString();
      return reply.send({ success: true, nextRefreshAllowed: nextAllowed, enqueued: true });
    } catch (error) {
      request.log.error({ error }, 'Failed to enqueue account refresh');
      throw error;
    }
  });
}
