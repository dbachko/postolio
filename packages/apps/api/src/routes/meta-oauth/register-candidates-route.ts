import type { FastifyInstance } from 'fastify';

import { assertBrandOwnership } from '../../services/ownership.js';

import {
  buildRedisKeys,
  ensureAuth,
  type CandidatesQuery,
  type MetaConnectCandidate,
  type MetaConnectSession,
  redisService,
} from './shared.js';

function createCandidatesHandler() {
  return async (request: any, reply: any) => {
    try {
      if (!ensureAuth(request, reply)) {
        return;
      }
      const { connectSessionId } = request.query as CandidatesQuery;
      if (!connectSessionId) {
        return reply.code(400).send({ error: 'connectSessionId is required' });
      }

      const { sessionKey, candidatesKey } = buildRedisKeys(connectSessionId);
      const rawSession = await redisService.get(sessionKey);
      if (!rawSession) {
        return reply.code(404).send({ error: 'connect_session_not_found' });
      }

      const session = JSON.parse(rawSession) as MetaConnectSession;
      if (session.userId !== request.user.id) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      await assertBrandOwnership(request.user.id, session.brandId);
      const rawCandidates = await redisService.get(candidatesKey);
      if (!rawCandidates) {
        return reply.code(404).send({ error: 'connect_candidates_not_found' });
      }

      const parsed = JSON.parse(rawCandidates) as {
        candidates: MetaConnectCandidate[];
        expiresAt?: string;
      };
      return reply.send({
        connectSessionId,
        brandId: session.brandId,
        expiresAt: parsed.expiresAt || null,
        candidates: parsed.candidates || [],
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      request.log.error({ err: message }, 'Failed to fetch Meta OAuth candidates');
      return reply.code(500).send({ error: 'failed_to_fetch_candidates', message });
    }
  };
}

export function registerMetaCandidatesRoute(fastify: FastifyInstance) {
  fastify.get<{ Querystring: CandidatesQuery }>(
    '/candidates',
    { preHandler: fastify.authenticate },
    createCandidatesHandler()
  );
}
