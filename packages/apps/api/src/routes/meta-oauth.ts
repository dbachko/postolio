import type { FastifyPluginAsync } from 'fastify';

import { registerMetaAuthorizeRoute } from './meta-oauth/register-authorize-route.js';
import { registerMetaCallbackRoute } from './meta-oauth/register-callback-route.js';
import { registerMetaCandidatesRoute } from './meta-oauth/register-candidates-route.js';
import { registerMetaFinalizeRoute } from './meta-oauth/register-finalize-route.js';

const metaOAuthRoutes: FastifyPluginAsync = async (fastify) => {
  registerMetaAuthorizeRoute(fastify);
  registerMetaCallbackRoute(fastify);
  registerMetaCandidatesRoute(fastify);
  registerMetaFinalizeRoute(fastify);
};

export default metaOAuthRoutes;
