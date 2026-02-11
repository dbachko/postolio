import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { validateBody, validateQuery, validateParams } from '../middleware/validation.js';
import { assertBrandOwnership } from '../services/ownership.js';
import { createRun, getRun, listRuns, cancelRun } from '../services/recipe-runs/runs-service.js';
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

      const { runId, status } = await createRun({
        brandId: body.brandId,
        userId,
        recipeVersionId: body.recipeVersionId,
        trigger: body.trigger,
        input: body.input,
      });

      // Best-effort enqueue. If the queue is unavailable, the run stays queued.
      try {
        await enqueueRecipeRun(runId);
      } catch (error) {
        request.log.warn({ err: error, runId }, 'Failed to enqueue recipe run');
      }

      return reply.code(201).send({ runId, status });
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
