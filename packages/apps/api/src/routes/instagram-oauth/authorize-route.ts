import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';

import { assertBrandOwnership } from '../../services/ownership.js';
import {
  FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET,
  REDIRECT_URI,
  captureOauthException,
  ensureAuth,
  prisma,
  type AuthorizeQuery,
} from './shared.js';

const OAUTH_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
  'instagram_manage_insights',
  'instagram_content_publish',
].join(',');

function buildOAuthUrl(state: string) {
  return (
    `https://www.facebook.com/dialog/oauth?` +
    `client_id=${FACEBOOK_APP_ID}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `scope=${encodeURIComponent(OAUTH_SCOPES)}&` +
    `state=${state}&` +
    `response_type=code`
  );
}

export function registerInstagramOAuthAuthorizeRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: AuthorizeQuery }>(
    '/authorize',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }

        if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
          return reply.status(503).send({ error: 'Instagram connection is not configured' });
        }

        const { brandId } = request.query;
        if (!brandId) {
          return reply.status(400).send({ error: 'brandId is required' });
        }

        const brand = await assertBrandOwnership(request.user.id, brandId);
        const state = crypto.randomBytes(32).toString('hex');

        await prisma.brand.update({
          where: { id: brandId },
          data: {
            preferences: {
              ...(typeof brand.preferences === 'object' && brand.preferences
                ? brand.preferences
                : {}),
              oauthState: state,
              oauthStateExpires: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            },
          },
        });

        return reply.send({ authUrl: buildOAuthUrl(state), state });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        fastify.log.error({ message }, 'OAuth authorization error:');
        captureOauthException(error, {
          phase: 'authorize',
          correlationId: request.id,
          userId: (request as any)?.user?.id,
          brandId: request.query?.brandId,
        });
        return reply.status(500).send({
          error: 'Failed to initiate OAuth authorization',
          message,
        });
      }
    }
  );
}
