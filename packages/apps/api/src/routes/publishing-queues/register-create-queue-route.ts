import type { FastifyInstance } from 'fastify';

import { assertSocialAccountAccess } from '../../services/ownership.js';
import { normalizeName } from '../publishing-queue-utils.js';
import { isUniqueConstraintError, prisma } from './shared.js';

export function registerCreateQueueRoute(fastify: FastifyInstance): void {
  fastify.post<{ Params: { socialAccountId: string }; Body: { name?: unknown } }>(
    '/social-accounts/:socialAccountId/queues',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { socialAccountId } = request.params;
      const name = normalizeName(request.body?.name);
      if (!name) {
        return reply.code(400).send({ success: false, error: 'invalid_queue_name' });
      }

      await assertSocialAccountAccess(userId, socialAccountId);

      try {
        const defaultQueueCount = await prisma.publishingQueue.count({
          where: { socialAccountId, isDefault: true },
        });

        const created = await prisma.publishingQueue.create({
          data: {
            socialAccountId,
            name,
            isDefault: defaultQueueCount === 0,
          },
          select: {
            id: true,
            name: true,
            isDefault: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        return reply.send({ success: true, data: created });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return reply.code(409).send({ success: false, error: 'queue_name_taken' });
        }
        request.log.error({ err: error }, 'Failed to create publishing queue');
        return reply.code(500).send({ success: false, error: 'failed_to_create_queue' });
      }
    }
  );
}
