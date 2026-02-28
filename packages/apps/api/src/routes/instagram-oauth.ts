import type { FastifyPluginAsync } from 'fastify';

import { registerInstagramOAuthAuthorizeRoute } from './instagram-oauth/authorize-route.js';
import { registerInstagramOAuthCallbackRoute } from './instagram-oauth/callback-route.js';

const instagramOAuthRoutes: FastifyPluginAsync = async (fastify) => {
  registerInstagramOAuthAuthorizeRoute(fastify);
  registerInstagramOAuthCallbackRoute(fastify);
};

export default instagramOAuthRoutes;
