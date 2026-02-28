import type { FastifyInstance } from 'fastify';

import { verifyContentOwnership } from '../../../services/content-operations/authorization.js';
import { prisma, type AuthenticatedRequest } from './shared.js';

export function registerRejectContentRoute(fastify: FastifyInstance): void {
  fastify.post<{ Params: { contentId: string } }>(
    '/reject/:contentId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const typedRequest = request as AuthenticatedRequest;
        const userId = typedRequest.user!.id!;
        const { contentId } = request.params;

        const authResult = await verifyContentOwnership(userId, contentId);
        if (!authResult.authorized) {
          return reply.code(404).send({ error: authResult.error });
        }

        const updatedContent = await prisma.content.update({
          where: { id: contentId },
          data: { status: 'draft', scheduledAt: null },
          select: { id: true, status: true, updatedAt: true },
        });

        return { content: updatedContent };
      } catch (error) {
        request.log.error({ err: error }, 'Content rejection error');
        throw error;
      }
    }
  );
}
