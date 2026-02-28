import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { getDatabaseClient } from '../../config/database.js';
import { assertBrandOwnership } from '../../services/ownership.js';
import { schedulerAdapter } from '../../services/scheduler-adapter.js';
import { schedulerService } from '../../services/scheduler.js';
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

async function findOwnedContent(userId: string, contentId: string) {
  return prisma.content.findFirst({
    where: {
      id: contentId,
      brand: { userId },
    },
  });
}

function registerScheduleRoute(fastify: FastifyInstance): void {
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

        const content = await findOwnedContent(request.user.id, contentId);
        if (!content) {
          return reply.status(404).send({ error: 'Content not found' });
        }
        if (!['draft', 'failed', 'skipped'].includes(content.status as string)) {
          return reply.status(400).send({
            error: 'Content must be draft, failed, or skipped to schedule',
          });
        }

        const result = await schedulerAdapter.scheduleContent(
          contentId,
          customTime ? new Date(customTime) : undefined,
          request.user.id
        );

        if (!result.success) {
          return reply.status(400).send({ success: false, error: result.error });
        }

        return reply.send({
          success: true,
          scheduleId: result.scheduleId,
          brandId: result.brandId,
        });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to schedule content');
        throw error;
      }
    }
  );
}

function registerScheduledPostsRoute(fastify: FastifyInstance): void {
  fastify.get(
    '/analytics/scheduled/:brandId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }

        const { brandId } = request.params as BrandParams;
        await assertBrandOwnership(request.user.id, brandId);

        const scheduledPosts = await schedulerService.getUpcomingPosts(brandId);
        return reply.send({ scheduledPosts });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to get scheduled posts');
        throw error;
      }
    }
  );
}

function registerCancelScheduledPostRoute(fastify: FastifyInstance): void {
  fastify.delete(
    '/analytics/scheduled/:contentId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }

        const { contentId } = request.params as ContentParams;
        const content = await findOwnedContent(request.user.id, contentId);
        if (!content) {
          return reply.status(404).send({ error: 'Content not found' });
        }

        const success = await schedulerService.cancelScheduledPost(contentId);
        if (!success) {
          return reply
            .status(500)
            .send({ success: false, error: 'Failed to cancel scheduled post' });
        }

        return reply.send({ success: true });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to cancel scheduled post');
        throw error;
      }
    }
  );
}

function registerRescheduleRoute(fastify: FastifyInstance): void {
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

        const content = await findOwnedContent(request.user.id, contentId);
        if (!content) {
          return reply.status(404).send({ error: 'Content not found' });
        }

        const result = await schedulerService.reschedulePost(contentId, new Date(newTime));
        if (!result.success) {
          return reply.status(400).send({ success: false, error: result.error });
        }

        return reply.send({ success: true });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to reschedule post');
        throw error;
      }
    }
  );
}

function registerBulkScheduleRoute(fastify: FastifyInstance): void {
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

        const contents = await prisma.content.findMany({
          where: {
            id: { in: contentIds },
            brand: { userId: request.user.id },
          },
        });

        if (contents.length !== contentIds.length) {
          return reply.status(404).send({ error: 'Some content items not found' });
        }

        const results = await schedulerService.bulkSchedule(
          contentIds,
          startTime ? new Date(startTime) : undefined
        );
        return reply.send({ success: true, results });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to bulk schedule content');
        throw error;
      }
    }
  );
}

function registerStatsRoute(fastify: FastifyInstance): void {
  fastify.get(
    '/analytics/stats/:brandId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        if (!ensureAuth(request, reply)) {
          return;
        }

        const { brandId } = request.params as BrandParams;
        await assertBrandOwnership(request.user.id, brandId);

        const stats = await schedulerService.getSchedulingStats(brandId);
        return reply.send({ stats });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to get scheduling statistics');
        throw error;
      }
    }
  );
}

function registerLegacyMetricsRoute(fastify: FastifyInstance): void {
  fastify.post(
    '/analytics/collect-metrics/:contentId',
    { preHandler: fastify.authenticate },
    async (_request, reply) => {
      return reply
        .code(410)
        .send({ error: 'Endpoint removed. Metrics are collected by Analytics v2 ingestion.' });
    }
  );
}

export const schedulerAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  registerScheduleRoute(fastify);
  registerScheduledPostsRoute(fastify);
  registerCancelScheduledPostRoute(fastify);
  registerRescheduleRoute(fastify);
  registerBulkScheduleRoute(fastify);
  registerStatsRoute(fastify);
  registerLegacyMetricsRoute(fastify);
};
