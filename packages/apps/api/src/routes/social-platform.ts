import type { FastifyInstance } from 'fastify';

import { registerSocialDisconnectRoute } from './social-platform/register-disconnect-route.js';
import { registerSocialHealthRoute } from './social-platform/register-health-route.js';
import { registerSocialInsightsRoute } from './social-platform/register-insights-route.js';
import { registerSocialPublishRoute } from './social-platform/register-publish-route.js';
import { registerSocialStatusRoute } from './social-platform/register-status-route.js';
import { registerSocialSyncRoute } from './social-platform/register-sync-route.js';

/**
 * Generic social platform routes.
 *
 * Route handlers are split into focused modules under `routes/social-platform/*`
 * to keep registration composition thin and enforce max-lines constraints.
 */
export async function socialPlatformRoutes(app: FastifyInstance) {
  registerSocialHealthRoute(app);
  registerSocialStatusRoute(app);
  registerSocialPublishRoute(app);
  registerSocialSyncRoute(app);
  registerSocialDisconnectRoute(app);
  registerSocialInsightsRoute(app);
}
