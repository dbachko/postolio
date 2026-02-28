import type { FastifyInstance } from 'fastify';

import { assertPublishingQueueAccess } from '../../services/ownership.js';
import { prisma } from './shared.js';

export function registerListQueueSlotsRoute(fastify: FastifyInstance): void {
  fastify.get<{ Params: { queueId: string } }>(
    '/queues/:queueId/slots',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId } = request.params;
      const queue = await assertPublishingQueueAccess(userId, queueId);

      const slots = await prisma.publishingQueueSlot.findMany({
        where: { queueId: queue.id },
        select: {
          id: true,
          dayOfWeek: true,
          localTime: true,
          laneKey: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ dayOfWeek: 'asc' }, { localTime: 'asc' }],
      });

      return reply.send({
        success: true,
        data: {
          queueId: queue.id,
          socialAccountId: queue.socialAccountId,
          slots: slots.map((slot) => ({
            id: slot.id,
            dayOfWeek: slot.dayOfWeek,
            localTime: slot.localTime,
            laneKey: slot.laneKey,
            createdAt: slot.createdAt,
            updatedAt: slot.updatedAt,
          })),
        },
      });
    }
  );
}
