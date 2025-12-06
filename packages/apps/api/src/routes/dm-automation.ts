/**
 * DM Automation CRUD API Routes
 * Manages automation rules, analytics, and conversations
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { logger as baseLogger } from '@postolio/logger';
import {
  createRuleSchema,
  updateRuleSchema,
  analyticsQuerySchema,
  type CreateRuleInput,
  type UpdateRuleInput,
  type AnalyticsQuery,
} from '../schemas/dm-automation.js';

const logger = baseLogger.child({ module: 'dm-automation-routes' });

const dmAutomationRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/brands/:brandId/dm-automation/rules
   * List all automation rules for a brand
   */
  fastify.get<{ Params: { brandId: string } }>(
    '/brands/:brandId/dm-automation/rules',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;

      try {
        // Verify brand ownership
        const brand = await prisma.brand.findFirst({
          where: { id: brandId, userId },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        // Fetch all rules
        const rules = await prisma.dMAutomationRule.findMany({
          where: { brandId },
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        });

        logger.info('Fetched DM automation rules', {
          brandId,
          ruleCount: rules.length,
          userId,
        });

        return reply.send({ rules });
      } catch (error) {
        logger.error('Error fetching DM automation rules', {
          brandId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to fetch rules' });
      }
    }
  );

  /**
   * POST /api/brands/:brandId/dm-automation/rules
   * Create a new automation rule
   */
  fastify.post<{ Params: { brandId: string }; Body: CreateRuleInput }>(
    '/brands/:brandId/dm-automation/rules',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;

      try {
        // Validate request body
        const data = createRuleSchema.parse(request.body);

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({
          where: { id: brandId, userId },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        // Create rule
        const rule = await prisma.dMAutomationRule.create({
          data: {
            ...data,
            brandId,
            createdBy: userId,
            triggerConfig: data.triggerConfig as any,
            activeHours: data.activeHours as any,
          },
        });

        logger.info('Created DM automation rule', {
          brandId,
          ruleId: rule.id,
          ruleName: rule.name,
          userId,
        });

        return reply.code(201).send({ rule });
      } catch (error) {
        if (error instanceof Error && error.name === 'ZodError') {
          logger.warn('Validation error creating rule', {
            brandId,
            error: error.message,
          });
          return reply.code(400).send({ error: 'Invalid request data', details: error });
        }

        logger.error('Error creating DM automation rule', {
          brandId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to create rule' });
      }
    }
  );

  /**
   * PATCH /api/brands/:brandId/dm-automation/rules/:id
   * Update an existing automation rule
   */
  fastify.patch<{ Params: { brandId: string; id: string }; Body: UpdateRuleInput }>(
    '/brands/:brandId/dm-automation/rules/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId, id } = request.params;
      const userId = request.user!.id;

      try {
        // Validate request body
        const data = updateRuleSchema.parse(request.body);

        // Verify rule exists and user owns the brand
        const existingRule = await prisma.dMAutomationRule.findFirst({
          where: {
            id,
            brandId,
            brand: { userId },
          },
        });

        if (!existingRule) {
          return reply.code(404).send({ error: 'Rule not found' });
        }

        // Update rule
        const rule = await prisma.dMAutomationRule.update({
          where: { id },
          data: {
            ...data,
            triggerConfig: data.triggerConfig as any,
            activeHours: data.activeHours as any,
          },
        });

        logger.info('Updated DM automation rule', {
          brandId,
          ruleId: rule.id,
          ruleName: rule.name,
          userId,
        });

        return reply.send({ rule });
      } catch (error) {
        if (error instanceof Error && error.name === 'ZodError') {
          logger.warn('Validation error updating rule', {
            brandId,
            ruleId: id,
            error: error.message,
          });
          return reply.code(400).send({ error: 'Invalid request data', details: error });
        }

        logger.error('Error updating DM automation rule', {
          brandId,
          ruleId: id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to update rule' });
      }
    }
  );

  /**
   * DELETE /api/brands/:brandId/dm-automation/rules/:id
   * Archive an automation rule (soft delete)
   */
  fastify.delete<{ Params: { brandId: string; id: string } }>(
    '/brands/:brandId/dm-automation/rules/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId, id } = request.params;
      const userId = request.user!.id;

      try {
        // Verify rule exists and user owns the brand
        const rule = await prisma.dMAutomationRule.findFirst({
          where: {
            id,
            brandId,
            brand: { userId },
          },
        });

        if (!rule) {
          return reply.code(404).send({ error: 'Rule not found' });
        }

        // Soft delete by archiving
        await prisma.dMAutomationRule.update({
          where: { id },
          data: { status: 'archived' },
        });

        logger.info('Archived DM automation rule', {
          brandId,
          ruleId: id,
          ruleName: rule.name,
          userId,
        });

        return reply.send({ success: true });
      } catch (error) {
        logger.error('Error archiving DM automation rule', {
          brandId,
          ruleId: id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to archive rule' });
      }
    }
  );

  /**
   * GET /api/brands/:brandId/dm-automation/analytics
   * Get automation usage stats and metrics
   */
  fastify.get<{ Params: { brandId: string }; Querystring: AnalyticsQuery }>(
    '/brands/:brandId/dm-automation/analytics',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;

      try {
        // Validate query params
        const { days } = analyticsQuerySchema.parse(request.query);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({
          where: { id: brandId, userId },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        // Aggregate stats
        const [totalEvents, messagesSent, commentRepliesSent, rateLimitedEvents, uniqueUsers] =
          await Promise.all([
            // Total events triggered
            prisma.dMAutomationEvent.count({
              where: { brandId, timestamp: { gte: since } },
            }),

            // Messages successfully sent
            prisma.dMAutomationEvent.count({
              where: { brandId, timestamp: { gte: since }, messageSent: true },
            }),

            // Comment replies sent
            prisma.dMAutomationEvent.count({
              where: { brandId, timestamp: { gte: since }, commentReplySent: true },
            }),

            // Rate limited events
            prisma.dMAutomationEvent.count({
              where: { brandId, timestamp: { gte: since }, rateLimited: true },
            }),

            // Unique users who triggered automation
            prisma.dMAutomationEvent.findMany({
              where: { brandId, timestamp: { gte: since } },
              select: { triggeredBy: true },
              distinct: ['triggeredBy'],
            }),
          ]);

        // Get stats per rule
        const ruleStats = await prisma.dMAutomationEvent.groupBy({
          by: ['ruleId'],
          where: { brandId, timestamp: { gte: since } },
          _count: { id: true },
        });

        // For each rule, get detailed counts
        const ruleStatsDetailed = await Promise.all(
          ruleStats.map(async (stat) => {
            const [messagesSentCount, commentRepliesCount, rateLimitedCount] = await Promise.all([
              prisma.dMAutomationEvent.count({
                where: {
                  brandId,
                  ruleId: stat.ruleId,
                  timestamp: { gte: since },
                  messageSent: true,
                },
              }),
              prisma.dMAutomationEvent.count({
                where: {
                  brandId,
                  ruleId: stat.ruleId,
                  timestamp: { gte: since },
                  commentReplySent: true,
                },
              }),
              prisma.dMAutomationEvent.count({
                where: {
                  brandId,
                  ruleId: stat.ruleId,
                  timestamp: { gte: since },
                  rateLimited: true,
                },
              }),
            ]);

            return {
              ruleId: stat.ruleId,
              totalEvents: stat._count.id,
              messagesSent: messagesSentCount,
              commentRepliesSent: commentRepliesCount,
              rateLimited: rateLimitedCount,
            };
          })
        );

        // Get rule names for stats
        const ruleIds = ruleStats.map((stat) => stat.ruleId);
        const rules = await prisma.dMAutomationRule.findMany({
          where: { id: { in: ruleIds } },
          select: { id: true, name: true },
        });

        const ruleNameMap = new Map(rules.map((r) => [r.id, r.name]));

        // Format rule stats
        const ruleStatsFormatted = ruleStatsDetailed.map((stat) => ({
          ruleId: stat.ruleId,
          ruleName: ruleNameMap.get(stat.ruleId) || 'Unknown',
          totalEvents: stat.totalEvents,
          messagesSent: stat.messagesSent,
          commentRepliesSent: stat.commentRepliesSent,
          rateLimited: stat.rateLimited,
        }));

        const analytics = {
          period: {
            days,
            since: since.toISOString(),
          },
          overview: {
            totalEvents,
            messagesSent,
            commentRepliesSent,
            rateLimitedEvents,
            uniqueUsers: uniqueUsers.length,
            successRate:
              totalEvents > 0 ? ((messagesSent + commentRepliesSent) / totalEvents) * 100 : 0,
          },
          byRule: ruleStatsFormatted,
        };

        logger.info('Fetched DM automation analytics', {
          brandId,
          days,
          totalEvents,
          userId,
        });

        return reply.send(analytics);
      } catch (error) {
        if (error instanceof Error && error.name === 'ZodError') {
          return reply.code(400).send({ error: 'Invalid query parameters' });
        }

        logger.error('Error fetching DM automation analytics', {
          brandId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to fetch analytics' });
      }
    }
  );
};

export default dmAutomationRoutes;
