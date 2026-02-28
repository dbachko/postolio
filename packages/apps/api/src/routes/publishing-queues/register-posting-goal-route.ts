import type { FastifyInstance } from 'fastify';

import { assertPublishingQueueAccess } from '../../services/ownership.js';
import {
  buildGoalBasedSlots,
  parsePostsPerWeek,
} from '../../services/publishing-queue/default-schedule.js';
import { publishingQueueScheduler } from '../../services/publishing-queue/queue-scheduler.js';
import { isUniqueConstraintError, prisma } from './shared.js';

async function buildAvailableGoalSlots(
  queue: { id: string; socialAccountId: string },
  postsPerWeek: number
) {
  const desiredSlots = buildGoalBasedSlots(postsPerWeek);
  const occupiedByOtherQueues = await prisma.publishingQueueSlot.findMany({
    where: {
      socialAccountId: queue.socialAccountId,
      queueId: { not: queue.id },
    },
    select: { dayOfWeek: true, localTime: true },
  });

  const occupiedKeys = new Set(
    occupiedByOtherQueues.map((slot) => `${slot.dayOfWeek}:${slot.localTime}`)
  );

  return {
    desiredSlots,
    nextSlots: desiredSlots.filter(
      (slot) => !occupiedKeys.has(`${slot.dayOfWeek}:${slot.localTime}`)
    ),
  };
}

async function applyPostingGoalSlots(
  queue: { id: string; socialAccountId: string },
  nextSlots: Array<{ dayOfWeek: number; localTime: string; laneKey: string }>
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.publishingQueueSlot.deleteMany({ where: { queueId: queue.id } });
    await tx.publishingQueueSlot.createMany({
      data: nextSlots.map((slot) => ({
        queueId: queue.id,
        socialAccountId: queue.socialAccountId,
        dayOfWeek: slot.dayOfWeek,
        localTime: slot.localTime,
        laneKey: slot.laneKey,
        enabled: true,
      })),
    });
  });
}

export function registerPostingGoalRoute(fastify: FastifyInstance): void {
  fastify.post<{
    Params: { queueId: string };
    Body: { postsPerWeek?: unknown };
  }>(
    '/queues/:queueId/posting-goal',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId } = request.params;
      const queue = await assertPublishingQueueAccess(userId, queueId);

      const postsPerWeek = parsePostsPerWeek(request.body?.postsPerWeek);
      if (postsPerWeek === null) {
        return reply.code(400).send({ success: false, error: 'invalid_posts_per_week' });
      }

      const { desiredSlots, nextSlots } = await buildAvailableGoalSlots(queue, postsPerWeek);
      if (nextSlots.length === 0) {
        return reply.code(409).send({ success: false, error: 'no_available_slots' });
      }

      try {
        await applyPostingGoalSlots(queue, nextSlots);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return reply.code(409).send({ success: false, error: 'slot_conflict' });
        }
        request.log.error({ err: error }, 'Failed to apply posting goal');
        return reply.code(500).send({ success: false, error: 'failed_to_apply_posting_goal' });
      }

      await publishingQueueScheduler.recomputeBrandWindow(queue.socialAccount.brandId);

      return reply.send({
        success: true,
        data: {
          postsPerWeek,
          requestedSlots: desiredSlots.length,
          createdSlots: nextSlots.length,
          conflictingSlots: desiredSlots.length - nextSlots.length,
          slots: nextSlots,
        },
      });
    }
  );
}
