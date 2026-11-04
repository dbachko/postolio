import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { logger as baseLogger } from '@postolio/logger';
import { getQueueOptions } from './queue-config.js';
import { RedisTokenStore } from './redis-token-store.js';
import { JobType, type JobData, type CleanupResult } from './background-jobs/types.js';
import {
  processAuditLogCleanupJob,
  processTokenCleanupJob,
  processTokenIntegrityCheckJob,
  processTokenMigrationJob,
} from './background-jobs/token-processors.js';
import {
  processInboxCommentsBackfillJob,
  processInboxCommentsIngestJob,
  processInboxDMsIngestJob,
  processNotificationRetentionJob,
  processPublishingQueueWindowMaintenanceJob,
} from './background-jobs/operational-processors.js';

export { JobType } from './background-jobs/types.js';

/**
 * Background job queue for async operations
 * Uses BullMQ with Redis backend
 */
export class BackgroundJobQueue {
  private queue: Queue<JobData>;
  private worker: Worker<JobData>;
  private tokenStore: RedisTokenStore;
  private logger = baseLogger.child({ module: 'background-job-queue' });

  constructor() {
    this.queue = new Queue<JobData>('background-jobs', {
      ...getQueueOptions(),
      defaultJobOptions: {
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 500, // Keep last 500 failed jobs
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    });

    this.tokenStore = new RedisTokenStore();

    this.worker = this.createWorker();

    // Register event handlers
    this.registerEventHandlers();
  }

  /**
   * One worker handles every job type. Bull added one unit of concurrency per named
   * processor, so 10 keeps the previous throughput.
   */
  private createWorker(): Worker<JobData> {
    const processors: Record<string, (job: Job<JobData>) => Promise<unknown>> = {
      [JobType.TOKEN_CLEANUP]: async (job: Job<JobData>) => {
        return await this.processTokenCleanup(job);
      },

      [JobType.TOKEN_MIGRATION]: async (job: Job<JobData>) => {
        return await this.processTokenMigration(job);
      },

      [JobType.TOKEN_INTEGRITY_CHECK]: async (job: Job<JobData>) => {
        return await this.processTokenIntegrityCheck(job);
      },

      [JobType.AUDIT_LOG_CLEANUP]: async (job: Job<JobData>) => {
        return await this.processAuditLogCleanup(job);
      },

      [JobType.PUBLISHING_QUEUE_WINDOW_MAINTENANCE]: async () => {
        return await this.processPublishingQueueWindowMaintenance();
      },

      [JobType.NOTIFICATION_RETENTION]: async () => {
        return await this.processNotificationRetention();
      },

      [JobType.INBOX_COMMENTS_INGEST]: async (job: Job<JobData>) => {
        return await this.processInboxCommentsIngest(job);
      },

      [JobType.INBOX_COMMENTS_BACKFILL]: async (job: Job<JobData>) => {
        return await this.processInboxCommentsBackfill(job);
      },

      [JobType.INBOX_DMS_INGEST]: async (job: Job<JobData>) => {
        return await this.processInboxDMsIngest(job);
      },

      [JobType.RECIPE_RUN_EXECUTE]: async (job: Job<JobData>) => {
        const runIdRaw = job.data.metadata?.runId;
        const runId = typeof runIdRaw === 'string' ? runIdRaw : '';
        if (!runId) {
          throw new Error('Missing runId for recipe run execute job');
        }

        const { executeRecipeRun } = await import('./recipe-runs/run-executor.js');
        return await executeRecipeRun(runId);
      },
    };

    return new Worker<JobData>(
      'background-jobs',
      async (job) => {
        const processor = processors[job.name];
        if (!processor) {
          throw new Error(`No processor registered for job '${job.name}'`);
        }
        return processor(job);
      },
      { ...getQueueOptions(), concurrency: 10 }
    );
  }

  /**
   * Register event handlers for monitoring
   */
  private registerEventHandlers(): void {
    this.worker.on('completed', (job, result) => {
      this.logger.info('Background job completed', {
        jobId: job.id,
        type: job.data.type,
        result,
      });
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error('Background job failed', {
        jobId: job?.id,
        type: job?.data?.type,
        error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
    });

    this.worker.on('stalled', (jobId) => {
      this.logger.warn('Background job stalled', { jobId });
    });

    const logQueueError = (err: Error) => {
      this.logger.error('Background job queue error', { error: err.message });
    };
    this.queue.on('error', logQueueError);
    this.worker.on('error', logQueueError);
  }

  /**
   * Process token cleanup job
   */
  private async processTokenCleanup(job: Job<JobData>): Promise<CleanupResult> {
    return processTokenCleanupJob(job);
  }

  /**
   * Process token migration job (one-time migration from KEYS to Sets)
   */
  private async processTokenMigration(job: Job<JobData>): Promise<{
    migrated: number;
    errors: string[];
    duration: number;
  }> {
    return processTokenMigrationJob(job, this.tokenStore);
  }

  /**
   * Process token integrity check job
   */
  private async processTokenIntegrityCheck(job: Job<JobData>): Promise<{
    valid: boolean;
    orphanedTokens: string[];
    missingFromSets: string[];
    duration: number;
  }> {
    return processTokenIntegrityCheckJob(job, this.tokenStore);
  }

  /**
   * Process audit log cleanup job
   */
  private async processAuditLogCleanup(job: Job<JobData>): Promise<{
    cutoffDate: string;
    duration: number;
  }> {
    return processAuditLogCleanupJob(job);
  }

  /**
   * Schedule a job
   */
  async scheduleJob(
    type: JobType,
    metadata?: Record<string, unknown>,
    options?: JobsOptions
  ): Promise<Job<JobData>> {
    return await this.queue.add(type, { type, metadata }, options);
  }

  /**
   * Schedule recurring jobs
   */
  async scheduleRecurringJobs(): Promise<void> {
    await this.upsertRecurringJob(JobType.TOKEN_CLEANUP, '0 */6 * * *'); // Every 6 hours
    await this.upsertRecurringJob(JobType.TOKEN_INTEGRITY_CHECK, '0 3 * * *'); // Daily at 3 AM
    await this.upsertRecurringJob(JobType.AUDIT_LOG_CLEANUP, '0 4 * * 0'); // Sundays at 4 AM
    await this.upsertRecurringJob(JobType.PUBLISHING_QUEUE_WINDOW_MAINTENANCE, '*/5 * * * *');
    await this.upsertRecurringJob(JobType.NOTIFICATION_RETENTION, '30 2 * * *'); // Daily at 2:30 AM

    // Inbox comments backfill (optional; calls external APIs) - hourly by default
    if (process.env.ENABLE_INBOX_COMMENTS_BACKFILL === 'true') {
      await this.upsertRecurringJob(
        JobType.INBOX_COMMENTS_BACKFILL,
        process.env.INBOX_COMMENTS_BACKFILL_CRON || '0 * * * *'
      );
    }

    this.logger.info('Recurring background jobs scheduled');
  }

  private async upsertRecurringJob(type: JobType, pattern: string): Promise<void> {
    await this.queue.upsertJobScheduler(type, { pattern }, { name: type, data: { type } });
  }

  private async processNotificationRetention(): Promise<CleanupResult> {
    return processNotificationRetentionJob();
  }

  private async processInboxCommentsIngest(job: Job<JobData>): Promise<{
    brandId: string;
    postsProcessed: number;
    commentsUpserted: number;
    duration: number;
  }> {
    return processInboxCommentsIngestJob(job);
  }

  private async processInboxCommentsBackfill(job: Job<JobData>): Promise<{
    brandsTotal: number;
    brandsProcessed: number;
    brandsFailed: number;
    postsProcessed: number;
    commentsUpserted: number;
    duration: number;
  }> {
    return processInboxCommentsBackfillJob(job, this.logger);
  }

  private async processInboxDMsIngest(job: Job<JobData>): Promise<{
    brandId: string;
    accountsProcessed: number;
    threadsProcessed: number;
    conversationsUpserted: number;
    messagesInserted: number;
    duration: number;
  }> {
    return processInboxDMsIngestJob(job);
  }

  private async processPublishingQueueWindowMaintenance(): Promise<{
    processed: number;
    assigned: number;
    scheduled: number;
    rescheduled: number;
    cancelled: number;
    errors: number;
  }> {
    return processPublishingQueueWindowMaintenanceJob(this.logger);
  }

  /**
   * Get job statistics
   */
  async getStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Get recent jobs
   */
  async getRecentJobs(limit = 10): Promise<Array<Job<JobData>>> {
    const jobs = await this.queue.getJobs(
      ['completed', 'failed', 'active', 'waiting', 'delayed'],
      0,
      limit
    );
    return jobs;
  }

  /**
   * Clean all jobs (for testing)
   */
  async clean(): Promise<void> {
    await this.queue.clean(0, 0, 'completed');
    await this.queue.clean(0, 0, 'failed');
    await this.queue.clean(0, 0, 'wait');
    await this.queue.clean(0, 0, 'active');
    await this.queue.clean(0, 0, 'delayed');
  }

  /**
   * Gracefully shutdown the queue
   */
  async shutdown(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }
}

// Export singleton instance
export const backgroundJobs = new BackgroundJobQueue();
