import type { FastifyPluginAsync } from 'fastify';

import { registerSocialAccountAiInsightsRoute } from './social-account-analytics/register-ai-insights-route.js';
import { registerSocialAccountForecastingRoute } from './social-account-analytics/register-forecasting-route.js';
import { registerSocialAccountHealthRoute } from './social-account-analytics/register-health-route.js';
import { registerSocialAccountPostsRoute } from './social-account-analytics/register-posts-route.js';
import { registerSocialAccountRecommendationsRoute } from './social-account-analytics/register-recommendations-route.js';
import { registerSocialAccountRefreshRoute } from './social-account-analytics/register-refresh-route.js';
import { registerSocialAccountSeriesRoute } from './social-account-analytics/register-series-route.js';
import { registerSocialAccountSummaryRoute } from './social-account-analytics/register-summary-route.js';

export const socialAccountAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  registerSocialAccountSummaryRoute(fastify);
  registerSocialAccountSeriesRoute(fastify);
  registerSocialAccountPostsRoute(fastify);
  registerSocialAccountRefreshRoute(fastify);
  registerSocialAccountHealthRoute(fastify);
  registerSocialAccountAiInsightsRoute(fastify);
  registerSocialAccountForecastingRoute(fastify);
  registerSocialAccountRecommendationsRoute(fastify);
};
