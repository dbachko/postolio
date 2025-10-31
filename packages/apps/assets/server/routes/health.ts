import { FastifyPluginAsync } from 'fastify';
import { prismaAssets } from '@postolio/database-assets';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    try {
      // Check database connection
      await prismaAssets.$queryRaw`SELECT 1`;

      return {
        status: 'healthy',
        service: 'asset-library',
        timestamp: new Date().toISOString(),
        database: 'connected',
      };
    } catch (error) {
      fastify.log.error(error);
      reply.code(503).send({
        status: 'unhealthy',
        service: 'asset-library',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
};

export default healthRoutes;
