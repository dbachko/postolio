import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { rollingContentService } from '../services/rolling-content.js';
import { getDatabaseClient } from '../config/database.js';
import { assertBrandOwnership } from '../services/ownership.js';
import { APIError } from '@postolio/errors';

const prisma = getDatabaseClient();

interface BrandParams {
  brandId: string;
}

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

const rollingContentRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Get queue status for a brand
   */
  fastify.get(
    '/queue-status/:brandId',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            brandId: { type: 'string' },
          },
          required: ['brandId'],
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }
        const { brandId } = request.params as BrandParams;

        // Verify brand ownership
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
        if (error instanceof APIError) {
          throw error;
        }
        throw new APIError(
          error instanceof Error ? error.message : 'Failed to get rolling queue status',
          'ROLLING_CONTENT_QUEUE_STATUS_FAILED',
          500,
          { brandId: (request.params as BrandParams).brandId }
        );
      }
    }
  );

  /**
   * Manually trigger rolling content generation for a brand
   */
  fastify.post(
    '/generate/:brandId',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            brandId: { type: 'string' },
          },
          required: ['brandId'],
        },
        body: {
          type: 'object',
          properties: {},
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }
        const { brandId } = request.params as BrandParams;

        // Verify brand ownership
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
        if (error instanceof APIError) {
          throw error;
        }
        throw new APIError(
          error instanceof Error ? error.message : 'Failed to trigger rolling content generation',
          'ROLLING_CONTENT_GENERATE_FAILED',
          500,
          { brandId: (request.params as BrandParams).brandId }
        );
      }
    }
  );

  /**
   * Check rolling generation needs for a brand
   */
  fastify.get(
    '/check/:brandId',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            brandId: { type: 'string' },
          },
          required: ['brandId'],
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }
        const { brandId } = request.params as BrandParams;

        // Verify brand ownership
        const brand = await assertBrandOwnership(request.user.id, brandId);

        const queueStatus = await rollingContentService.getQueueStatus(brandId);

        // Check if this brand should be generating content
        await rollingContentService.checkAndGenerateContent(brandId);

        const updatedQueueStatus = await rollingContentService.getQueueStatus(brandId);

        return reply.send({
          success: true,
          data: {
            brandId,
            brandName: brand.name,
            before: queueStatus,
            after: updatedQueueStatus,
            actionTaken: queueStatus.needsGeneration ? 'generation_triggered' : 'no_action_needed',
          },
        });
      } catch (error) {
        request.log.error({ err: error }, 'Check rolling generation error');
        if (error instanceof APIError) {
          throw error;
        }
        throw new APIError(
          error instanceof Error ? error.message : 'Failed to check rolling content needs',
          'ROLLING_CONTENT_CHECK_FAILED',
          500,
          { brandId: (request.params as BrandParams).brandId }
        );
      }
    }
  );

  /**
   * Get all brands' queue statuses for monitoring
   */
  fastify.get('/overview', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      if (!ensureAuth(request, reply)) {
        return;
      }
      const userId = request.user.id;

      // Get all user's brands with Instagram integration
      const brandsWithInstagram = await prisma.socialAccount.findMany({
        where: {
          platform: 'instagram',
          brand: { userId },
        },
        include: {
          brand: true,
        },
      });

      const brands = brandsWithInstagram.map((sa) => sa.brand);

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

      const summary = {
        totalBrands: brands.length,
        brandsNeedingContent: brandStatuses.filter((b) => b.needsGeneration).length,
        brandsWithSufficientContent: brandStatuses.filter((b) => !b.needsGeneration).length,
        totalScheduledPosts: brandStatuses.reduce((sum, b) => sum + (b.totalScheduled || 0), 0),
      };

      return reply.send({
        success: true,
        data: {
          summary,
          brands: brandStatuses,
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'Get rolling content overview error');
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError(
        error instanceof Error ? error.message : 'Failed to get rolling content overview',
        'ROLLING_CONTENT_OVERVIEW_FAILED',
        500
      );
    }
  });
};

export default rollingContentRoutes;
