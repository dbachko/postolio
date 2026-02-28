import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getDatabaseClient } from '../config/database.js';
import { getRetentionManager } from '../services/retention-manager.js';

function registerGdprDeleteRoute(app: FastifyInstance): void {
  const retentionManager = getRetentionManager(app);

  app.post(
    '/api/compliance/gdpr-delete',
    { preHandler: app.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user;
        if (!user?.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        app.log.info({ userId: user.id }, 'GDPR deletion request received');
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
}

function registerRetentionStatsRoute(app: FastifyInstance): void {
  const retentionManager = getRetentionManager(app);

  app.get(
    '/api/compliance/retention-stats',
    { preHandler: app.authenticate },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const stats = await retentionManager.getRetentionStats();
        return reply.send(stats);
      } catch (error) {
        app.log.error({ error }, 'Failed to get retention stats');
        return reply.code(500).send({ error: 'Failed to get retention statistics' });
      }
    }
  );
}

function registerProcessRetentionRoute(app: FastifyInstance): void {
  const retentionManager = getRetentionManager(app);

  app.post(
    '/api/compliance/process-retention',
    { preHandler: app.authenticate },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        app.log.info('Manual retention processing triggered');
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
}

function registerDeleteBrandDataRoute(app: FastifyInstance): void {
  const retentionManager = getRetentionManager(app);
  const prisma = getDatabaseClient();

  app.delete<{ Params: { brandId: string } }>(
    '/api/compliance/brand/:brandId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        const user = request.user;
        if (!user?.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const { brandId } = request.params;
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
        await prisma.brand.delete({ where: { id: brandId } });

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

export async function complianceRoutes(app: FastifyInstance) {
  registerGdprDeleteRoute(app);
  registerRetentionStatsRoute(app);
  registerProcessRetentionRoute(app);
  registerDeleteBrandDataRoute(app);
}
