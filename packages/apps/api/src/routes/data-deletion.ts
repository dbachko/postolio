import type { FastifyInstance } from 'fastify';

import { registerAccountDeleteRoute } from './data-deletion/register-account-delete-route.js';
import { registerAccountRecoveryRoute } from './data-deletion/register-account-recovery-route.js';
import { registerDataDeletionPageRoute } from './data-deletion/register-data-deletion-page-route.js';
import { registerDataDeletionRequestRoute } from './data-deletion/register-data-deletion-request-route.js';
import { registerDataDeletionVerifyRoute } from './data-deletion/register-data-deletion-verify-route.js';
import { registerDeletionReasonsRoute } from './data-deletion/register-deletion-reasons-route.js';
import { registerMetaDeletionCallbackRoute } from './data-deletion/register-meta-deletion-callback-route.js';

export default async function dataDeletionRoutes(fastify: FastifyInstance) {
  registerDataDeletionPageRoute(fastify);
  registerDataDeletionRequestRoute(fastify);
  registerDataDeletionVerifyRoute(fastify);
  registerAccountDeleteRoute(fastify);
  registerAccountRecoveryRoute(fastify);
  registerMetaDeletionCallbackRoute(fastify);
  registerDeletionReasonsRoute(fastify);
}
