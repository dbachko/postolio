import type { FastifyPluginAsync } from 'fastify';
import { registerBulkRoutes } from './assets/bulk-routes.js';
import { registerImportRoutes } from './assets/import-routes.js';
import { registerItemRoutes } from './assets/item-routes.js';
import { registerListRoutes } from './assets/list-routes.js';
import { registerUploadRoutes } from './assets/upload-routes.js';

const assetsRoutes: FastifyPluginAsync = async (fastify) => {
  registerUploadRoutes(fastify);
  registerListRoutes(fastify);
  registerItemRoutes(fastify);
  registerBulkRoutes(fastify);
  registerImportRoutes(fastify);
};

export default assetsRoutes;
