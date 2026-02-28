import type { FastifyPluginAsync } from 'fastify';

import {
  registerBatchRoute,
  registerBulkAssetsRoute,
  registerCreateAssetRoute,
  registerDeleteAssetRoute,
  registerGetAssetRoute,
  registerUpdateAssetRoute,
  registerUploadUrlRoute,
  registerUsageRoute,
} from './assets-proxy/register-asset-crud-routes.js';
import { registerListAssetsRoute } from './assets-proxy/register-list-assets-route.js';
import {
  registerArchiveTaxonomyRoute,
  registerCreateTaxonomyRoute,
  registerDeleteTaxonomyRoute,
  registerListTaxonomyRoute,
  registerMergeLabelsRoute,
  registerUnarchiveTaxonomyRoute,
  registerUpdateTaxonomyRoute,
} from './assets-proxy/register-taxonomy-routes.js';

export const assetsProxyRoutes: FastifyPluginAsync = async (fastify) => {
  registerUploadUrlRoute(fastify);
  registerCreateAssetRoute(fastify);
  registerListAssetsRoute(fastify);
  registerListTaxonomyRoute(fastify);
  registerCreateTaxonomyRoute(fastify);
  registerUpdateTaxonomyRoute(fastify);
  registerDeleteTaxonomyRoute(fastify);
  registerArchiveTaxonomyRoute(fastify);
  registerUnarchiveTaxonomyRoute(fastify);
  registerMergeLabelsRoute(fastify);
  registerBulkAssetsRoute(fastify);
  registerUsageRoute(fastify);
  registerBatchRoute(fastify);
  registerGetAssetRoute(fastify);
  registerUpdateAssetRoute(fastify);
  registerDeleteAssetRoute(fastify);
};

export default assetsProxyRoutes;
