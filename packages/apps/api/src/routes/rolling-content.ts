import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { APIError } from '@postolio/errors';

import { getDatabaseClient } from '../config/database.js';
import { assertBrandOwnership } from '../services/ownership.js';
import { rollingContentService } from '../services/rolling-content.js';

const prisma = getDatabaseClient();

interface BrandParams {
  brandId: string;
}

const BRAND_PARAMS_SCHEMA = {
  type: 'object',
  properties: { brandId: { type: 'string' } },
  required: ['brandId'],
};

function ensureAuth(
  request: FastifyRequest,
  reply: FastifyReply
): request is FastifyRequest & { user: { id: string } } {
  if (!request.user?.id) {
    reply.code(401).send({ success: false, error: 'Authentication required' });
    return false;
  }
  return true;
}

function wrapRollingError(
  error: unknown,
  code: string,
  fallbackMessage: string,
  details?: object
): never {
  if (error instanceof APIError) {
    throw error;
  }

  throw new APIError(error instanceof Error ? error.message : fallbackMessage, code, 500, details);
}

async function handleQueueStatus(
  request: FastifyRequest<{ Params: BrandParams }>,
  reply: FastifyReply
) {
  try {
    if (!ensureAuth(request, reply)) {
      return;
    }

    const { brandId } = request.params;
    const brand = await assertBrandOwnership(request.user.id, brandId);
    const queueStatus = await rollingContentService.getQueueStatus(brandId);

    return reply.send({
      success: true,
      data: {
        brandId,
        brandName: brand.name,
        ...queueStatus,
      },
    });
  } catch (error) {
    request.log.error({ err: error }, 'Get queue status error');
    wrapRollingError(
      error,
      'ROLLING_CONTENT_QUEUE_STATUS_FAILED',
      'Failed to get rolling queue status',
      {
        brandId: request.params.brandId,
      }
    );
  }
}

async function handleGenerate(
  request: FastifyRequest<{ Params: BrandParams }>,
  reply: FastifyReply
) {
  try {
    if (!ensureAuth(request, reply)) {
      return;
    }

    const { brandId } = request.params;
    const brand = await assertBrandOwnership(request.user.id, brandId);
    const result = await rollingContentService.triggerManual(brandId);

    return reply.send({
      success: result.success,
      data: {
        brandId,
        brandName: brand.name,
        generated: result.generated,
        message: result.message,
      },
      ...(result.success ? {} : { error: result.message }),
    });
  } catch (error) {
    request.log.error({ err: error }, 'Manual rolling generation error');
    wrapRollingError(
      error,
      'ROLLING_CONTENT_GENERATE_FAILED',
      'Failed to trigger rolling content generation',
      { brandId: request.params.brandId }
    );
  }
}

async function handleCheck(request: FastifyRequest<{ Params: BrandParams }>, reply: FastifyReply) {
  try {
    if (!ensureAuth(request, reply)) {
      return;
    }

    const { brandId } = request.params;
    const brand = await assertBrandOwnership(request.user.id, brandId);

    const before = await rollingContentService.getQueueStatus(brandId);
    await rollingContentService.checkAndGenerateContent(brandId);
    const after = await rollingContentService.getQueueStatus(brandId);

    return reply.send({
      success: true,
      data: {
        brandId,
        brandName: brand.name,
        before,
        after,
        actionTaken: before.needsGeneration ? 'generation_triggered' : 'no_action_needed',
      },
    });
  } catch (error) {
    request.log.error({ err: error }, 'Check rolling generation error');
    wrapRollingError(
      error,
      'ROLLING_CONTENT_CHECK_FAILED',
      'Failed to check rolling content needs',
      {
        brandId: request.params.brandId,
      }
    );
  }
}

async function handleOverview(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (!ensureAuth(request, reply)) {
      return;
    }

    const brandsWithInstagram = await prisma.socialAccount.findMany({
      where: { platform: 'instagram', brand: { userId: request.user.id } },
      include: { brand: true },
    });

    const brands = brandsWithInstagram.map((socialAccount) => socialAccount.brand);
    const brandStatuses = await Promise.all(
      brands.map(async (brand) => {
        try {
          const queueStatus = await rollingContentService.getQueueStatus(brand.id);
          return {
            brandId: brand.id,
            brandName: brand.name,
            ...queueStatus,
            lastChecked: new Date().toISOString(),
          };
        } catch (error) {
          return {
            brandId: brand.id,
            brandName: brand.name,
            totalScheduled: 0,
            daysAhead: 0,
            needsGeneration: true,
            minQueueSize: 7,
            maxQueueSize: 14,
            error: error instanceof Error ? error.message : 'Unknown error',
            lastChecked: new Date().toISOString(),
          };
        }
      })
    );

    return reply.send({
      success: true,
      data: {
        summary: {
          totalBrands: brands.length,
          brandsNeedingContent: brandStatuses.filter((item) => item.needsGeneration).length,
          brandsWithSufficientContent: brandStatuses.filter((item) => !item.needsGeneration).length,
          totalScheduledPosts: brandStatuses.reduce(
            (sum, item) => sum + (item.totalScheduled || 0),
            0
          ),
        },
        brands: brandStatuses,
      },
    });
  } catch (error) {
    request.log.error({ err: error }, 'Get rolling content overview error');
    wrapRollingError(
      error,
      'ROLLING_CONTENT_OVERVIEW_FAILED',
      'Failed to get rolling content overview'
    );
  }
}

function registerRollingContentRoutes(fastify: FastifyInstance): void {
  fastify.get('/queue-status/:brandId', {
    schema: { params: BRAND_PARAMS_SCHEMA },
    preHandler: fastify.authenticate,
    handler: handleQueueStatus,
  });

  fastify.post('/generate/:brandId', {
    schema: {
      params: BRAND_PARAMS_SCHEMA,
      body: { type: 'object', properties: {} },
    },
    preHandler: fastify.authenticate,
    handler: handleGenerate,
  });

  fastify.get('/check/:brandId', {
    schema: { params: BRAND_PARAMS_SCHEMA },
    preHandler: fastify.authenticate,
    handler: handleCheck,
  });

  fastify.get('/overview', {
    preHandler: fastify.authenticate,
    handler: handleOverview,
  });
}

const rollingContentRoutes: FastifyPluginAsync = async (fastify) => {
  registerRollingContentRoutes(fastify);
};

export default rollingContentRoutes;
