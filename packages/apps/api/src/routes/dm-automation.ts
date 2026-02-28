/**
 * DM Automation CRUD API Routes
 * Manages automation rules, analytics, and conversations
 */

import type { FastifyPluginAsync } from 'fastify';
import { registerDmAutomationAnalyticsRoutes } from './dm-automation/analytics-routes.js';
import { registerDmAutomationConversationRoutes } from './dm-automation/conversations-routes.js';
import { registerDmAutomationRuleRoutes } from './dm-automation/rules-routes.js';

const dmAutomationRoutes: FastifyPluginAsync = async (fastify) => {
  registerDmAutomationRuleRoutes(fastify);
  registerDmAutomationAnalyticsRoutes(fastify);
  registerDmAutomationConversationRoutes(fastify);
};

export default dmAutomationRoutes;
