import type { FastifyPluginAsync } from 'fastify';

import { registerBrandSocialAccountsDefaultRoute } from './brands-social-accounts/register-defaults-route.js';
import { registerBrandSocialAccountsDisconnectRoute } from './brands-social-accounts/register-disconnect-route.js';
import { registerBrandSocialAccountsListRoute } from './brands-social-accounts/register-list-route.js';
import { registerBrandSocialAccountsMetaAuthorizeRoute } from './brands-social-accounts/register-meta-authorize-route.js';
import { registerBrandSocialAccountsOrderRoute } from './brands-social-accounts/register-order-route.js';

const brandsSocialAccountsRoutes: FastifyPluginAsync = async (fastify) => {
  registerBrandSocialAccountsListRoute(fastify);
  registerBrandSocialAccountsDefaultRoute(fastify);
  registerBrandSocialAccountsOrderRoute(fastify);
  registerBrandSocialAccountsMetaAuthorizeRoute(fastify);
  registerBrandSocialAccountsDisconnectRoute(fastify);
};

export default brandsSocialAccountsRoutes;
