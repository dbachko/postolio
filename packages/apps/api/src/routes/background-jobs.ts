import { FastifyPluginAsync } from 'fastify';
import { backgroundJobs, JobType } from '../services/background-jobs.js';

const backgroundJobsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Get background job queue statistics
   */
  fastify.get('/api/admin/jobs/stats', 
    { preHandler: fastify.authenticate }, 
    async (request, reply) => {
      try {
        const stats = await backgroundJobs.getStats();
        return reply.send(stats);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ 
          error: 'Failed to get job statistics' 
        });
      }
    }
  );

  /**
   * Get recent jobs
   */
  fastify.get<{ Querystring: { limit?: string } }>(
    '/api/admin/jobs/recent',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const limit = request.query.limit ? parseInt(request.query.limit) : 10;
        const jobs = await backgroundJobs.getRecentJobs(limit);
        
        // Transform jobs to simpler format
        const jobList = jobs.map(job => ({
          id: job.id,
          name: job.name,
          data: job.data,
          progress: job.progress(),
          attemptsMade: job.attemptsMade,
          finishedOn: job.finishedOn,
          processedOn: job.processedOn,
          failedReason: job.failedReason,
          stacktrace: job.stacktrace,
        }));
        
        return reply.send(jobList);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ 
          error: 'Failed to get recent jobs' 
        });
      }
    }
  );

  /**
   * Trigger a one-time token cleanup job
   */
  fastify.post('/api/admin/jobs/cleanup',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const job = await backgroundJobs.scheduleJob(
          JobType.TOKEN_CLEANUP,
          { triggeredBy: request.user!.id }
        );
        
        return reply.send({
          success: true,
          jobId: job.id,
          message: 'Token cleanup job scheduled',
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ 
          error: 'Failed to schedule cleanup job' 
        });
      }
    }
  );

  /**
   * Trigger token migration job (one-time migration from KEYS to Sets)
   */
  fastify.post('/api/admin/jobs/migrate',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const job = await backgroundJobs.scheduleJob(
          JobType.TOKEN_MIGRATION,
          { triggeredBy: request.user!.id }
        );
        
        return reply.send({
          success: true,
          jobId: job.id,
          message: 'Token migration job scheduled',
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ 
          error: 'Failed to schedule migration job' 
        });
      }
    }
  );

  /**
   * Trigger integrity check job
   */
  fastify.post('/api/admin/jobs/integrity-check',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const job = await backgroundJobs.scheduleJob(
          JobType.TOKEN_INTEGRITY_CHECK,
          { triggeredBy: request.user!.id }
        );
        
        return reply.send({
          success: true,
          jobId: job.id,
          message: 'Integrity check job scheduled',
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ 
          error: 'Failed to schedule integrity check job' 
        });
      }
    }
  );

  /**
   * Clear all completed/failed jobs (for testing)
   */
  fastify.delete('/api/admin/jobs/clean',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        // Only allow in development/test environments
        if (process.env.NODE_ENV === 'production') {
          return reply.code(403).send({ 
            error: 'Job cleanup not allowed in production' 
          });
        }
        
        await backgroundJobs.clean();
        
        return reply.send({
          success: true,
          message: 'All jobs cleaned',
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ 
          error: 'Failed to clean jobs' 
        });
      }
    }
  );
};

export default backgroundJobsRoutes;