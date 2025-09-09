import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export default async function configRoutes(fastify: FastifyInstance) {
  // Get WebSocket configuration for frontend
  fastify.get(
    "/api/config/websocket",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const wsDomain = process.env.WS_DOMAIN || process.env.ALB_DOMAIN;
      const nodeEnv = process.env.NODE_ENV || "development";

      // In production, use dedicated WebSocket subdomain that points directly to ALB
      // This bypasses CloudFront which doesn't support WebSocket protocol
      let wsUrl: string;

      if ((nodeEnv === "production" || nodeEnv === "dev") && wsDomain) {
        // Use WebSocket subdomain for direct ALB connection
        // postolio.example points directly to ALB with proper SSL certificate
        wsUrl = `wss://${wsDomain}`;
      } else {
        // In local development or if WS_DOMAIN not set, use relative path with /ws
        wsUrl = ""; // Empty means use same origin with /ws path (Vite proxy handles it)
      }

      return reply.send({
        wsUrl,
        useRelative: !wsUrl, // If wsUrl is empty, frontend should use relative path
        environment: nodeEnv,
        // Include additional info for debugging
        wsDomain: nodeEnv === "production" ? wsDomain : undefined,
      });
    },
  );
}
