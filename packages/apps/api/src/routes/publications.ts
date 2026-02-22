import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

const publicationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // List publications for a content item (by platform)
  fastify.get('/publications', async (request, reply) => {
    try {
      const contentId = String((request.query as any)?.contentId || '');
      if (!contentId) {
        return reply.code(400).send({ error: 'contentId is required' });
      }

      const pubs = await prisma.contentPublication.findMany({
        where: { contentId },
        orderBy: { publishedAt: 'desc' },
        select: {
          id: true,
          platform: true,
          permalink: true,
          publishedAt: true,
          externalPostId: true,
          socialAccountId: true,
          metricsLatest: true,
        },
      });

      return reply.send({ success: true, data: pubs });
    } catch (error) {
      request.log.error({ error }, 'Failed to list publications');
      return reply.code(500).send({ error: 'Failed to list publications' });
    }
  });
};

export default publicationsRoutes;
