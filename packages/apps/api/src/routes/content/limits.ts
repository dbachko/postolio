/**
 * Content Limits Routes
 * Handles subscription limits and quotas for content operations
 */

import { FastifyPluginAsync } from 'fastify';

import { getDatabaseClient } from '../../config/database.js';
import { isDemoBrand } from '../../utils/demo-brand.js';

const prisma = getDatabaseClient();

const limitsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get schedule-ahead limit status for current user (account-wide)
  fastify.get(
    '/limits/schedule-ahead',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return reply.code(404).send({ success: false, error: 'User not found' });

        const { getMaxScheduledAheadForTier } = await import('../../constants/subscription.js');
        const maxAllowed = getMaxScheduledAheadForTier(user.subscriptionTier || 'free');

        // Only count scheduled/draft posts for non-demo brands.
        const brands = await prisma.brand.findMany({
          where: { userId },
          select: { id: true, preferences: true },
        });
        const realBrandIds = brands.filter((b) => !isDemoBrand(b.preferences)).map((b) => b.id);

        const now = new Date();
        const currentCount =
          realBrandIds.length === 0
            ? 0
            : await prisma.content.count({
                where: {
                  brandId: { in: realBrandIds },
                  scheduledAt: { gte: now },
                  status: { in: ['scheduled', 'draft'] },
                },
              });

        return reply.send({
          success: true,
          data: {
            tier: user.subscriptionTier || 'free',
            maxAllowed,
            currentCount,
          },
        });
      } catch (error) {
        request.log.error({ err: error }, 'Limits status error');
        return reply.code(500).send({ success: false, error: 'Failed to get limit status' });
      }
    }
  );
};

export default limitsRoutes;
