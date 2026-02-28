import type { FastifyInstance } from 'fastify';

import { assertPublishingQueueAccess } from '../../services/ownership.js';
import { publishingQueueScheduler } from '../../services/publishing-queue/queue-scheduler.js';
import { isUniqueConstraintError, prisma } from './shared.js';

async function copySlots(
  targetQueue: { id: string; socialAccountId: string },
  fromQueueId: string
): Promise<void> {
  const fromSlots = await prisma.publishingQueueSlot.findMany({
    where: { queueId: fromQueueId },
    select: { dayOfWeek: true, localTime: true, laneKey: true },
    orderBy: [{ dayOfWeek: 'asc' }, { localTime: 'asc' }],
  });

  await prisma.$transaction(async (tx) => {
    await tx.publishingQueueSlot.deleteMany({ where: { queueId: targetQueue.id } });
    if (fromSlots.length > 0) {
      await tx.publishingQueueSlot.createMany({
        data: fromSlots.map((slot) => ({
          queueId: targetQueue.id,
          socialAccountId: targetQueue.socialAccountId,
          dayOfWeek: slot.dayOfWeek,
          localTime: slot.localTime,
          laneKey: String(slot.laneKey),
          enabled: true,
        })),
      });
    }
  });
}

export function registerCopySlotsFromRoute(fastify: FastifyInstance): void {
  fastify.post<{ Params: { queueId: string }; Body: { fromQueueId?: unknown } }>(
    '/queues/:queueId/copy-slots-from',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId } = request.params;
      const fromQueueId =
        typeof request.body?.fromQueueId === 'string' ? request.body.fromQueueId.trim() : '';
      if (!fromQueueId) {
        return reply.code(400).send({ success: false, error: 'invalid_from_queue' });
      }

      const queue = await assertPublishingQueueAccess(userId, queueId);
      await assertPublishingQueueAccess(userId, fromQueueId);

      try {
        await copySlots(queue, fromQueueId);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return reply.code(409).send({ success: false, error: 'slot_conflict' });
        }
        request.log.error({ err: error }, 'Failed to copy queue slots');
        return reply.code(500).send({ success: false, error: 'failed_to_copy_slots' });
      }

      await publishingQueueScheduler.recomputeBrandWindow(queue.socialAccount.brandId);
      return reply.send({ success: true });
    }
  );
}
