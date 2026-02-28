import type { FastifyInstance } from 'fastify';

import { DataDeletionRequestService } from '../../services/data-deletion-request.js';
import { type DeletionRequest, isDeletionReason, logRouteError } from './shared.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mapRequestFailureStatus(errorMessage: string | undefined): number {
  return errorMessage === 'No account found with this email address' ? 404 : 500;
}

export function registerDataDeletionRequestRoute(fastify: FastifyInstance): void {
  fastify.post('/data-deletion-request', async (request, reply) => {
    const body = request.body as DeletionRequest;
    if (!body.email || typeof body.email !== 'string' || !EMAIL_REGEX.test(body.email)) {
      return reply.code(400).send({ error: 'Invalid email format' });
    }

    if (body.reason !== undefined && !isDeletionReason(body.reason)) {
      return reply.code(400).send({ error: 'Invalid deletion reason' });
    }

    if (body.source !== 'user' && body.source !== 'meta' && body.source !== 'legal') {
      return reply.code(400).send({ error: 'Invalid deletion source' });
    }

    try {
      const result = await DataDeletionRequestService.sendVerification({
        email: body.email,
        source: body.source,
        reason: body.reason,
      });
      if (!result.success) {
        return reply.code(mapRequestFailureStatus(result.error)).send({ error: result.error });
      }

      return reply.send({
        success: true,
        message: result.message ?? 'Verification email sent. Please check your inbox.',
      });
    } catch (error: unknown) {
      logRouteError(fastify.log, error, 'Data deletion request error:');
      return reply.code(500).send({ error: 'Failed to process deletion request' });
    }
  });
}
