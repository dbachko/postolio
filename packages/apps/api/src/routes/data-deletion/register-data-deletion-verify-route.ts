import type { FastifyInstance } from 'fastify';

import { DataDeletionRequestService } from '../../services/data-deletion-request.js';

export function registerDataDeletionVerifyRoute(fastify: FastifyInstance): void {
  fastify.post('/data-deletion-verify', async (request, reply) => {
    const token = (request.body as { token?: string })?.token;
    if (!token || typeof token !== 'string') {
      return reply.code(400).send({ error: 'Verification token is required' });
    }

    const result = await DataDeletionRequestService.verifyToken(token);
    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }

    return reply.send({
      success: true,
      message: result.message,
      recoveryDeadline: result.recoveryDeadline,
    });
  });
}
