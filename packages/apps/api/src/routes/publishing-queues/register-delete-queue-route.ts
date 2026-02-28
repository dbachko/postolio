import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { assertPublishingQueueAccess } from '../../services/ownership.js';
import { publishingQueueScheduler } from '../../services/publishing-queue/queue-scheduler.js';
import { prisma } from './shared.js';

class DefaultQueueNotFoundError extends Error {
  constructor() {
    super('default_queue_not_found');
  }
}

async function moveQueueItemsToDefaultAndDelete(queue: {
  id: string;
  socialAccountId: string;
}): Promise<{ movedItemsCount: number; defaultQueueId: string }> {
  return prisma.$transaction(async (tx) => {
    const defaultQueue = await tx.publishingQueue.findFirst({
      where: {
        socialAccountId: queue.socialAccountId,
        isDefault: true,
        id: { not: queue.id },
      },
      select: { id: true },
    });

    if (!defaultQueue) {
      throw new DefaultQueueNotFoundError();
    }

    const defaultItems = await tx.publishingQueueItem.findMany({
      where: { queueId: defaultQueue.id },
      select: { laneKey: true, position: true },
      orderBy: [{ laneKey: 'asc' }, { position: 'desc' }],
    });
    const maxPositionByLane = new Map<string, number>();
    for (const item of defaultItems) {
      const laneKey = item.laneKey || 'post';
      const previousMax = maxPositionByLane.get(laneKey) ?? 0;
      if (item.position > previousMax) {
        maxPositionByLane.set(laneKey, item.position);
      }
    }

    const queueItems = await tx.publishingQueueItem.findMany({
      where: { queueId: queue.id },
      select: { id: true, laneKey: true, createdAt: true, position: true },
      orderBy: [{ laneKey: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    });

    for (const item of queueItems) {
      const laneKey = item.laneKey || 'post';
      const nextPosition = (maxPositionByLane.get(laneKey) ?? 0) + 1;
      maxPositionByLane.set(laneKey, nextPosition);

      await tx.publishingQueueItem.update({
        where: { id: item.id },
        data: { queueId: defaultQueue.id, position: nextPosition },
      });
    }

    await tx.publishingQueue.delete({ where: { id: queue.id } });
    return { movedItemsCount: queueItems.length, defaultQueueId: defaultQueue.id };
  });
}

function handleDeleteQueueError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof DefaultQueueNotFoundError) {
    return reply.code(409).send({ success: false, error: 'default_queue_not_found' });
  }

  request.log.error({ err: error }, 'Failed to delete publishing queue');
  return reply.code(500).send({ success: false, error: 'failed_to_delete_queue' });
}

export function registerDeleteQueueRoute(fastify: FastifyInstance): void {
  fastify.delete<{ Params: { queueId: string } }>(
    '/queues/:queueId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId } = request.params;
      const queue = await assertPublishingQueueAccess(userId, queueId);

      if (queue.isDefault) {
        return reply.code(400).send({ success: false, error: 'cannot_delete_default_queue' });
      }

      try {
        const moved = await moveQueueItemsToDefaultAndDelete(queue);
        const recompute = await publishingQueueScheduler.recomputeBrandWindow(
          queue.socialAccount.brandId
        );

        return reply.send({
          success: true,
          data: {
            deletedQueueId: queue.id,
            movedItemsCount: moved.movedItemsCount,
            movedToQueueId: moved.defaultQueueId,
          },
          recompute,
        });
      } catch (error) {
        return handleDeleteQueueError(request, reply, error);
      }
    }
  );
}
