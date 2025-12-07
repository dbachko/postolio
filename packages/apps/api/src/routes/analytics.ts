import type { FastifyPluginAsync } from 'fastify';
import { schedulerAnalyticsRoutes } from './analytics/scheduler-routes.js';
import { wizardAnalyticsRoutes } from './analytics/wizard-routes.js';
import { publicationsAnalyticsRoutes } from './analytics/publications-routes.js';
import { brandAnalyticsRoutes } from './analytics/brand-analytics-routes.js';
import { campaignAnalyticsRoutes } from './analytics/campaign-analytics-routes.js';

const analytics: FastifyPluginAsync = async function (fastify) {
  // Scheduler + wizard + analytics v2 compose under one plugin
  fastify.register(schedulerAnalyticsRoutes);
  fastify.register(wizardAnalyticsRoutes);
  fastify.register(publicationsAnalyticsRoutes);
  fastify.register(brandAnalyticsRoutes);
  fastify.register(campaignAnalyticsRoutes);
};

export default analytics;
