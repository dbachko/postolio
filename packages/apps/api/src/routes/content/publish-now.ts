/**
 * Content Publish-Now Routes
 *
 * Publishing is performed through the scheduler/publisher pipeline so behavior is consistent
 * across scheduled and immediate publishing.
 */

import { FastifyPluginAsync } from 'fastify';

import { getDatabaseClient } from '../../config/database.js';
import { contentSeriesRollingService } from '../../services/content-series-rolling.js';
import { schedulerService } from '../../services/scheduler.js';
import { verifyContentEditable } from '../../services/content-operations/authorization.js';

const prisma = getDatabaseClient();

const publishNowRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/content/:contentId/publish-now
  fastify.post<{ Params: { contentId: string } }>(
    '/:contentId/publish-now',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentId } = request.params;

      const authResult = await verifyContentEditable(userId, contentId);
      if (!authResult.authorized) {
        const isImmutable = Boolean(authResult.error && authResult.error.includes('immutable'));
        return reply.code(isImmutable ? 400 : 404).send({ error: authResult.error });
      }

      const result = await schedulerService.publishNow(contentId, userId);
      if (!result.success) {
        return reply.code(400).send({
          success: false,
          error: result.error || 'Failed to publish now',
        });
      }

      // Best effort: if this post belongs to a rolling-enabled series, enqueue refresh.
      try {
        if (typeof (prisma as any).content?.findFirst === 'function') {
          const content = await prisma.content.findFirst({
            where: { id: contentId },
            select: { contentSeriesId: true },
          });
          if (content?.contentSeriesId) {
            await contentSeriesRollingService.refresh(content.contentSeriesId);
          }
        }
      } catch (error) {
        request.log.warn(
          { err: error, contentId },
          'Failed to trigger rolling refresh after publish-now'
        );
      }

      return reply.send({
        success: true,
        scheduleId: result.scheduleId,
      });
    }
  );
};

export default publishNowRoutes;
