import type { FastifyInstance } from 'fastify';

import { getDatabaseClient } from '../config/database.js';
import { assertBrandOwnership } from '../services/ownership.js';
import { autopilotService } from '../services/autopilot.js';

const prisma = getDatabaseClient();

interface AutopilotConfigUpdate {
  enabled?: boolean;
  minDaysAhead?: number;
  maxContentPerGeneration?: number;
  contentStrategy?: {
    themes?: string[];
    postingFrequency?: 'daily' | 'every-other-day' | 'weekly';
    optimalTimes?: Array<{ hour: number; minute: number }>;
  };
}

const BRAND_PARAMS_SCHEMA = {
  type: 'object',
  properties: { brandId: { type: 'string' } },
  required: ['brandId'],
};

const AUTOPILOT_CONFIG_BODY_SCHEMA = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    minDaysAhead: { type: 'number', minimum: 7, maximum: 30 },
    maxContentPerGeneration: { type: 'number', minimum: 1, maximum: 10 },
    contentStrategy: {
      type: 'object',
      properties: {
        themes: { type: 'array', items: { type: 'string' } },
        postingFrequency: {
          type: 'string',
          enum: ['daily', 'every-other-day', 'weekly'],
        },
        optimalTimes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              hour: { type: 'number', minimum: 0, maximum: 23 },
              minute: { type: 'number', minimum: 0, maximum: 59 },
            },
            required: ['hour', 'minute'],
          },
        },
      },
    },
  },
};

function getAuthenticatedUserId(
  request: { user?: { id?: string } },
  reply: { status: (code: number) => { send: (payload: unknown) => unknown } }
): string | null {
  const userId = request.user?.id;
  if (userId) {
    return userId;
  }

  reply.status(401).send({ success: false, message: 'Authentication required' });
  return null;
}

function registerAuthHook(fastify: FastifyInstance): void {
  fastify.addHook('preHandler', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      reply.send(error);
    }
  });
}

function registerTriggerRoute(fastify: FastifyInstance): void {
  fastify.post('/trigger', async (request, reply) => {
    try {
      const result = await autopilotService.triggerManual();
      return reply.send({
        success: result.success,
        message: result.message,
        data: { generated: result.generated, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      request.log.error({ err: error }, 'Autopilot trigger error');
      throw error;
    }
  });
}

function registerStatusRoute(fastify: FastifyInstance): void {
  fastify.get('/status', async (request, reply) => {
    try {
      const status = await autopilotService.getAutopilotStatus();
      return reply.send({ success: true, data: status });
    } catch (error) {
      request.log.error({ err: error }, 'Autopilot status error');
      throw error;
    }
  });
}

function registerUpdateConfigRoute(fastify: FastifyInstance): void {
  fastify.patch(
    '/brands/:brandId/config',
    {
      preHandler: fastify.authenticate,
      schema: { params: BRAND_PARAMS_SCHEMA, body: AUTOPILOT_CONFIG_BODY_SCHEMA },
    },
    async (request, reply) => {
      try {
        const userId = getAuthenticatedUserId(request as { user?: { id?: string } }, reply);
        if (!userId) {
          return;
        }

        const { brandId } = request.params as { brandId: string };
        const config = request.body as AutopilotConfigUpdate;

        await assertBrandOwnership(userId, brandId);
        const success = await autopilotService.updateBrandConfig(brandId, config);

        if (!success) {
          return reply.status(500).send({
            success: false,
            message: 'Failed to update autopilot configuration',
          });
        }

        return reply.send({
          success: true,
          message: 'Autopilot configuration updated successfully',
        });
      } catch (error) {
        request.log.error({ err: error }, 'Autopilot config update error');
        throw error;
      }
    }
  );
}

function defaultAutopilotConfig(): AutopilotConfigUpdate {
  return {
    enabled: false,
    minDaysAhead: 14,
    maxContentPerGeneration: 5,
    contentStrategy: {
      themes: ['lifestyle', 'inspiration'],
      postingFrequency: 'daily',
      optimalTimes: [
        { hour: 9, minute: 0 },
        { hour: 18, minute: 0 },
      ],
    },
  };
}

function registerGetConfigRoute(fastify: FastifyInstance): void {
  fastify.get(
    '/brands/:brandId/config',
    { preHandler: fastify.authenticate, schema: { params: BRAND_PARAMS_SCHEMA } },
    async (request, reply) => {
      try {
        const userId = getAuthenticatedUserId(request as { user?: { id?: string } }, reply);
        if (!userId) {
          return;
        }

        const { brandId } = request.params as { brandId: string };
        const brand = await assertBrandOwnership(userId, brandId);

        const prefs = brand.preferences as { autopilot?: unknown } | null;
        const config =
          (prefs?.autopilot as AutopilotConfigUpdate | undefined) || defaultAutopilotConfig();

        return reply.send({
          success: true,
          data: { brandId: brand.id, brandName: brand.name, config },
        });
      } catch (error) {
        request.log.error({ err: error }, 'Autopilot config fetch error');
        throw error;
      }
    }
  );
}

async function buildBrandGapAnalysis(brand: {
  id: string;
  name: string;
  content: Array<{ id: string; caption: string; scheduledAt: Date | null; status: string }>;
}) {
  const now = new Date();
  const futureDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const scheduledCount = await prisma.content.count({
    where: {
      brandId: brand.id,
      scheduledAt: { gte: now, lte: futureDate },
    },
  });

  const expectedPosts = 14;
  const contentGap = Math.max(0, expectedPosts - scheduledCount);

  return {
    brandId: brand.id,
    brandName: brand.name,
    scheduledNext14Days: scheduledCount,
    expectedPosts,
    contentGap,
    needsGeneration: contentGap > 0,
    lastScheduled: brand.content[0]?.scheduledAt || null,
    recentContent: brand.content.map((content) => ({
      id: content.id,
      caption: `${content.caption.substring(0, 100)}...`,
      scheduledAt: content.scheduledAt,
      status: content.status,
    })),
  };
}

function registerGapsRoute(fastify: FastifyInstance): void {
  fastify.get('/gaps', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = getAuthenticatedUserId(request as { user?: { id?: string } }, reply);
      if (!userId) {
        return;
      }

      const brands = await prisma.brand.findMany({
        where: { userId },
        include: {
          content: {
            where: {
              status: { in: ['scheduled', 'published'] },
              scheduledAt: { not: null },
            },
            orderBy: { scheduledAt: 'desc' },
            take: 5,
          },
        },
      });

      const analysis = await Promise.all(
        brands.map((brand) => buildBrandGapAnalysis(brand as any))
      );

      return reply.send({
        success: true,
        data: {
          analysis,
          summary: {
            totalBrands: brands.length,
            brandsNeedingContent: analysis.filter((item) => item.needsGeneration).length,
            totalGap: analysis.reduce((sum, item) => sum + item.contentGap, 0),
          },
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'Autopilot gaps analysis error');
      throw error;
    }
  });
}

export default async function autopilotRoutes(fastify: FastifyInstance) {
  registerAuthHook(fastify);
  registerTriggerRoute(fastify);
  registerStatusRoute(fastify);
  registerUpdateConfigRoute(fastify);
  registerGetConfigRoute(fastify);
  registerGapsRoute(fastify);
}
