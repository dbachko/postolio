import type { FastifyInstance } from 'fastify';

export function registerInstagramAuthorizeAliasRoute(fastify: FastifyInstance): void {
  fastify.get<{ Params: { id: string } }>(
    '/:id/instagram/authorize',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id } = request.params;
      const response = await fastify.inject({
        method: 'GET',
        url: `/api/auth/instagram/authorize?brandId=${encodeURIComponent(id)}`,
        headers: { cookie: request.headers.cookie as string },
      });

      return reply.code(response.statusCode).send(response.json());
    }
  );
}
