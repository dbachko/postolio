/**
 * Content Routes Main Entry Point
 * Registers all content-related sub-routes
 */

import { FastifyPluginAsync } from 'fastify';

import generationRoutes from './generation.js';
import groupsRoutes from './groups.js';
import managementRoutes from './management.js';
import publishNowRoutes from './publish-now.js';
import publishingRoutes from './publishing.js';
import updatesRoutes from './updates.js';
import imagesRoutes from './images.js';
import mediaRoutes from './media.js';
import limitsRoutes from './limits.js';
import seriesRoutes from './series.js';

const contentRoutes: FastifyPluginAsync = async (fastify) => {
  // Register all content sub-routes
  // Each module handles its own endpoints under /api/content

  // Content generation (AI)
  await fastify.register(generationRoutes);

  // Multi-destination content groups
  await fastify.register(groupsRoutes);

  // Content management (CRUD)
  await fastify.register(managementRoutes);

  // Publish-now (platform-aware via scheduler pipeline)
  await fastify.register(publishNowRoutes);

  // Content publishing (Instagram)
  await fastify.register(publishingRoutes);

  // Content updates (edit, schedule)
  await fastify.register(updatesRoutes);

  // Image uploads
  await fastify.register(imagesRoutes);

  // Media attachments (asset-based)
  await fastify.register(mediaRoutes);

  // Subscription limits
  await fastify.register(limitsRoutes);

  // Content series (recipe runs / rolling pipelines)
  await fastify.register(seriesRoutes);
};

export default contentRoutes;
