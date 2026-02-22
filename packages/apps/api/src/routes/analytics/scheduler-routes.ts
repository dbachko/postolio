import type { FastifyPluginAsync } from 'fastify';
import { schedulerService } from '../../services/scheduler.js';
import { schedulerAdapter } from '../../services/scheduler-adapter.js';
import { getDatabaseClient } from '../../config/database.js';
import { assertBrandOwnership } from '../../services/ownership.js';
import { ensureAuth } from './shared.js';

const prisma = getDatabaseClient();

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

export const schedulerAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  // Schedule content for posting
  fastify.post(
    '/analytics/schedule',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }
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
              userId,
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
        request.log.error({ err: error }, 'Failed to schedule content');
        throw error;
      }
    }
  );

  // Get scheduled posts for a brand
  fastify.get(
    '/analytics/scheduled/:brandId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }
        const { brandId } = request.params as BrandParams;
        const userId = request.user.id;

        // Verify brand ownership
        await assertBrandOwnership(userId, brandId);

        const scheduledPosts = await schedulerService.getUpcomingPosts(brandId);

        reply.send({ scheduledPosts });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to get scheduled posts');
        throw error;
      }
    }
  );

  // Cancel a scheduled post
  fastify.delete(
    '/analytics/scheduled/:contentId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }
        const { contentId } = request.params as ContentParams;
        const userId = request.user.id;

        // Verify content ownership
        const content = await prisma.content.findFirst({
          where: {
            id: contentId,
            brand: {
              userId,
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
        request.log.error({ err: error }, 'Failed to cancel scheduled post');
        throw error;
      }
    }
  );

  // Reschedule a post
  fastify.put(
    '/analytics/reschedule',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }
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
              userId,
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
        request.log.error({ err: error }, 'Failed to reschedule post');
        throw error;
      }
    }
  );

  // Bulk schedule multiple content items
  fastify.post(
    '/analytics/bulk-schedule',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }
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
              userId,
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
        request.log.error({ err: error }, 'Failed to bulk schedule content');
        throw error;
      }
    }
  );

  // Get scheduling statistics for a brand
  fastify.get(
    '/analytics/stats/:brandId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }
        const { brandId } = request.params as BrandParams;
        const userId = request.user.id;

        // Verify brand ownership
        await assertBrandOwnership(userId, brandId);

        const stats = await schedulerService.getSchedulingStats(brandId);

        reply.send({ stats });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to get scheduling statistics');
        throw error;
      }
    }
  );

  // Legacy metrics collection endpoint (410 Gone)
  fastify.post(
    '/analytics/collect-metrics/:contentId',
    { preHandler: fastify.authenticate },
    async (_request, reply) => {
      return reply
        .code(410)
        .send({ error: 'Endpoint removed. Metrics are collected by Analytics v2 ingestion.' });
    }
  );
};
