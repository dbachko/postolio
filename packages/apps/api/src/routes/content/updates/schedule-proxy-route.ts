import type { FastifyInstance } from 'fastify';

export function registerContentScheduleProxyRoute(fastify: FastifyInstance): void {
  fastify.post<{ Params: { contentId: string }; Body: { scheduledAt?: string } }>(
    '/:contentId/schedule',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const contentId = request.params.contentId;
      const scheduledAt = request.body?.scheduledAt;

      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (typeof request.headers.cookie === 'string') {
        headers.cookie = request.headers.cookie;
      }
      if (typeof request.headers.authorization === 'string') {
        headers.authorization = request.headers.authorization;
      }
      if (typeof request.headers['csrf-token'] === 'string') {
        headers['csrf-token'] = request.headers['csrf-token'];
      }

      const response = await fastify.inject({
        method: 'PUT',
        url: `/api/content/${encodeURIComponent(contentId)}`,
        payload: { scheduledAt },
        headers,
      });

      return reply.code(response.statusCode).send(response.json());
    }
  );
}
