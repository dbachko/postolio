import type { FastifyPluginAsync } from 'fastify';
import { registerGetGroupRoute } from './register-get-group-route.js';
import { registerContentDestinationsRoute } from './register-content-destinations-route.js';
import { registerGroupDestinationsRoute } from './register-group-destinations-route.js';
import { registerGroupTemplateRoute } from './register-group-template-route.js';
import { registerApplyTemplateRoute } from './register-apply-template-route.js';
import { registerResetDestinationRoute } from './register-reset-destination-route.js';
import { registerGroupQueueRoute } from './register-group-queue-route.js';
import { registerGroupScheduleRoute } from './register-group-schedule-route.js';
import { registerGroupPublishNowRoute } from './register-group-publish-now-route.js';
import { registerDeleteGroupRoute } from './register-delete-group-route.js';

const groupsRoutes: FastifyPluginAsync = async (fastify) => {
  registerGetGroupRoute(fastify);
  registerContentDestinationsRoute(fastify);
  registerGroupDestinationsRoute(fastify);
  registerGroupTemplateRoute(fastify);
  registerApplyTemplateRoute(fastify);
  registerResetDestinationRoute(fastify);
  registerGroupQueueRoute(fastify);
  registerGroupScheduleRoute(fastify);
  registerGroupPublishNowRoute(fastify);
  registerDeleteGroupRoute(fastify);
};

export default groupsRoutes;
