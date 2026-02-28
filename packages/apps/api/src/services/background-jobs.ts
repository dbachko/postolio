import Bull from 'bull';
import { logger as baseLogger } from '@postolio/logger';
import { getRedisUrl } from '../utils/redis-url.js';
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
 * Uses Bull queue with Redis backend
 */
export class BackgroundJobQueue {
  private queue: Bull.Queue<JobData>;
  private tokenStore: RedisTokenStore;
  private logger = baseLogger.child({ module: 'background-job-queue' });

  constructor() {
    // Initialize Bull queue with Redis connection
    this.queue = new Bull('background-jobs', getRedisUrl(), {
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

    // Register job processors
    this.registerProcessors();

    // Register event handlers
    this.registerEventHandlers();
  }

  /**
   * Register job processors
   */
  private registerProcessors(): void {
    this.queue.process(JobType.TOKEN_CLEANUP, async (job) => {
      return await this.processTokenCleanup(job);
    });

    this.queue.process(JobType.TOKEN_MIGRATION, async (job) => {
      return await this.processTokenMigration(job);
    });

    this.queue.process(JobType.TOKEN_INTEGRITY_CHECK, async (job) => {
      return await this.processTokenIntegrityCheck(job);
    });

    this.queue.process(JobType.AUDIT_LOG_CLEANUP, async (job) => {
      return await this.processAuditLogCleanup(job);
    });

    this.queue.process(JobType.PUBLISHING_QUEUE_WINDOW_MAINTENANCE, async () => {
      return await this.processPublishingQueueWindowMaintenance();
    });

    this.queue.process(JobType.NOTIFICATION_RETENTION, async () => {
      return await this.processNotificationRetention();
    });

    this.queue.process(JobType.INBOX_COMMENTS_INGEST, async (job) => {
      return await this.processInboxCommentsIngest(job);
    });

    this.queue.process(JobType.INBOX_COMMENTS_BACKFILL, async (job) => {
      return await this.processInboxCommentsBackfill(job);
    });

    this.queue.process(JobType.INBOX_DMS_INGEST, async (job) => {
      return await this.processInboxDMsIngest(job);
    });

    this.queue.process(JobType.RECIPE_RUN_EXECUTE, async (job) => {
      const runIdRaw = job.data.metadata?.runId;
      const runId = typeof runIdRaw === 'string' ? runIdRaw : '';
      if (!runId) {
        throw new Error('Missing runId for recipe run execute job');
      }

      const { executeRecipeRun } = await import('./recipe-runs/run-executor.js');
      return await executeRecipeRun(runId);
    });
  }

  /**
   * Register event handlers for monitoring
   */
  private registerEventHandlers(): void {
    this.queue.on('completed', (job, result) => {
      this.logger.info('Background job completed', {
        jobId: job.id,
        type: job.data.type,
        result,
      });
    });

    this.queue.on('failed', (job, err) => {
      this.logger.error('Background job failed', {
        jobId: job?.id,
        type: job?.data?.type,
        error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
    });

    this.queue.on('stalled', (job) => {
      this.logger.warn('Background job stalled', {
        jobId: job.id,
        type: job.data.type,
      });
    });
  }

  /**
   * Process token cleanup job
   */
  private async processTokenCleanup(job: Bull.Job<JobData>): Promise<CleanupResult> {
    return processTokenCleanupJob(job);
  }

  /**
   * Process token migration job (one-time migration from KEYS to Sets)
   */
  private async processTokenMigration(job: Bull.Job<JobData>): Promise<{
    migrated: number;
    errors: string[];
    duration: number;
  }> {
    return processTokenMigrationJob(job, this.tokenStore);
  }

  /**
   * Process token integrity check job
   */
  private async processTokenIntegrityCheck(job: Bull.Job<JobData>): Promise<{
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
  private async processAuditLogCleanup(job: Bull.Job<JobData>): Promise<{
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
    options?: Bull.JobOptions
  ): Promise<Bull.Job<JobData>> {
    return await this.queue.add(type, { type, metadata }, options);
  }

  /**
   * Schedule recurring jobs
   */
  async scheduleRecurringJobs(): Promise<void> {
    // Token cleanup - every 6 hours
    await this.queue.add(
      JobType.TOKEN_CLEANUP,
      { type: JobType.TOKEN_CLEANUP },
      {
        repeat: {
          cron: '0 */6 * * *', // Every 6 hours
        },
      }
    );

    // Token integrity check - daily at 3 AM
    await this.queue.add(
      JobType.TOKEN_INTEGRITY_CHECK,
      { type: JobType.TOKEN_INTEGRITY_CHECK },
      {
        repeat: {
          cron: '0 3 * * *', // Daily at 3 AM
        },
      }
    );

    // Audit log cleanup - weekly on Sunday at 4 AM
    await this.queue.add(
      JobType.AUDIT_LOG_CLEANUP,
      { type: JobType.AUDIT_LOG_CLEANUP },
      {
        repeat: {
          cron: '0 4 * * 0', // Weekly on Sunday at 4 AM
        },
      }
    );

    // Publishing queue window maintenance - every 5 minutes
    await this.queue.add(
      JobType.PUBLISHING_QUEUE_WINDOW_MAINTENANCE,
      { type: JobType.PUBLISHING_QUEUE_WINDOW_MAINTENANCE },
      {
        repeat: {
          cron: '*/5 * * * *',
        },
      }
    );

    // Notification retention cleanup - daily at 2:30 AM
    await this.queue.add(
      JobType.NOTIFICATION_RETENTION,
      { type: JobType.NOTIFICATION_RETENTION },
      {
        repeat: {
          cron: '30 2 * * *',
        },
      }
    );

    // Inbox comments backfill (optional; calls external APIs) - hourly by default
    if (process.env.ENABLE_INBOX_COMMENTS_BACKFILL === 'true') {
      await this.queue.add(
        JobType.INBOX_COMMENTS_BACKFILL,
        { type: JobType.INBOX_COMMENTS_BACKFILL },
        {
          repeat: {
            cron: process.env.INBOX_COMMENTS_BACKFILL_CRON || '0 * * * *',
          },
        }
      );
    }

    this.logger.info('Recurring background jobs scheduled');
  }

  private async processNotificationRetention(): Promise<CleanupResult> {
    return processNotificationRetentionJob();
  }

  private async processInboxCommentsIngest(job: Bull.Job<JobData>): Promise<{
    brandId: string;
    postsProcessed: number;
    commentsUpserted: number;
    duration: number;
  }> {
    return processInboxCommentsIngestJob(job);
  }

  private async processInboxCommentsBackfill(job: Bull.Job<JobData>): Promise<{
    brandsTotal: number;
    brandsProcessed: number;
    brandsFailed: number;
    postsProcessed: number;
    commentsUpserted: number;
    duration: number;
  }> {
    return processInboxCommentsBackfillJob(job, this.logger);
  }

  private async processInboxDMsIngest(job: Bull.Job<JobData>): Promise<{
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
  async getRecentJobs(limit = 10): Promise<Array<Bull.Job<JobData>>> {
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
    await this.queue.clean(0, 'completed');
    await this.queue.clean(0, 'failed');
    await this.queue.clean(0, 'wait');
    await this.queue.clean(0, 'active');
    await this.queue.clean(0, 'delayed');
  }

  /**
   * Gracefully shutdown the queue
   */
  async shutdown(): Promise<void> {
    await this.queue.close();
  }
}

// Export singleton instance
export const backgroundJobs = new BackgroundJobQueue();
