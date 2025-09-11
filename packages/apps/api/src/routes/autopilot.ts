import type { FastifyInstance } from 'fastify';

import { autopilotService } from '../services/autopilot.js';

import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

interface AutopilotConfigUpdate {
  enabled?: boolean;
  minDaysAhead?: number;
  maxContentPerGeneration?: number;
  contentStrategy?: {
    themes?: string[];
    postingFrequency?: 'daily' | 'every-other-day' | 'weekly';
    optimalTimes?: { hour: number; minute: number }[];
  };
}

export default async function autopilotRoutes(fastify: FastifyInstance) {
  // Authentication hook for all autopilot routes
  fastify.addHook('preHandler', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });

  /**
   * Manual trigger for autopilot content generation
   */
  fastify.post('/trigger', async (_request, reply) => {
    try {
      const result = await autopilotService.triggerManual();

      reply.send({
        success: result.success,
        message: result.message,
        data: {
          generated: result.generated,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('Autopilot trigger error:', error);
      reply.status(500).send({
        success: false,
        message: 'Failed to trigger autopilot generation',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * Get autopilot status for all brands
   */
  fastify.get('/status', async (_request, reply) => {
    try {
      const status = await autopilotService.getAutopilotStatus();

      reply.send({
        success: true,
        data: status,
      });
    } catch (error) {
      console.error('Autopilot status error:', error);
      reply.status(500).send({
        success: false,
        message: 'Failed to get autopilot status',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * Update autopilot configuration for a specific brand
   */
  fastify.patch(
    '/brands/:brandId/config',
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
          properties: {
            enabled: { type: 'boolean' },
            minDaysAhead: { type: 'number', minimum: 7, maximum: 30 },
            maxContentPerGeneration: {
              type: 'number',
              minimum: 1,
              maximum: 10,
            },
            contentStrategy: {
              type: 'object',
              properties: {
                themes: {
                  type: 'array',
                  items: { type: 'string' },
                },
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
        },
      },
    },
    async (request, reply) => {
      try {
        const { brandId } = request.params as { brandId: string };
        interface AutopilotConfigUpdate {
          enabled?: boolean;
          minDaysAhead?: number;
          maxContentPerGeneration?: number;
          contentStrategy?: {
            themes?: string[];
            postingFrequency?: 'daily' | 'every-other-day' | 'weekly';
            optimalTimes?: { hour: number; minute: number }[];
          };
        }
        const config = request.body as AutopilotConfigUpdate;

        // Verify user owns this brand
        const userId = (request.user as { id?: string } | undefined)?.id;
        if (!userId) {
          return reply.status(401).send({ success: false, message: 'Authentication required' });
        }
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: userId,
          },
        });

        if (!brand) {
          return reply.status(404).send({
            success: false,
            message: 'Brand not found or access denied',
          });
        }

        const success = await autopilotService.updateBrandConfig(brandId, config);

        if (success) {
          reply.send({
            success: true,
            message: 'Autopilot configuration updated successfully',
          });
        } else {
          reply.status(500).send({
            success: false,
            message: 'Failed to update autopilot configuration',
          });
        }
      } catch (error) {
        console.error('Autopilot config update error:', error);
        reply.status(500).send({
          success: false,
          message: 'Failed to update autopilot configuration',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * Get autopilot configuration for a specific brand
   */
  fastify.get(
    '/brands/:brandId/config',
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
    },
    async (request, reply) => {
      try {
        const { brandId } = request.params as { brandId: string };

        // Verify user owns this brand
        const userId = (request.user as { id?: string } | undefined)?.id;
        if (!userId) {
          return reply.status(401).send({ success: false, message: 'Authentication required' });
        }
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: userId,
          },
          select: {
            id: true,
            name: true,
            preferences: true,
          },
        });

        if (!brand) {
          return reply.status(404).send({
            success: false,
            message: 'Brand not found or access denied',
          });
        }

        type BrandPreferences = { autopilot?: unknown };
        const prefs = brand.preferences as BrandPreferences | null;
        const autopilotConfig = (prefs?.autopilot as AutopilotConfigUpdate | undefined) || {
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

        reply.send({
          success: true,
          data: {
            brandId: brand.id,
            brandName: brand.name,
            config: autopilotConfig,
          },
        });
      } catch (error) {
        console.error('Autopilot config fetch error:', error);
        reply.status(500).send({
          success: false,
          message: 'Failed to get autopilot configuration',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * Get content gaps analysis for all user's brands
   */
  fastify.get('/gaps', async (request, reply) => {
    try {
      const userId = (request.user as { id?: string } | undefined)?.id;
      if (!userId) {
        return reply.status(401).send({ success: false, message: 'Authentication required' });
      }

      // Get user's brands
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

      // Analyze gaps for each brand
      const gapsAnalysis = await Promise.all(
        brands.map(async (brand) => {
          const now = new Date();
          const futureDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

          const scheduledCount = await prisma.content.count({
            where: {
              brandId: brand.id,
              scheduledAt: {
                gte: now,
                lte: futureDate,
              },
            },
          });

          const expectedPosts = 14; // Assuming daily posting
          const gap = Math.max(0, expectedPosts - scheduledCount);

          return {
            brandId: brand.id,
            brandName: brand.name,
            scheduledNext14Days: scheduledCount,
            expectedPosts,
            contentGap: gap,
            needsGeneration: gap > 0,
            lastScheduled: brand.content[0]?.scheduledAt || null,
            recentContent: brand.content.map((c) => ({
              id: c.id,
              caption: c.caption.substring(0, 100) + '...',
              scheduledAt: c.scheduledAt,
              status: c.status,
            })),
          };
        })
      );

      reply.send({
        success: true,
        data: {
          analysis: gapsAnalysis,
          summary: {
            totalBrands: brands.length,
            brandsNeedingContent: gapsAnalysis.filter((g) => g.needsGeneration).length,
            totalGap: gapsAnalysis.reduce((sum, g) => sum + g.contentGap, 0),
          },
        },
      });
    } catch (error) {
      console.error('Autopilot gaps analysis error:', error);
      reply.status(500).send({
        success: false,
        message: 'Failed to analyze content gaps',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
