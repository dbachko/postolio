import type { FastifyInstance } from 'fastify';

import { assertBrandOwnership } from '../../services/ownership.js';
import { prisma } from './shared.js';

export function registerBrandContentSeriesRoute(fastify: FastifyInstance): void {
  fastify.get<{ Params: { id: string } }>(
    '/:id/content-series',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId } = request.params;

        await assertBrandOwnership(userId, brandId);

        const series = await prisma.contentSeries.findMany({
          where: { brandId },
          select: {
            id: true,
            key: true,
            name: true,
            description: true,
            color: true,
            kind: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
        });

        return reply.send({ success: true, data: { series } });
      } catch (error) {
        request.log.error({ err: error }, 'Content series list error');
        return reply.code(500).send({ error: 'Failed to retrieve content series' });
      }
    }
  );
}
