import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export default async function configRoutes(fastify: FastifyInstance) {
  // Get WebSocket configuration for frontend
  fastify.get('/api/config/websocket', async (_request: FastifyRequest, reply: FastifyReply) => {
    const wsDomain = process.env.WS_DOMAIN || process.env.ALB_DOMAIN;
    const nodeEnv = process.env.NODE_ENV || 'dev';

    // HARDCODED: Always use postolio.example for WebSocket connections in production
    // This bypasses CloudFront which doesn't support WebSocket protocol
    let wsUrl = '';
    let useRelative = true;

    if (wsDomain) {
      // Use configured WebSocket subdomain (should be postolio.example)
      wsUrl = `wss://${wsDomain}`;
      useRelative = false;
    } else if (nodeEnv === 'prod' || nodeEnv === 'production') {
      // Fallback to hardcoded postolio.example in production
      wsUrl = 'wss://postolio.example';
      useRelative = false;
    }
    // In development, use relative path (frontend will construct the URL)

    return reply.send({
      wsUrl,
      useRelative,
      environment: nodeEnv,
      // Include additional info for debugging
      wsDomain: nodeEnv === 'prod' ? wsDomain : undefined,
    });
  });
}
