import type { FastifyInstance } from 'fastify';

import { verifyContentDeletable } from '../../../services/content-operations/authorization.js';
import { schedulerService } from '../../../services/scheduler.js';
import { prisma, type AuthenticatedRequest } from './shared.js';

export function registerDeleteContentRoute(fastify: FastifyInstance): void {
  fastify.delete<{ Params: { contentId: string } }>(
    '/:contentId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const typedRequest = request as AuthenticatedRequest;
      const userId = typedRequest.user!.id!;
      const { contentId } = request.params;

      const authResult = await verifyContentDeletable(userId, contentId);
      if (!authResult.authorized) {
        return reply
          .code(authResult.error?.includes('published') ? 400 : 404)
          .send({ error: authResult.error });
      }

      const item = await prisma.content.findFirst({
        where: { id: contentId },
        select: { status: true },
      });
      if (!item) {
        return reply.code(404).send({ error: 'Content not found' });
      }

      try {
        if (item.status === 'scheduled') {
          await schedulerService.cancelScheduledPost(contentId);
        }
      } catch (error) {
        request.log.warn({ err: error, contentId }, 'Failed to cancel schedule during delete');
      }

      await prisma.content.delete({ where: { id: contentId } });
      return reply.send({ success: true, deleted: { id: contentId } });
    }
  );
}
