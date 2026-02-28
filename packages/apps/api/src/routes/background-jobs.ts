import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { backgroundJobs, JobType } from '../services/background-jobs.js';
import { deletionQueueService } from '../services/deletion-queue.js';

function registerJobStatsRoute(fastify: FastifyInstance): void {
  fastify.get(
    '/api/admin/jobs/stats',
    { preHandler: fastify.authenticate },
    async (_request, reply) => {
      try {
        const stats = await backgroundJobs.getStats();
        return reply.send(stats);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Failed to get job statistics' });
      }
    }
  );
}

function registerRecentJobsRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: { limit?: string } }>(
    '/api/admin/jobs/recent',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const limit = request.query.limit ? parseInt(request.query.limit) : 10;
        const jobs = await backgroundJobs.getRecentJobs(limit);

        return reply.send(
          jobs.map((job) => ({
            id: job.id,
            name: job.name,
            data: job.data,
            progress: job.progress(),
            attemptsMade: job.attemptsMade,
            finishedOn: job.finishedOn,
            processedOn: job.processedOn,
            failedReason: job.failedReason,
            stacktrace: job.stacktrace,
          }))
        );
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Failed to get recent jobs' });
      }
    }
  );
}

function registerJobTriggerRoute(
  fastify: FastifyInstance,
  options: {
    path: string;
    jobType: JobType;
    successMessage: string;
    errorMessage: string;
  }
): void {
  fastify.post(options.path, { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const job = await backgroundJobs.scheduleJob(options.jobType, {
        triggeredBy: request.user!.id,
      });

      return reply.send({
        success: true,
        jobId: job.id,
        message: options.successMessage,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: options.errorMessage });
    }
  });
}

function registerDeletionSweepRoute(fastify: FastifyInstance): void {
  fastify.post(
    '/api/admin/jobs/deletion-sweep',
    { preHandler: fastify.authenticate },
    async (_request, reply) => {
      try {
        const result = await deletionQueueService.sweepScheduledDeletions();
        return reply.send({ success: true, ...result });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Failed to run deletion sweep' });
      }
    }
  );
}

function registerCleanJobsRoute(fastify: FastifyInstance): void {
  fastify.delete(
    '/api/admin/jobs/clean',
    { preHandler: fastify.authenticate },
    async (_request, reply) => {
      try {
        if (process.env.NODE_ENV === 'prod') {
          return reply.code(403).send({ error: 'Job cleanup not allowed in production' });
        }

        await backgroundJobs.clean();
        return reply.send({ success: true, message: 'All jobs cleaned' });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Failed to clean jobs' });
      }
    }
  );
}

const backgroundJobsRoutes: FastifyPluginAsync = async (fastify) => {
  registerJobStatsRoute(fastify);
  registerRecentJobsRoute(fastify);
  registerJobTriggerRoute(fastify, {
    path: '/api/admin/jobs/cleanup',
    jobType: JobType.TOKEN_CLEANUP,
    successMessage: 'Token cleanup job scheduled',
    errorMessage: 'Failed to schedule cleanup job',
  });
  registerJobTriggerRoute(fastify, {
    path: '/api/admin/jobs/migrate',
    jobType: JobType.TOKEN_MIGRATION,
    successMessage: 'Token migration job scheduled',
    errorMessage: 'Failed to schedule migration job',
  });
  registerJobTriggerRoute(fastify, {
    path: '/api/admin/jobs/integrity-check',
    jobType: JobType.TOKEN_INTEGRITY_CHECK,
    successMessage: 'Integrity check job scheduled',
    errorMessage: 'Failed to schedule integrity check job',
  });
  registerDeletionSweepRoute(fastify);
  registerCleanJobsRoute(fastify);
};

export default backgroundJobsRoutes;
