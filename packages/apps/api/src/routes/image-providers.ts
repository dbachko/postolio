import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { imageProviderRegistry } from '../services/image-providers/registry.js';
import { getDatabaseClient } from '../config/database.js';
import { IMAGE_PROVIDERS, type ImageProvider } from '../services/image-providers/types.js';
import type { Prisma } from '@postolio/database';

const prisma = getDatabaseClient();

const ProviderPreferenceSchema = z.object({
  imageProvider: z.enum(IMAGE_PROVIDERS).nullable(),
});

async function loadBrandOwnerAndPreferences(brandId: string) {
  return prisma.brand.findUnique({
    where: { id: brandId },
    select: { userId: true, preferences: true },
  });
}

async function loadBrandOwner(brandId: string) {
  return prisma.brand.findUnique({
    where: { id: brandId },
    select: { userId: true },
  });
}

function assertUserCanAccessBrand(brand: { userId: string } | null, userId: string) {
  if (!brand) {
    return { statusCode: 404, body: { error: 'Brand not found' } };
  }
  if (brand.userId !== userId) {
    return { statusCode: 403, body: { error: 'Access denied' } };
  }
  return null;
}

function createListProvidersHandler() {
  return async (request: any, reply: any) => {
    try {
      const providers = imageProviderRegistry.getConfiguredProviders();
      return reply.send({
        providers: providers.map((provider) => ({
          name: provider.name,
          displayName: provider.displayName,
          isConfigured: provider.isConfigured,
          pricing: provider.pricing,
        })),
        default: imageProviderRegistry.getDefaultProvider(),
      });
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Failed to list image providers');
      return reply.code(500).send({ error: 'Failed to retrieve image providers' });
    }
  };
}

function createGetPreferenceHandler() {
  return async (request: any, reply: any) => {
    try {
      const { brandId } = request.params as { brandId: string };
      const userId = request.user!.id;
      const brand = await loadBrandOwnerAndPreferences(brandId);
      const accessError = assertUserCanAccessBrand(brand as any, userId);
      if (accessError) {
        return reply.code(accessError.statusCode).send(accessError.body);
      }

      const preferences = (brand?.preferences as { imageProvider?: string } | null) || null;
      return reply.send({
        imageProvider: preferences?.imageProvider || null,
        defaultProvider: imageProviderRegistry.getDefaultProvider(),
      });
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Failed to get brand image provider preference');
      return reply.code(500).send({ error: 'Failed to retrieve preference' });
    }
  };
}

function resolveNextBrandPreferences(params: {
  body: z.infer<typeof ProviderPreferenceSchema>;
  existingPreferences: unknown;
}) {
  const existing = (params.existingPreferences ?? {}) as Record<string, unknown>;
  const next = { ...existing };
  if (params.body.imageProvider) {
    next.imageProvider = params.body.imageProvider;
  } else {
    delete next.imageProvider;
  }
  return next;
}

async function updateBrandImageProviderPreference(params: {
  brandId: string;
  body: z.infer<typeof ProviderPreferenceSchema>;
  existingPreferences: unknown;
}) {
  const nextPreferences = resolveNextBrandPreferences(params);
  await prisma.brand.update({
    where: { id: params.brandId },
    data: { preferences: nextPreferences as Prisma.InputJsonValue },
  });
}

function createSetPreferenceHandler() {
  return async (request: any, reply: any) => {
    try {
      const { brandId } = request.params as { brandId: string };
      const userId = request.user!.id;
      const body = ProviderPreferenceSchema.parse(request.body);
      const brand = await loadBrandOwnerAndPreferences(brandId);
      const accessError = assertUserCanAccessBrand(brand as any, userId);
      if (accessError) {
        return reply.code(accessError.statusCode).send(accessError.body);
      }

      if (body.imageProvider) {
        const provider = imageProviderRegistry.getProvider(body.imageProvider as ImageProvider);
        if (!provider?.isConfigured) {
          return reply.code(400).send({ error: 'Provider not configured on server' });
        }
      }

      await updateBrandImageProviderPreference({
        brandId,
        body,
        existingPreferences: brand?.preferences,
      });
      request.log.info(
        { brandId, provider: body.imageProvider },
        'Updated brand image provider preference'
      );
      return reply.send({ success: true, imageProvider: body.imageProvider });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request body', details: error.issues });
      }
      request.log.error({ err: error }, 'Failed to update brand image provider preference');
      return reply.code(500).send({ error: 'Failed to update preference' });
    }
  };
}

function aggregateProviderStats(logs: any[]) {
  type ProviderStats = {
    count: number;
    totalCost: number;
    totalTime: number;
    avgCost: number;
    avgTime: number;
  };

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

      acc[log.provider].count += 1;
      acc[log.provider].totalCost += Number(log.cost);
      acc[log.provider].totalTime += log.generationTime;
      return acc;
    },
    {} as Record<string, ProviderStats>
  );

  (Object.values(byProvider) as ProviderStats[]).forEach((stats) => {
    stats.avgCost = stats.totalCost / stats.count;
    stats.avgTime = stats.totalTime / stats.count;
  });
  return byProvider;
}

function mapRecentLogs(logs: any[]) {
  return logs.slice(0, 10).map((log) => ({
    id: log.id,
    provider: log.provider,
    cost: Number(log.cost),
    generationTime: log.generationTime,
    status: log.status,
    createdAt: log.createdAt,
  }));
}

function buildLogDateFilter(startDate?: string, endDate?: string) {
  if (!startDate || !endDate) {
    return {};
  }
  return {
    createdAt: {
      gte: new Date(startDate),
      lte: new Date(endDate),
    },
  };
}

function createAnalyticsHandler() {
  return async (request: any, reply: any) => {
    try {
      const { brandId } = request.params as { brandId: string };
      const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };
      const userId = request.user!.id;
      const brand = await loadBrandOwner(brandId);
      const accessError = assertUserCanAccessBrand(brand as any, userId);
      if (accessError) {
        return reply.code(accessError.statusCode).send(accessError.body);
      }

      const logs = await prisma.imageGenerationLog.findMany({
        where: {
          brandId,
          ...buildLogDateFilter(startDate, endDate),
        },
        orderBy: { createdAt: 'desc' },
      });

      const byProvider = aggregateProviderStats(logs);
      const totalCount = logs.length;
      const totalCost = logs.reduce((sum, log) => sum + Number(log.cost), 0);
      return reply.send({
        overall: {
          totalGenerated: totalCount,
          totalCost,
          avgCostPerImage: totalCount > 0 ? totalCost / totalCount : 0,
        },
        byProvider,
        recentLogs: mapRecentLogs(logs),
      });
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Failed to get image provider analytics');
      return reply.code(500).send({ error: 'Failed to retrieve analytics' });
    }
  };
}

const imageProviderRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', createListProvidersHandler());

  fastify.get<{ Params: { brandId: string } }>(
    '/:brandId/preference',
    { preHandler: fastify.authenticate },
    createGetPreferenceHandler()
  );

  fastify.post<{ Params: { brandId: string }; Body: z.infer<typeof ProviderPreferenceSchema> }>(
    '/:brandId/preference',
    { preHandler: fastify.authenticate },
    createSetPreferenceHandler()
  );

  fastify.get<{
    Params: { brandId: string };
    Querystring: { startDate?: string; endDate?: string };
  }>('/:brandId/analytics', { preHandler: fastify.authenticate }, createAnalyticsHandler());
};

export default imageProviderRoutes;
