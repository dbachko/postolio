/**
 * Content Routes Main Entry Point
 * Registers all content-related sub-routes
 */

import { FastifyPluginAsync } from 'fastify';

import generationRoutes from './generation.js';
import managementRoutes from './management.js';
import publishingRoutes from './publishing.js';
import updatesRoutes from './updates.js';
import imagesRoutes from './images.js';
import mediaRoutes from './media.js';
import limitsRoutes from './limits.js';

const contentRoutes: FastifyPluginAsync = async (fastify) => {
  // Register all content sub-routes
  // Each module handles its own endpoints under /api/content

  // Content generation (AI)
  await fastify.register(generationRoutes);

  // Content management (CRUD)
  await fastify.register(managementRoutes);

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
};

export default contentRoutes;
