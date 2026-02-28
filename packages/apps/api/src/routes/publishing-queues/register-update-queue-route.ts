import type { FastifyInstance } from 'fastify';

import { assertPublishingQueueAccess } from '../../services/ownership.js';
import { publishingQueueScheduler } from '../../services/publishing-queue/queue-scheduler.js';
import { normalizeName } from '../publishing-queue-utils.js';
import { isUniqueConstraintError, prisma } from './shared.js';

async function updateQueueDetails(options: {
  queue: Awaited<ReturnType<typeof assertPublishingQueueAccess>>;
  name?: string;
  isDefault?: boolean;
}): Promise<{
  updated: {
    id: string;
    name: string;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  unsetDefaultSiblingCount: number;
}> {
  const { queue, name, isDefault } = options;
  const makingDefault = isDefault === true;

  return prisma.$transaction(async (tx) => {
    let unsetDefaultSiblings = 0;

    if (makingDefault) {
      const unsetDefaultResult = await tx.publishingQueue.updateMany({
        where: {
          socialAccountId: queue.socialAccountId,
          id: { not: queue.id },
          isDefault: true,
        },
        data: { isDefault: false },
      });
      unsetDefaultSiblings = unsetDefaultResult.count;
    }

    const updatedQueue = await tx.publishingQueue.update({
      where: { id: queue.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
      },
      select: {
        id: true,
        name: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      updated: updatedQueue,
      unsetDefaultSiblingCount: unsetDefaultSiblings,
    };
  });
}

export function registerUpdateQueueRoute(fastify: FastifyInstance): void {
  fastify.put<{
    Params: { queueId: string };
    Body: { name?: unknown; isDefault?: unknown };
  }>('/queues/:queueId', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const { queueId } = request.params;
    const queue = await assertPublishingQueueAccess(userId, queueId);

    const name = request.body?.name === undefined ? undefined : normalizeName(request.body?.name);
    const isDefault =
      request.body?.isDefault === undefined ? undefined : Boolean(request.body?.isDefault);

    if (isDefault === false && queue.isDefault) {
      return reply.code(400).send({ success: false, error: 'cannot_unset_default_queue' });
    }
    if (name === null) {
      return reply.code(400).send({ success: false, error: 'invalid_queue_name' });
    }

    try {
      const { updated, unsetDefaultSiblingCount } = await updateQueueDetails({
        queue,
        name,
        isDefault,
      });

      const defaultChanged = isDefault === true && !queue.isDefault;
      const recompute =
        defaultChanged || unsetDefaultSiblingCount > 0
          ? await publishingQueueScheduler.recomputeBrandWindow(queue.socialAccount.brandId)
          : null;

      return reply.send({ success: true, data: { ...updated, recompute } });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.code(409).send({ success: false, error: 'queue_name_taken' });
      }
      request.log.error({ err: error }, 'Failed to update publishing queue');
      return reply.code(500).send({ success: false, error: 'failed_to_update_queue' });
    }
  });
}
