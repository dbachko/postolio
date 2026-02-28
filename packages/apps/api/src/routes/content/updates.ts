import type { FastifyPluginAsync } from 'fastify';

import { registerContentScheduleProxyRoute } from './updates/schedule-proxy-route.js';
import { registerContentUpdateRoute } from './updates/update-route.js';

const updatesRoutes: FastifyPluginAsync = async (fastify) => {
  registerContentUpdateRoute(fastify);
  registerContentScheduleProxyRoute(fastify);
};

export default updatesRoutes;
