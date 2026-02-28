import type { FastifyPluginAsync } from 'fastify';

import { registerBrandCalendarRoute } from './brands/calendar-route.js';
import { registerBrandContentHistoryRoute } from './brands/content-history-route.js';
import { registerBrandContentSeriesRoute } from './brands/content-series-route.js';
import { registerBrandCrudRoutes } from './brands/crud-routes.js';
import { registerBrandInboxIngestRoutes } from './brands/inbox-ingest-routes.js';
import { registerBrandInboxItemsRoute } from './brands/inbox-items-route.js';
import { registerInstagramAuthorizeAliasRoute } from './brands/instagram-authorize-route.js';

const brandsRoutes: FastifyPluginAsync = async (fastify) => {
  registerBrandCrudRoutes(fastify);
  registerBrandCalendarRoute(fastify);
  registerBrandContentSeriesRoute(fastify);
  registerBrandInboxItemsRoute(fastify);
  registerBrandInboxIngestRoutes(fastify);
  registerBrandContentHistoryRoute(fastify);
  registerInstagramAuthorizeAliasRoute(fastify);
};

export default brandsRoutes;
