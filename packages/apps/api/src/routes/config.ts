import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export default async function configRoutes(fastify: FastifyInstance) {
  // Get WebSocket configuration for frontend
  fastify.get('/api/config/websocket', async (_request: FastifyRequest, reply: FastifyReply) => {
    const nodeEnv = process.env.NODE_ENV || 'dev';

    // Always use relative path - let frontend construct WebSocket URL
    // CloudFront handles WebSocket connections through /ws path
    return reply.send({
      wsUrl: '',
      useRelative: true,
      environment: nodeEnv,
    });
  });
}
