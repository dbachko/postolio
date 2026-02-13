import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { validateBody, validateQuery, validateParams } from '../middleware/validation.js';
import { assertBrandOwnership } from '../services/ownership.js';
import {
  cancelRun,
  createRun,
  estimateRunCost,
  getRun,
  getRunCredits,
  grantRunCredits,
  listRuns,
  markRunEnqueueFailed,
} from '../services/recipe-runs/runs-service.js';
import { enqueueRecipeRun } from '../services/recipe-runs/queue.js';

const ListRunsQuerySchema = z.object({
  brandId: z.string().min(1),
  status: z.enum(['queued', 'running', 'success', 'failed', 'canceled']).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v ?? 50);
      if (!Number.isFinite(n)) return 50;
      return Math.max(1, Math.min(200, Math.floor(n)));
    }),
});

const CreateRunBodySchema = z.object({
  brandId: z.string().min(1),
  recipeVersionId: z.string().min(1),
  trigger: z.enum(['manual', 'schedule', 'api', 'chat']).default('manual'),
  input: z.unknown().optional().default({}),
});

const EstimateRunBodySchema = z.object({
  brandId: z.string().min(1),
  recipeVersionId: z.string().min(1),
  input: z.unknown().optional().default({}),
});

const CreditsQuerySchema = z.object({
  brandId: z.string().min(1),
});

const TopUpCreditsBodySchema = z.object({
  brandId: z.string().min(1),
  credits: z.number().int().positive().max(100000).default(1000),
});

const RunIdParamsSchema = z.object({
  runId: z.string().min(1),
});

export const runsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: z.infer<typeof ListRunsQuerySchema> }>(
    '/',
    { preHandler: [fastify.authenticate, validateQuery(ListRunsQuerySchema)] },
    async (request, reply) => {
      const { brandId, status, limit } = request.query;
      const userId = request.user!.id;

      await assertBrandOwnership(userId, brandId);

      const runs = await listRuns({ brandId, status, limit: limit ?? 50 });
      return reply.send({ runs });
    }
  );

  fastify.post<{ Body: z.infer<typeof CreateRunBodySchema> }>(
    '/',
    { preHandler: [fastify.authenticate, validateBody(CreateRunBodySchema)] },
    async (request, reply) => {
      const userId = request.user!.id;
      const body = request.body;

      await assertBrandOwnership(userId, body.brandId);

      const { runId, status, costEstimate } = await createRun({
        brandId: body.brandId,
        userId,
        recipeVersionId: body.recipeVersionId,
        trigger: body.trigger,
        input: body.input,
      });

      try {
        await enqueueRecipeRun(runId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown enqueue error';
        await markRunEnqueueFailed({ runId, internalError: message });
        request.log.error({ err: error, runId }, 'Failed to enqueue recipe run');
        return reply.code(503).send({
          error: 'Run could not be started. Please retry.',
          code: 'RUN_ENQUEUE_FAILED',
          runId,
        });
      }

      return reply.code(201).send({ runId, status, costEstimate });
    }
  );

  fastify.post<{ Body: z.infer<typeof EstimateRunBodySchema> }>(
    '/estimate',
    { preHandler: [fastify.authenticate, validateBody(EstimateRunBodySchema)] },
    async (request, reply) => {
      const userId = request.user!.id;
      const body = request.body;

      await assertBrandOwnership(userId, body.brandId);
      const estimate = await estimateRunCost({
        brandId: body.brandId,
        recipeVersionId: body.recipeVersionId,
        input: body.input,
      });

      return reply.send({
        estimate: {
          cadenceCount: estimate.estimate.cadenceCount,
          stepCounts: estimate.estimate.stepCounts,
          billableCounts: estimate.estimate.billableCounts,
          estimatedCredits: estimate.estimate.estimatedCredits,
          estimatedUsd: estimate.estimate.estimatedUsd,
        },
        managedSkillIds: estimate.managedSkillIds,
        balanceCredits: estimate.balanceCredits,
        shortfallCredits: estimate.shortfallCredits,
        enforcementEnabled: estimate.enforcementEnabled,
      });
    }
  );

  fastify.get<{ Querystring: z.infer<typeof CreditsQuerySchema> }>(
    '/credits',
    { preHandler: [fastify.authenticate, validateQuery(CreditsQuerySchema)] },
    async (request, reply) => {
      const userId = request.user!.id;
      const { brandId } = request.query;
      await assertBrandOwnership(userId, brandId);
      const credits = await getRunCredits(brandId);
      return reply.send({ credits });
    }
  );

  fastify.post<{ Body: z.infer<typeof TopUpCreditsBodySchema> }>(
    '/credits/top-up',
    { preHandler: [fastify.authenticate, validateBody(TopUpCreditsBodySchema)] },
    async (request, reply) => {
      const userId = request.user!.id;
      const body = request.body;
      await assertBrandOwnership(userId, body.brandId);
      const topUp = await grantRunCredits({
        brandId: body.brandId,
        credits: body.credits,
      });
      return reply.send({ topUp });
    }
  );

  fastify.get<{ Params: z.infer<typeof RunIdParamsSchema> }>(
    '/:runId',
    { preHandler: [fastify.authenticate, validateParams(RunIdParamsSchema)] },
    async (request, reply) => {
      const userId = request.user!.id;
      const { runId } = request.params;

      const data = await getRun(runId);
      if (!data) return reply.code(404).send({ error: 'Run not found' });

      await assertBrandOwnership(userId, data.run.brandId);

      return reply.send(data);
    }
  );

  fastify.post<{ Params: z.infer<typeof RunIdParamsSchema> }>(
    '/:runId/cancel',
    { preHandler: [fastify.authenticate, validateParams(RunIdParamsSchema)] },
    async (request, reply) => {
      const userId = request.user!.id;
      const { runId } = request.params;

      const data = await getRun(runId);
      if (!data) return reply.code(404).send({ error: 'Run not found' });

      await assertBrandOwnership(userId, data.run.brandId);

      const canceled = await cancelRun(runId);
      return reply.send(canceled);
    }
  );
};

export default runsRoutes;
