import { FastifyPluginAsync } from 'fastify';

// Lightweight proxy endpoints for account-scoped utilities
const accountRoutes: FastifyPluginAsync = async (fastify) => {
  // Alias for schedule-ahead limits: /api/account/limits/schedule-ahead
  fastify.get(
    '/limits/schedule-ahead',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const r = await fastify.inject({
        method: 'GET',
        url: '/api/content/limits/schedule-ahead',
        headers: { cookie: request.headers.cookie as string },
      });
      return reply.code(r.statusCode).send(r.json());
    }
  );
};

export default accountRoutes;
