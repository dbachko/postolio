import { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // Dev-only DB inspector: s3 keys
  fastify.get('/db/s3-keys', async (request, reply) => {
    // Block in production for safety
    if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
      return reply.code(404).send({ error: 'Not found' });
    }

    try {
      const { contentId, limit } = (request.query || {}) as {
        contentId?: string;
        limit?: string;
      };

      if (contentId) {
        const rec = await prisma.content.findUnique({
          where: { id: contentId },
          select: {
            id: true,
            brandId: true,
            caption: true,
            s3ImageKey: true,
            imageRegion: true,
            scheduledAt: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        return reply.send({ content: rec });
      }

      const take = Math.min(Math.max(parseInt(limit || '10', 10) || 10, 1), 100);
      const count = await prisma.content.count({ where: { s3ImageKey: { not: null } } });
      const rows = await prisma.content.findMany({
        where: { s3ImageKey: { not: null } },
        orderBy: { createdAt: 'desc' },
        take,
        select: { id: true, s3ImageKey: true, createdAt: true },
      });
      return reply.send({ count, sample: rows });
    } catch (err) {
      fastify.log.error({ err }, 'DB inspector failed');
      return reply.code(500).send({ error: 'Inspector error' });
    }
  });
};

export default adminRoutes;

