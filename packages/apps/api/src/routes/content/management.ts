import type { FastifyPluginAsync } from 'fastify';

import { registerApproveContentRoute } from './management/approve-route.js';
import { registerCreateManualContentRoute } from './management/create-manual-route.js';
import { registerDeleteContentRoute } from './management/delete-route.js';
import { registerPendingContentRoute } from './management/pending-route.js';
import { registerRejectContentRoute } from './management/reject-route.js';

const managementRoutes: FastifyPluginAsync = async (fastify) => {
  registerCreateManualContentRoute(fastify);
  registerPendingContentRoute(fastify);
  registerApproveContentRoute(fastify);
  registerRejectContentRoute(fastify);
  registerDeleteContentRoute(fastify);
};

export default managementRoutes;
