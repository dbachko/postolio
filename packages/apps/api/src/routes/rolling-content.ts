import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { rollingContentService } from "../services/rolling-content.js";
import { getDatabaseClient } from "../config/database.js";

const prisma = getDatabaseClient();

interface BrandParams {
  brandId: string;
}

function ensureAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): request is FastifyRequest & { user: { id: string } } {
  if (!request.user || !request.user.id) {
    reply.code(401).send({ success: false, error: "Authentication required" });
    return false;
  }
  return true;
}

const rollingContentRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Get queue status for a brand
   */
  fastify.get(
    "/queue-status/:brandId",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            brandId: { type: "string" },
          },
          required: ["brandId"],
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) return;
        const { brandId } = request.params as BrandParams;

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: request.user.id,
          },
        });

        if (!brand) {
          return reply.code(404).send({
            success: false,
            error: "Brand not found or access denied",
          });
        }

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
        console.error("Get queue status error:", error);
        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  /**
   * Manually trigger rolling content generation for a brand
   */
  fastify.post(
    "/generate/:brandId",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            brandId: { type: "string" },
          },
          required: ["brandId"],
        },
        body: {
          type: "object",
          properties: {
            campaignId: { type: "string" },
          },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) return;
        const { brandId } = request.params as BrandParams;
        const { campaignId } = request.body as { campaignId?: string };

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: request.user.id,
          },
        });

        if (!brand) {
          return reply.code(404).send({
            success: false,
            error: "Brand not found or access denied",
          });
        }

        const result = await rollingContentService.triggerManual(
          brandId,
          campaignId,
        );

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
        console.error("Manual rolling generation error:", error);
        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  /**
   * Check rolling generation needs for a brand
   */
  fastify.get(
    "/check/:brandId",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            brandId: { type: "string" },
          },
          required: ["brandId"],
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) return;
        const { brandId } = request.params as BrandParams;

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: request.user.id,
          },
        });

        if (!brand) {
          return reply.code(404).send({
            success: false,
            error: "Brand not found or access denied",
          });
        }

        const queueStatus = await rollingContentService.getQueueStatus(brandId);

        // Check if this brand should be generating content
        await rollingContentService.checkAndGenerateContent(brandId);

        const updatedQueueStatus =
          await rollingContentService.getQueueStatus(brandId);

        return reply.send({
          success: true,
          data: {
            brandId,
            brandName: brand.name,
            before: queueStatus,
            after: updatedQueueStatus,
            actionTaken: queueStatus.needsGeneration
              ? "generation_triggered"
              : "no_action_needed",
          },
        });
      } catch (error) {
        console.error("Check rolling generation error:", error);
        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  /**
   * Get all brands' queue statuses for monitoring
   */
  fastify.get(
    "/overview",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) return;
        const userId = request.user.id;

        // Get all user's brands with Instagram integration
        const brands = await prisma.brand.findMany({
          where: {
            userId,
            instagramPageId: { not: null },
          },
        });

        const brandStatuses = await Promise.all(
          brands.map(async (brand) => {
            try {
              const queueStatus = await rollingContentService.getQueueStatus(
                brand.id,
              );
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
                error: error instanceof Error ? error.message : "Unknown error",
                lastChecked: new Date().toISOString(),
              };
            }
          }),
        );

        const summary = {
          totalBrands: brands.length,
          brandsNeedingContent: brandStatuses.filter((b) => b.needsGeneration)
            .length,
          brandsWithSufficientContent: brandStatuses.filter(
            (b) => !b.needsGeneration,
          ).length,
          totalScheduledPosts: brandStatuses.reduce(
            (sum, b) => sum + (b.totalScheduled || 0),
            0,
          ),
        };

        return reply.send({
          success: true,
          data: {
            summary,
            brands: brandStatuses,
          },
        });
      } catch (error) {
        console.error("Get rolling content overview error:", error);
        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );
};

export default rollingContentRoutes;
