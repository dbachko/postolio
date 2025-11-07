import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { analyticsService } from '../services/analytics.js';
import { schedulerService } from '../services/scheduler.js';
import { schedulerAdapter } from '../services/scheduler-adapter.js';

import { getDatabaseClient } from '../config/database.js';
import { z } from 'zod';
import { validateBody } from '../middleware/validation.js';
import type { preHandlerHookHandler } from 'fastify';

const prisma = getDatabaseClient();

// Request helper types
interface BrandParams {
  brandId: string;
}
interface ContentParams {
  contentId: string;
}
interface ScheduleBody {
  contentId: string;
  customTime?: string;
}
interface RescheduleBody {
  contentId: string;
  newTime: string;
}
interface BulkScheduleBody {
  contentIds: string[];
  startTime?: string;
}

function ensureAuth(
  request: FastifyRequest,
  reply: FastifyReply
): request is FastifyRequest & { user: { id: string; email: string } } {
  if (!request.user || !request.user.id) {
    reply.code(401).send({ error: 'Authentication required' });
    return false;
  }
  return true;
}

const analytics: FastifyPluginAsync = async function (fastify) {
  // Get analytics report for a brand
  fastify.get(
    '/report/:brandId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;
        const { brandId } = request.params as BrandParams;
        const { days = 30 } = request.query as { days?: number };
        const userId = request.user.id;

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: userId,
          },
        });

        if (!brand) {
          return reply.status(404).send({ error: 'Brand not found' });
        }

        const report = await analyticsService.generateAnalyticsReport(brandId, days);

        reply.send({ report });
      } catch (error) {
        reply.status(500).send({
          error: 'Failed to generate analytics report',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Get optimal posting times for a brand
  fastify.get(
    '/optimal-times/:brandId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;
        const { brandId } = request.params as BrandParams;
        const userId = request.user.id;

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: userId,
          },
        });

        if (!brand) {
          return reply.status(404).send({ error: 'Brand not found' });
        }

        const optimalTimes = await analyticsService.analyzeOptimalTimes(brandId);

        reply.send({
          optimalTimes: optimalTimes.map((time) => ({
            ...time,
            dayName: analyticsService.getDayName(time.dayOfWeek),
            timeFormatted: analyticsService.formatHour(time.hour),
          })),
        });
      } catch (error) {
        reply.status(500).send({
          error: 'Failed to analyze optimal times',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Get scheduling recommendation for new content
  fastify.get(
    '/schedule-recommendation/:brandId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;
        const { brandId } = request.params as BrandParams;
        // timezone query param accepted but currently unused; retain parsing if future logic needs it
        // const { timezone = "UTC" } = request.query as { timezone?: string };
        const userId = request.user.id;

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: userId,
          },
        });

        if (!brand) {
          return reply.status(404).send({ error: 'Brand not found' });
        }

        // timezone currently unused in scheduling recommendation service; could be integrated later
        const recommendation = await analyticsService.getSchedulingRecommendation(brandId);

        reply.send({ recommendation });
      } catch (error) {
        reply.status(500).send({
          error: 'Failed to get scheduling recommendation',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Schedule content for posting
  fastify.post('/schedule', { preHandler: fastify.authenticate }, async function (request, reply) {
    try {
      if (!ensureAuth(request, reply)) return;
      const { contentId, customTime } = request.body as ScheduleBody;

      if (!contentId) {
        return reply.status(400).send({ error: 'contentId is required' });
      }

      const userId = request.user.id;

      // Verify content ownership
      const content = await prisma.content.findFirst({
        where: {
          id: contentId,
          brand: {
            userId: userId,
          },
        },
      });

      if (!content) {
        return reply.status(404).send({ error: 'Content not found' });
      }

      // Allow scheduling from draft, failed, or skipped states
      if (!['draft', 'failed', 'skipped'].includes(content.status as string)) {
        return reply.status(400).send({
          error: 'Content must be draft, failed, or skipped to schedule',
        });
      }

      const customTimeDate = customTime ? new Date(customTime) : undefined;
      const result = await schedulerAdapter.scheduleContent(
        contentId,
        customTimeDate,
        request.user.id
      );

      if (result.success) {
        reply.send({
          success: true,
          scheduleId: result.scheduleId,
          brandId: result.brandId,
        });
      } else {
        reply.status(400).send({
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      reply.status(500).send({
        error: 'Failed to schedule content',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Wizard funnel event logging
  const WizardEventSchema = z.object({
    eventName: z.enum(['wizard.step', 'wizard.reset', 'wizard.launch']),
    step: z.number().int().min(1).max(7).optional(), // Updated to 7 for new wizard steps
    brandId: z.string().min(1).optional(),
  });
  fastify.post(
    '/wizard-event',
    {
      preHandler: [
        fastify.authenticate,
        validateBody(WizardEventSchema) as unknown as preHandlerHookHandler,
      ],
    },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) return;
        const userId = request.user.id;
        const email = request.user.email;
        const { eventName, step, brandId } = request.body as z.infer<typeof WizardEventSchema>;

        // Persist as audit log for lightweight analytics
        await prisma.auditLog.create({
          data: {
            userId,
            email,
            eventType: 'wizard.event',
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'] || null,
            metadata: {
              eventName,
              step,
              brandId,
              path: request.url,
              timestamp: new Date().toISOString(),
            },
            success: true,
          },
        });

        return reply.send({ success: true });
      } catch (error) {
        request.log.error({ error }, 'Failed to log wizard event');
        return reply.code(500).send({ error: 'Failed to log wizard event' });
      }
    }
  );

  // Get scheduled posts for a brand
  fastify.get(
    '/scheduled/:brandId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;
        const { brandId } = request.params as BrandParams;
        const userId = request.user.id;

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: userId,
          },
        });

        if (!brand) {
          return reply.status(404).send({ error: 'Brand not found' });
        }

        const scheduledPosts = await schedulerService.getUpcomingPosts(brandId);

        reply.send({ scheduledPosts });
      } catch (error) {
        reply.status(500).send({
          error: 'Failed to get scheduled posts',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Cancel a scheduled post
  fastify.delete(
    '/scheduled/:contentId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;
        const { contentId } = request.params as ContentParams;
        const userId = request.user.id;

        // Verify content ownership
        const content = await prisma.content.findFirst({
          where: {
            id: contentId,
            brand: {
              userId: userId,
            },
          },
        });

        if (!content) {
          return reply.status(404).send({ error: 'Content not found' });
        }

        const success = await schedulerService.cancelScheduledPost(contentId);

        if (success) {
          reply.send({ success: true });
        } else {
          reply.status(500).send({ success: false, error: 'Failed to cancel scheduled post' });
        }
      } catch (error) {
        reply.status(500).send({
          error: 'Failed to cancel scheduled post',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Reschedule a post
  fastify.put('/reschedule', { preHandler: fastify.authenticate }, async function (request, reply) {
    try {
      if (!ensureAuth(request, reply)) return;
      const { contentId, newTime } = request.body as RescheduleBody;

      if (!contentId || !newTime) {
        return reply.status(400).send({ error: 'contentId and newTime are required' });
      }

      const userId = request.user.id;

      // Verify content ownership
      const content = await prisma.content.findFirst({
        where: {
          id: contentId,
          brand: {
            userId: userId,
          },
        },
      });

      if (!content) {
        return reply.status(404).send({ error: 'Content not found' });
      }

      const result = await schedulerService.reschedulePost(contentId, new Date(newTime));

      if (result.success) {
        reply.send({ success: true });
      } else {
        reply.status(400).send({
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      reply.status(500).send({
        error: 'Failed to reschedule post',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Bulk schedule multiple content items
  fastify.post(
    '/bulk-schedule',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;
        const { contentIds, startTime } = request.body as BulkScheduleBody;

        if (!contentIds || !Array.isArray(contentIds) || contentIds.length === 0) {
          return reply.status(400).send({ error: 'contentIds array is required' });
        }

        const userId = request.user.id;

        // Verify all content ownership
        const contents = await prisma.content.findMany({
          where: {
            id: { in: contentIds },
            brand: {
              userId: userId,
            },
          },
        });

        if (contents.length !== contentIds.length) {
          return reply.status(404).send({ error: 'Some content items not found' });
        }

        const customStartTime = startTime ? new Date(startTime) : undefined;
        const results = await schedulerService.bulkSchedule(contentIds, customStartTime);

        reply.send({
          success: true,
          results,
        });
      } catch (error) {
        reply.status(500).send({
          error: 'Failed to bulk schedule content',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Get scheduling statistics for a brand
  fastify.get(
    '/stats/:brandId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;
        const { brandId } = request.params as BrandParams;
        const userId = request.user.id;

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId: userId,
          },
        });

        if (!brand) {
          return reply.status(404).send({ error: 'Brand not found' });
        }

        const stats = await schedulerService.getSchedulingStats(brandId);

        reply.send({ stats });
      } catch (error) {
        reply.status(500).send({
          error: 'Failed to get scheduling statistics',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Collect metrics for a specific post
  fastify.post(
    '/collect-metrics/:contentId',
    { preHandler: fastify.authenticate },
    async function (request, reply) {
      try {
        if (!ensureAuth(request, reply)) return;
        const { contentId } = request.params as ContentParams;
        const userId = request.user.id;

        // Verify content ownership
        const content = await prisma.content.findFirst({
          where: {
            id: contentId,
            brand: {
              userId: userId,
            },
          },
        });

        if (!content) {
          return reply.status(404).send({ error: 'Content not found' });
        }

        if (content.status !== 'published') {
          return reply.status(400).send({ error: 'Content must be posted to collect metrics' });
        }

        const metrics = await analyticsService.collectPostMetrics(contentId);

        if (metrics) {
          reply.send({
            success: true,
            metrics,
          });
        } else {
          reply.status(400).send({
            success: false,
            error: 'Failed to collect metrics',
          });
        }
      } catch (error) {
        reply.status(500).send({
          error: 'Failed to collect post metrics',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
};

export default analytics;
