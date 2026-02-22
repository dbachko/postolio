import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getRetentionManager } from '../services/retention-manager.js';
import { getDatabaseClient } from '../config/database.js';

export async function complianceRoutes(app: FastifyInstance) {
  const retentionManager = getRetentionManager(app);
  const prisma = getDatabaseClient();

  // GDPR - Delete all user data
  app.post(
    '/api/compliance/gdpr-delete',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user;
        if (!user?.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        // Log the deletion request for compliance
        app.log.info({ userId: user.id }, 'GDPR deletion request received');

        // Process the deletion
        const result = await retentionManager.deleteUserData(user.id);

        return reply.send({
          success: true,
          message: 'Your data has been deleted in compliance with GDPR',
          ...result,
        });
      } catch (error) {
        app.log.error({ error }, 'GDPR deletion failed');
        return reply.code(500).send({
          error: 'Failed to process deletion request',
          message: 'Please contact support for assistance',
        });
      }
    }
  );

  // Get retention statistics (admin only)
  app.get(
    '/api/compliance/retention-stats',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const stats = await retentionManager.getRetentionStats();
        return reply.send(stats);
      } catch (error) {
        app.log.error({ error }, 'Failed to get retention stats');
        return reply.code(500).send({ error: 'Failed to get retention statistics' });
      }
    }
  );

  // Manual trigger for retention processing (admin only)
  app.post(
    '/api/compliance/process-retention',
    {
      preHandler: app.authenticate,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // In production, add admin role check here

        app.log.info('Manual retention processing triggered');

        // Run asynchronously
        setImmediate(() => {
          retentionManager.triggerRetentionProcessing();
        });

        return reply.send({
          success: true,
          message: 'Retention processing started in background',
        });
      } catch (error) {
        app.log.error({ error }, 'Failed to trigger retention processing');
        return reply.code(500).send({ error: 'Failed to trigger retention processing' });
      }
    }
  );

  // Delete specific brand data
  app.delete<{ Params: { brandId: string } }>(
    '/api/compliance/brand/:brandId',
    {
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      try {
        const user = request.user;
        if (!user?.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const { brandId } = request.params;

        // Verify user owns the brand
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: user.id,
          },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found or unauthorized' });
        }

        const result = await retentionManager.deleteBrandData(brandId);

        // Delete the brand itself
        await prisma.brand.delete({
          where: { id: brandId },
        });

        return reply.send({
          success: true,
          message: 'Brand and all associated data deleted',
          ...result,
        });
      } catch (error) {
        app.log.error({ err: error }, 'Brand deletion failed');
        throw error;
      }
    }
  );
}
