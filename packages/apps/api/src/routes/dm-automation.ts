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
import { getStatusBroadcaster } from '../services/broadcast-registry.js';
import { assertBrandOwnership } from '../services/ownership.js';
import { APIError } from '@postolio/errors';

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
        await assertBrandOwnership(userId, brandId);

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
        if (error instanceof APIError) {
          throw error;
        }
        throw new APIError(
          error instanceof Error ? error.message : 'Failed to fetch DM automation rules',
          'DM_RULES_FETCH_FAILED',
          500,
          { brandId, userId }
        );
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
        await assertBrandOwnership(userId, brandId);

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
        if (error instanceof APIError) {
          throw error;
        }
        throw new APIError(
          error instanceof Error ? error.message : 'Failed to create DM automation rule',
          'DM_RULE_CREATE_FAILED',
          500,
          { brandId, userId }
        );
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
        // Verify brand ownership first (will throw APIError on failure)
        await assertBrandOwnership(userId, brandId);

        const existingRule = await prisma.dMAutomationRule.findFirst({
          where: {
            id,
            brandId,
          },
        });

        if (!existingRule) {
          throw new APIError('Rule not found', 'DM_RULE_NOT_FOUND', 404, {
            brandId,
            ruleId: id,
          });
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
        if (error instanceof APIError) {
          throw error;
        }
        throw new APIError(
          error instanceof Error ? error.message : 'Failed to update DM automation rule',
          'DM_RULE_UPDATE_FAILED',
          500,
          { brandId, ruleId: id, userId }
        );
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
        // Verify brand ownership first
        await assertBrandOwnership(userId, brandId);

        const rule = await prisma.dMAutomationRule.findFirst({
          where: {
            id,
            brandId,
          },
        });

        if (!rule) {
          throw new APIError('Rule not found', 'DM_RULE_NOT_FOUND', 404, {
            brandId,
            ruleId: id,
          });
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
        if (error instanceof APIError) {
          throw error;
        }
        throw new APIError(
          error instanceof Error ? error.message : 'Failed to archive DM automation rule',
          'DM_RULE_ARCHIVE_FAILED',
          500,
          { brandId, ruleId: id, userId }
        );
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
        await assertBrandOwnership(userId, brandId);

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
        if (error instanceof APIError) {
          throw error;
        }
        throw new APIError(
          error instanceof Error ? error.message : 'Failed to fetch DM automation analytics',
          'DM_ANALYTICS_FETCH_FAILED',
          500,
          { brandId, userId }
        );
      }
    }
  );

  /**
   * GET /api/brands/:brandId/dm-automation/conversations
   * List all DM conversations for a brand
   */
  fastify.get<{
    Params: { brandId: string };
    Querystring: { state?: 'active' | 'archived' | 'spam'; limit?: number };
  }>(
    '/brands/:brandId/dm-automation/conversations',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const { state, limit = 50 } = request.query;
      const userId = request.user!.id;

      try {
        // Verify brand ownership
        const brand = await prisma.brand.findFirst({
          where: { id: brandId, userId },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        // Build where clause
        const where: any = { brandId };
        if (state) {
          where.state = state;
        }

        // Fetch conversations with message counts
        const conversations = await prisma.dMConversation.findMany({
          where,
          orderBy: { lastMessageAt: 'desc' },
          take: limit,
          include: {
            rule: {
              select: { id: true, name: true },
            },
            _count: {
              select: { messages: true },
            },
          },
        });

        // Get last message for each conversation
        const conversationsWithLastMessage = await Promise.all(
          conversations.map(async (conv) => {
            const lastMessage = await prisma.dMMessage.findFirst({
              where: { conversationId: conv.id },
              orderBy: { createdAt: 'desc' },
            });

            return {
              ...conv,
              messageCount: conv._count.messages,
              lastMessage: lastMessage
                ? {
                    text: lastMessage.messageText,
                    direction: lastMessage.direction,
                    createdAt: lastMessage.createdAt,
                  }
                : null,
            };
          })
        );

        logger.info('Fetched DM conversations', {
          brandId,
          conversationCount: conversations.length,
          state,
          userId,
        });

        return reply.send({ conversations: conversationsWithLastMessage });
      } catch (error) {
        logger.error('Error fetching DM conversations', {
          brandId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to fetch conversations' });
      }
    }
  );

  /**
   * GET /api/brands/:brandId/dm-automation/conversations/:conversationId/messages
   * Get all messages in a conversation
   */
  fastify.get<{ Params: { brandId: string; conversationId: string } }>(
    '/brands/:brandId/dm-automation/conversations/:conversationId/messages',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId, conversationId } = request.params;
      const userId = request.user!.id;

      try {
        // Verify conversation belongs to user's brand
        const conversation = await prisma.dMConversation.findFirst({
          where: {
            id: conversationId,
            brandId,
            brand: { userId },
          },
        });

        if (!conversation) {
          return reply.code(404).send({ error: 'Conversation not found' });
        }

        // Fetch messages
        const messages = await prisma.dMMessage.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
        });

        logger.info('Fetched conversation messages', {
          brandId,
          conversationId,
          messageCount: messages.length,
          userId,
        });

        return reply.send({ messages });
      } catch (error) {
        logger.error('Error fetching conversation messages', {
          brandId,
          conversationId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to fetch messages' });
      }
    }
  );

  /**
   * POST /api/brands/:brandId/dm-automation/conversations/:conversationId/messages
   * Send a manual reply to a conversation
   */
  fastify.post<{
    Params: { brandId: string; conversationId: string };
    Body: { messageText: string };
  }>(
    '/brands/:brandId/dm-automation/conversations/:conversationId/messages',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId, conversationId } = request.params;
      const { messageText } = request.body;
      const userId = request.user!.id;

      try {
        // Verify conversation belongs to user's brand
        const conversation = await prisma.dMConversation.findFirst({
          where: {
            id: conversationId,
            brandId,
            brand: { userId },
          },
        });

        if (!conversation) {
          return reply.code(404).send({ error: 'Conversation not found' });
        }

        if (!messageText || messageText.trim().length === 0) {
          return reply.code(400).send({ error: 'Message text is required' });
        }

        // Send message via Instagram API
        const { instagramService } = await import('../services/instagram.js');
        const { messageId } = await instagramService.sendDirectMessage(
          brandId,
          conversation.instagramUserId,
          messageText.trim()
        );

        // Save message to database
        const message = await prisma.dMMessage.create({
          data: {
            conversationId,
            direction: 'outbound',
            messageText: messageText.trim(),
            externalMessageId: messageId,
            status: 'sent',
            sentAt: new Date(),
          },
        });

        // Update conversation lastMessageAt
        await prisma.dMConversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: new Date() },
        });

        logger.info('Sent manual DM reply', {
          brandId,
          conversationId,
          messageId,
          userId,
        });

        // Broadcast WebSocket event for new manual message
        const statusBroadcaster = getStatusBroadcaster();
        if (statusBroadcaster) {
          await statusBroadcaster.broadcastDMMessage(
            conversationId,
            message.id,
            brandId,
            'outbound',
            messageText.trim(),
            conversation.instagramUsername
          );
        }

        return reply.code(201).send({ message });
      } catch (error) {
        logger.error('Error sending manual DM reply', {
          brandId,
          conversationId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to send message' });
      }
    }
  );

  /**
   * PATCH /api/brands/:brandId/dm-automation/conversations/:conversationId
   * Update conversation state (archive, mark as spam, etc.)
   */
  fastify.patch<{
    Params: { brandId: string; conversationId: string };
    Body: { state: 'active' | 'archived' | 'spam' };
  }>(
    '/brands/:brandId/dm-automation/conversations/:conversationId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId, conversationId } = request.params;
      const { state } = request.body;
      const userId = request.user!.id;

      try {
        // Verify conversation belongs to user's brand
        const conversation = await prisma.dMConversation.findFirst({
          where: {
            id: conversationId,
            brandId,
            brand: { userId },
          },
        });

        if (!conversation) {
          return reply.code(404).send({ error: 'Conversation not found' });
        }

        // Update conversation state
        const updated = await prisma.dMConversation.update({
          where: { id: conversationId },
          data: { state },
        });

        logger.info('Updated conversation state', {
          brandId,
          conversationId,
          newState: state,
          userId,
        });

        // Broadcast WebSocket event for conversation state update
        const statusBroadcaster = getStatusBroadcaster();
        if (statusBroadcaster) {
          await statusBroadcaster.broadcastDMConversationUpdate(
            conversationId,
            brandId,
            state,
            updated.lastMessageAt
          );
        }

        return reply.send({ conversation: updated });
      } catch (error) {
        logger.error('Error updating conversation state', {
          brandId,
          conversationId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to update conversation' });
      }
    }
  );
};

export default dmAutomationRoutes;
