import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';

import { assertBrandOwnership } from '../../services/ownership.js';

import {
  buildRedisKeys,
  captureOauthException,
  CONNECT_SESSION_TTL_SECONDS,
  ensureAuth,
  FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET,
  FB_GRAPH_API_VERSION,
  type MetaConnectSession,
  META_REDIRECT_URI,
  normalizeOrigin,
  type AuthorizeQuery,
  redisService,
} from './shared.js';

function validateMetaConfig() {
  return Boolean(FACEBOOK_APP_ID && FACEBOOK_APP_SECRET);
}

function buildMetaAuthUrl(state: string) {
  const scopes = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'business_management',
    'instagram_basic',
    'instagram_manage_insights',
    'instagram_content_publish',
  ].join(',');

  return (
    `https://www.facebook.com/${FB_GRAPH_API_VERSION}/dialog/oauth?` +
    `client_id=${encodeURIComponent(FACEBOOK_APP_ID)}&` +
    `redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `state=${encodeURIComponent(state)}&` +
    `response_type=code&display=popup`
  );
}

async function persistConnectSession(session: MetaConnectSession) {
  const { sessionKey, stateKey } = buildRedisKeys(session.connectSessionId, session.state);
  const [storedSession, storedState] = await Promise.all([
    redisService.set(sessionKey, JSON.stringify(session), CONNECT_SESSION_TTL_SECONDS),
    redisService.set(stateKey!, JSON.stringify(session), CONNECT_SESSION_TTL_SECONDS),
  ]);
  return Boolean(storedSession && storedState);
}

function createAuthorizeHandler(fastify: FastifyInstance) {
  return async (request: any, reply: any) => {
    try {
      if (!ensureAuth(request, reply)) {
        return;
      }
      if (!validateMetaConfig()) {
        return reply.code(500).send({
          error: 'meta_config_missing',
          message: 'FACEBOOK_APP_ID/FACEBOOK_APP_SECRET must be set to use Meta connect',
        });
      }

      const brandId = (request.query as AuthorizeQuery).brandId;
      if (!brandId) {
        return reply.code(400).send({ error: 'brandId is required' });
      }
      await assertBrandOwnership(request.user.id, brandId);

      const connectSessionId = crypto.randomUUID();
      const state = crypto.randomBytes(32).toString('hex');
      const session: MetaConnectSession = {
        connectSessionId,
        userId: request.user.id,
        brandId,
        state,
        parentOrigin: normalizeOrigin((request.query as AuthorizeQuery).parentOrigin),
        createdAt: new Date().toISOString(),
      };
      const persisted = await persistConnectSession(session);
      if (!persisted) {
        return reply.code(500).send({
          error: 'redis_unavailable',
          message: 'Redis is required to start the Meta connect flow',
        });
      }

      return reply.send({
        authUrl: buildMetaAuthUrl(state),
        connectSessionId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      fastify.log.error({ message }, 'Meta OAuth authorize error');
      captureOauthException(error, {
        phase: 'authorize',
        correlationId: request.id,
        userId: request.user?.id,
        brandId: request.query?.brandId,
      });
      return reply.code(500).send({ error: 'Failed to initiate Meta OAuth', message });
    }
  };
}

export function registerMetaAuthorizeRoute(fastify: FastifyInstance) {
  fastify.get<{ Querystring: AuthorizeQuery }>(
    '/authorize',
    { preHandler: fastify.authenticate },
    createAuthorizeHandler(fastify)
  );
}
