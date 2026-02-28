import type { FastifyInstance } from 'fastify';

import { DELETION_REASONS } from './shared.js';

export function registerDeletionReasonsRoute(fastify: FastifyInstance): void {
  fastify.get('/deletion-reasons', async (_request, reply) => {
    return reply.send({
      reasons: Object.entries(DELETION_REASONS).map(([id, label]) => ({ id, label })),
    });
  });
}
