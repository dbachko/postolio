import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export default async function configRoutes(fastify: FastifyInstance) {
  // Get WebSocket configuration for frontend
  fastify.get('/api/config/websocket', async (_request: FastifyRequest, reply: FastifyReply) => {
    const wsDomain = process.env.WS_DOMAIN || process.env.ALB_DOMAIN;
    const nodeEnv = process.env.NODE_ENV || 'dev';

    // Use dedicated WebSocket subdomain that points directly to ALB
    // This bypasses CloudFront which doesn't support WebSocket protocol
    let wsUrl: string;

    if (wsDomain) {
      // Use configured WebSocket subdomain for direct ALB connection
      wsUrl = `wss://${wsDomain}`;
    } else {
      // Fallback to hardcoded WebSocket subdomain for postolio.example
      wsUrl = 'wss://postolio.example';
    }

    return reply.send({
      wsUrl,
      useRelative: !wsUrl, // If wsUrl is empty, frontend should use relative path
      environment: nodeEnv,
      // Include additional info for debugging
      wsDomain: nodeEnv === 'prod' ? wsDomain : undefined,
    });
  });
}
