import type { FastifyInstance } from 'fastify';

import { assertBrandOwnership } from '../../services/ownership.js';

import { resolveParentOrigin } from './shared.js';

function createMetaAuthorizeProxyUrl(brandId: string, parentOrigin: string | null) {
  const query = new URLSearchParams({ brandId });
  if (parentOrigin) {
    query.set('parentOrigin', parentOrigin);
  }
  return `/api/auth/meta/authorize?${query.toString()}`;
}

function createBrandSocialAccountsMetaAuthorizeHandler(fastify: FastifyInstance) {
  return async (request: any, reply: any) => {
    const { brandId } = request.params as { brandId: string };
    const userId = request.user!.id;
    await assertBrandOwnership(userId, brandId);

    const parentOrigin = resolveParentOrigin({
      origin: request.headers.origin,
      referer: request.headers.referer,
    });
    const proxiedUrl = createMetaAuthorizeProxyUrl(brandId, parentOrigin);

    const proxiedResponse = await fastify.inject({
      method: 'GET',
      url: proxiedUrl,
      headers: { cookie: request.headers.cookie as string },
    });
    return reply.code(proxiedResponse.statusCode).send(proxiedResponse.json());
  };
}

export function registerBrandSocialAccountsMetaAuthorizeRoute(fastify: FastifyInstance) {
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/social-accounts/meta/authorize',
    { preHandler: fastify.authenticate },
    createBrandSocialAccountsMetaAuthorizeHandler(fastify)
  );
}
