import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { imageProviderRegistry } from '../services/image-providers/registry.js';
import { getDatabaseClient } from '../config/database.js';
import { IMAGE_PROVIDERS, type ImageProvider } from '../services/image-providers/types.js';
import { Prisma } from '@postolio/database';

const prisma = getDatabaseClient();

const ProviderPreferenceSchema = z.object({
  imageProvider: z.enum(IMAGE_PROVIDERS).nullable(),
});

const imageProviderRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/image-providers - List all configured providers
  fastify.get('/', async (request, reply) => {
    try {
      const providers = imageProviderRegistry.getConfiguredProviders();

      return reply.send({
        providers: providers.map((p) => ({
          name: p.name,
          displayName: p.displayName,
          isConfigured: p.isConfigured,
          pricing: p.pricing,
        })),
        default: imageProviderRegistry.getDefaultProvider(),
      });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to list image providers');
      return reply.code(500).send({ error: 'Failed to retrieve image providers' });
    }
  });

  // GET /api/image-providers/:brandId/preference - Get brand's provider preference
  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/preference',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const { brandId } = request.params;
        const userId = request.user!.id;

        // Verify brand ownership
        const brand = await prisma.brand.findUnique({
          where: { id: brandId },
          select: { userId: true, preferences: true },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        if (brand.userId !== userId) {
          return reply.code(403).send({ error: 'Access denied' });
        }

        const preferences = brand.preferences as { imageProvider?: string } | null;

        return reply.send({
          imageProvider: preferences?.imageProvider || null,
          defaultProvider: imageProviderRegistry.getDefaultProvider(),
        });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to get brand image provider preference');
        return reply.code(500).send({ error: 'Failed to retrieve preference' });
      }
    }
  );

  // POST /api/image-providers/:brandId/preference - Update brand's provider preference
  fastify.post<{ Params: { brandId: string }; Body: z.infer<typeof ProviderPreferenceSchema> }>(
    '/:brandId/preference',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const { brandId } = request.params;
        const userId = request.user!.id;

        // Validate request body
        const body = ProviderPreferenceSchema.parse(request.body);

        // Verify brand ownership
        const brand = await prisma.brand.findUnique({
          where: { id: brandId },
          select: { userId: true, preferences: true },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        if (brand.userId !== userId) {
          return reply.code(403).send({ error: 'Access denied' });
        }

        if (body.imageProvider) {
          // Validate provider is configured
          const provider = imageProviderRegistry.getProvider(body.imageProvider as ImageProvider);
          if (!provider?.isConfigured) {
            return reply.code(400).send({ error: 'Provider not configured on server' });
          }
        }

        // Update brand preferences
        const existingPreferences = (brand.preferences ?? {}) as Record<string, unknown>;
        const nextPreferences: Record<string, unknown> = { ...existingPreferences };
        if (body.imageProvider) {
          nextPreferences.imageProvider = body.imageProvider;
        } else {
          delete nextPreferences.imageProvider;
        }

        await prisma.brand.update({
          where: { id: brandId },
          data: {
            preferences: nextPreferences as Prisma.InputJsonValue,
          },
        });

        request.log.info(
          { brandId, provider: body.imageProvider },
          'Updated brand image provider preference'
        );

        return reply.send({ success: true, imageProvider: body.imageProvider });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ error: 'Invalid request body', details: error.issues });
        }

        request.log.error({ err: error }, 'Failed to update brand image provider preference');
        return reply.code(500).send({ error: 'Failed to update preference' });
      }
    }
  );

  // GET /api/image-providers/:brandId/analytics - Get cost and usage analytics
  fastify.get<{
    Params: { brandId: string };
    Querystring: { startDate?: string; endDate?: string };
  }>('/:brandId/analytics', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const { brandId } = request.params;
      const { startDate, endDate } = request.query;
      const userId = request.user!.id;

      // Verify brand ownership
      const brand = await prisma.brand.findUnique({
        where: { id: brandId },
        select: { userId: true },
      });

      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      if (brand.userId !== userId) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      // Query generation logs
      const logs = await prisma.imageGenerationLog.findMany({
        where: {
          brandId,
          ...(startDate && endDate
            ? {
                createdAt: {
                  gte: new Date(startDate),
                  lte: new Date(endDate),
                },
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
      });

      // Aggregate by provider
      const byProvider = logs.reduce(
        (acc, log) => {
          if (!acc[log.provider]) {
            acc[log.provider] = {
              count: 0,
              totalCost: 0,
              totalTime: 0,
              avgCost: 0,
              avgTime: 0,
            };
          }

          acc[log.provider].count++;
          acc[log.provider].totalCost += Number(log.cost);
          acc[log.provider].totalTime += log.generationTime;

          return acc;
        },
        {} as Record<
          string,
          {
            count: number;
            totalCost: number;
            totalTime: number;
            avgCost: number;
            avgTime: number;
          }
        >
      );

      // Calculate averages
      Object.values(byProvider).forEach((stats) => {
        stats.avgCost = stats.totalCost / stats.count;
        stats.avgTime = stats.totalTime / stats.count;
      });

      // Overall stats
      const totalCount = logs.length;
      const totalCost = logs.reduce((sum, log) => sum + Number(log.cost), 0);

      return reply.send({
        overall: {
          totalGenerated: totalCount,
          totalCost,
          avgCostPerImage: totalCount > 0 ? totalCost / totalCount : 0,
        },
        byProvider,
        recentLogs: logs.slice(0, 10).map((log) => ({
          id: log.id,
          provider: log.provider,
          cost: Number(log.cost),
          generationTime: log.generationTime,
          status: log.status,
          createdAt: log.createdAt,
        })),
      });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to get image provider analytics');
      return reply.code(500).send({ error: 'Failed to retrieve analytics' });
    }
  });
};

export default imageProviderRoutes;
