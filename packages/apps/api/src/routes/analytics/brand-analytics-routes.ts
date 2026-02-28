import type { FastifyPluginAsync } from 'fastify';

import { registerBrandAccountRefreshRoute } from './brand-analytics/register-account-refresh-route.js';
import { registerBrandAccountSeriesRoute } from './brand-analytics/register-account-series-route.js';
import { registerBrandAudienceRoute } from './brand-analytics/register-audience-route.js';
import { registerBrandHashtagsRoute } from './brand-analytics/register-hashtags-route.js';
import { registerBrandPostsRoute } from './brand-analytics/register-posts-route.js';
import { registerBrandSummaryRoute } from './brand-analytics/register-summary-route.js';
import { registerBrandTopPublicationsRoute } from './brand-analytics/register-top-publications-route.js';

export const brandAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  registerBrandSummaryRoute(fastify);
  registerBrandAccountSeriesRoute(fastify);
  registerBrandTopPublicationsRoute(fastify);
  registerBrandAccountRefreshRoute(fastify);
  registerBrandHashtagsRoute(fastify);
  registerBrandAudienceRoute(fastify);
  registerBrandPostsRoute(fastify);
};
