import type { FastifyInstance } from 'fastify';

import { getRedisClient } from '../../../services/redis.js';
import { prisma, resolveSocialAccountForUser } from './shared.js';

const THROTTLE_SECONDS = 15 * 60;

export function registerSocialAccountRefreshRoute(fastify: FastifyInstance) {
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
      if (redis) {
        const ttl = await redis.ttl(throttleKey);
        if (ttl > 0) {
          return reply.code(429).send({
            success: false,
            error: 'Refresh recently requested',
            nextRefreshAllowed: new Date(Date.now() + ttl * 1000).toISOString(),
          });
        }

        await redis.setex(throttleKey, THROTTLE_SECONDS, '1');
        await redis.lpush('ingest:queue:accounts', socialAccountId);
        if (includePublications) {
          const recent = await prisma.contentPublication.findMany({
            where: { socialAccountId, publishedAt: { not: null } },
            orderBy: [{ updatedAt: 'desc' }],
            take: 25,
            select: { id: true },
          });
          for (const publication of recent) {
            await redis.lpush('ingest:queue:publications', publication.id);
          }
        }
      }

      return reply.send({
        success: true,
        nextRefreshAllowed: new Date(Date.now() + THROTTLE_SECONDS * 1000).toISOString(),
        enqueued: true,
      });
    }
  );
}
