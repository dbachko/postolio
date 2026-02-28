import { APIError } from '@postolio/errors';
import { logger as baseLogger } from '@postolio/logger';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import {
  createRuleSchema,
  updateRuleSchema,
  type CreateRuleInput,
  type UpdateRuleInput,
} from '../../schemas/dm-automation.js';
import { assertBrandOwnership } from '../../services/ownership.js';
import { requireInboxFeature } from './shared.js';

const logger = baseLogger.child({ module: 'dm-automation-rules-routes' });

function isZodError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'ZodError';
}

function registerListRulesRoute(fastify: FastifyInstance): void {
  fastify.get<{ Params: { brandId: string } }>(
    '/brands/:brandId/dm-automation/rules',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;

      try {
        await assertBrandOwnership(userId, brandId);
        const rules = await prisma.dMAutomationRule.findMany({
          where: { brandId },
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        });

        logger.info('Fetched DM automation rules', { brandId, ruleCount: rules.length, userId });
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
}

function registerCreateRuleRoute(fastify: FastifyInstance): void {
  fastify.post<{ Params: { brandId: string }; Body: CreateRuleInput }>(
    '/brands/:brandId/dm-automation/rules',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;

      try {
        const data = createRuleSchema.parse(request.body);
        await assertBrandOwnership(userId, brandId);

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
        if (isZodError(error)) {
          logger.warn('Validation error creating rule', { brandId, error: error.message });
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
}

function registerUpdateRuleRoute(fastify: FastifyInstance): void {
  fastify.patch<{ Params: { brandId: string; id: string }; Body: UpdateRuleInput }>(
    '/brands/:brandId/dm-automation/rules/:id',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      const { brandId, id } = request.params;
      const userId = request.user!.id;

      try {
        const data = updateRuleSchema.parse(request.body);
        await assertBrandOwnership(userId, brandId);

        const existingRule = await prisma.dMAutomationRule.findFirst({ where: { id, brandId } });
        if (!existingRule) {
          throw new APIError('Rule not found', 'DM_RULE_NOT_FOUND', 404, { brandId, ruleId: id });
        }

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
        if (isZodError(error)) {
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
}

function registerArchiveRuleRoute(fastify: FastifyInstance): void {
  fastify.delete<{ Params: { brandId: string; id: string } }>(
    '/brands/:brandId/dm-automation/rules/:id',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      const { brandId, id } = request.params;
      const userId = request.user!.id;

      try {
        await assertBrandOwnership(userId, brandId);
        const rule = await prisma.dMAutomationRule.findFirst({ where: { id, brandId } });

        if (!rule) {
          throw new APIError('Rule not found', 'DM_RULE_NOT_FOUND', 404, { brandId, ruleId: id });
        }

        await prisma.dMAutomationRule.update({ where: { id }, data: { status: 'archived' } });

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
}

export function registerDmAutomationRuleRoutes(fastify: FastifyInstance): void {
  registerListRulesRoute(fastify);
  registerCreateRuleRoute(fastify);
  registerUpdateRuleRoute(fastify);
  registerArchiveRuleRoute(fastify);
}
