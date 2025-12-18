/**
 * Content Publish-Now Routes
 *
 * Publishing is performed through the scheduler/publisher pipeline so behavior is consistent
 * across scheduled and immediate publishing.
 */

import { FastifyPluginAsync } from 'fastify';

import { schedulerService } from '../../services/scheduler.js';
import { verifyContentEditable } from '../../services/content-operations/authorization.js';

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

      const campaignStatus = authResult.data?.campaignStatus;
      if (authResult.data?.campaignId && campaignStatus && campaignStatus !== 'active') {
        return reply.code(400).send({
          error: 'campaign_not_active',
          message: `Cannot publish content for a ${String(campaignStatus).toLowerCase()} campaign`,
        });
      }

      const result = await schedulerService.publishNow(contentId, userId);
      if (!result.success) {
        return reply.code(400).send({
          success: false,
          error: result.error || 'Failed to publish now',
        });
      }

      return reply.send({
        success: true,
        scheduleId: result.scheduleId,
      });
    }
  );
};

export default publishNowRoutes;
