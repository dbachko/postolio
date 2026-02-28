import type { FastifyInstance } from 'fastify';

import { assertPublishingQueueAccess } from '../../services/ownership.js';
import { publishingQueueScheduler } from '../../services/publishing-queue/queue-scheduler.js';
import { schedulerService } from '../../services/scheduler.js';
import { broadcastQueueItemStatusChange, prisma } from './shared.js';

export function registerDeleteQueueItemRoute(fastify: FastifyInstance): void {
  fastify.delete<{ Params: { queueId: string; itemId: string } }>(
    '/queues/:queueId/items/:itemId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId, itemId } = request.params;
      const queue = await assertPublishingQueueAccess(userId, queueId);

      const item = await prisma.publishingQueueItem.findFirst({
        where: { id: itemId, queueId: queue.id },
        include: { content: { select: { id: true, status: true } } },
      });
      if (!item) {
        return reply.code(404).send({ success: false, error: 'queue_item_not_found' });
      }

      const cancelled =
        item.content?.status === 'scheduled'
          ? await schedulerService.cancelScheduledPost(item.content.id)
          : { success: true };
      if (!cancelled.success) {
        return reply.code(500).send({ success: false, error: cancelled.error || 'cancel_failed' });
      }

      await prisma.publishingQueueItem.delete({ where: { id: item.id } });
      const recompute = await publishingQueueScheduler.recomputeBrandWindow(
        queue.socialAccount.brandId
      );

      if (item.content?.id) {
        void broadcastQueueItemStatusChange({
          contentId: item.content.id,
          brandId: queue.socialAccount.brandId,
          status: item.content.status,
          action: 'removed',
          queueId: queue.id,
        });
      }

      return reply.send({ success: true, data: { recompute } });
    }
  );
}
