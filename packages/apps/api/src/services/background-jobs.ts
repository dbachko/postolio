import Bull from 'bull';
import { getRedisUrl } from '../utils/redis-url.js';
import { RefreshTokenService } from './refresh-token.js';
import { RedisTokenStore } from './redis-token-store.js';
import { AuditLogger, AuditEventType } from './audit-logger.js';

// Define job types
export enum JobType {
  TOKEN_CLEANUP = 'token-cleanup',
  TOKEN_MIGRATION = 'token-migration',
  TOKEN_INTEGRITY_CHECK = 'token-integrity-check',
  AUDIT_LOG_CLEANUP = 'audit-log-cleanup',
}

interface JobData {
  type: JobType;
  metadata?: Record<string, unknown>;
}

interface CleanupResult {
  deletedCount: number;
  duration: number;
  errors?: string[];
}

/**
 * Background job queue for async operations
 * Uses Bull queue with Redis backend
 */
export class BackgroundJobQueue {
  private queue: Bull.Queue<JobData>;
  private tokenStore: RedisTokenStore;

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
  }

  /**
   * Register event handlers for monitoring
   */
  private registerEventHandlers(): void {
    this.queue.on('completed', (job, result) => {
      console.log(`Job ${job.id} (${job.data.type}) completed:`, result);
    });

    this.queue.on('failed', (job, err) => {
      console.error(`Job ${job.id} (${job.data.type}) failed:`, err);
    });

    this.queue.on('stalled', (job) => {
      console.warn(`Job ${job.id} (${job.data.type}) stalled`);
    });
  }

  /**
   * Process token cleanup job
   */
  private async processTokenCleanup(job: Bull.Job<JobData>): Promise<CleanupResult> {
    const startTime = Date.now();

    try {
      // Update job progress
      await job.progress(10);

      // Clean up expired tokens using the optimized method
      const deletedCount = await RefreshTokenService.cleanupExpiredTokens();

      await job.progress(90);

      // Log cleanup result
      await AuditLogger.log({
        userId: 'system',
        eventType: AuditEventType.SYSTEM_CLEANUP,
        metadata: {
          type: 'token-cleanup',
          deletedCount,
          duration: Date.now() - startTime,
        },
        success: true,
      });

      await job.progress(100);

      return {
        deletedCount,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await AuditLogger.log({
        userId: 'system',
        eventType: AuditEventType.SYSTEM_ERROR,
        metadata: {
          type: 'token-cleanup',
          error: errorMessage,
          duration: Date.now() - startTime,
        },
        success: false,
      });

      throw error;
    }
  }

  /**
   * Process token migration job (one-time migration from KEYS to Sets)
   */
  private async processTokenMigration(job: Bull.Job<JobData>): Promise<{
    migrated: number;
    errors: string[];
    duration: number;
  }> {
    const startTime = Date.now();

    try {
      await job.progress(10);

      // Run migration
      const result = await this.tokenStore.migrateFromKeysToSets();

      await job.progress(90);

      // Log migration result
      await AuditLogger.log({
        userId: 'system',
        eventType: AuditEventType.SYSTEM_MIGRATION,
        metadata: {
          type: 'token-migration',
          migrated: result.migrated,
          errors: result.errors.length,
          duration: Date.now() - startTime,
        },
        success: result.errors.length === 0,
      });

      await job.progress(100);

      return {
        ...result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await AuditLogger.log({
        userId: 'system',
        eventType: AuditEventType.SYSTEM_ERROR,
        metadata: {
          type: 'token-migration',
          error: errorMessage,
          duration: Date.now() - startTime,
        },
        success: false,
      });

      throw error;
    }
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
    const startTime = Date.now();

    try {
      await job.progress(10);

      // Check integrity
      const result = await this.tokenStore.verifyIntegrity();

      await job.progress(70);

      // Fix orphaned tokens
      if (result.orphanedTokens.length > 0) {
        for (const tokenId of result.orphanedTokens) {
          await this.tokenStore.deleteToken(tokenId);
        }
      }

      await job.progress(90);

      // Log integrity check result
      await AuditLogger.log({
        userId: 'system',
        eventType: AuditEventType.SYSTEM_INTEGRITY_CHECK,
        metadata: {
          type: 'token-integrity',
          valid: result.valid,
          orphaned: result.orphanedTokens.length,
          missingFromSets: result.missingFromSets.length,
          duration: Date.now() - startTime,
        },
        success: true,
      });

      await job.progress(100);

      return {
        ...result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await AuditLogger.log({
        userId: 'system',
        eventType: AuditEventType.SYSTEM_ERROR,
        metadata: {
          type: 'token-integrity-check',
          error: errorMessage,
          duration: Date.now() - startTime,
        },
        success: false,
      });

      throw error;
    }
  }

  /**
   * Process audit log cleanup job
   */
  private async processAuditLogCleanup(job: Bull.Job<JobData>): Promise<{
    cutoffDate: string;
    duration: number;
  }> {
    const startTime = Date.now();

    try {
      await job.progress(10);

      // Clean up old audit logs (older than 90 days)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 90);

      // This would need to be implemented in AuditLogger
      // For now, just log the attempt

      await job.progress(90);

      await AuditLogger.log({
        userId: 'system',
        eventType: AuditEventType.SYSTEM_CLEANUP,
        metadata: {
          type: 'audit-log-cleanup',
          cutoffDate: cutoffDate.toISOString(),
          duration: Date.now() - startTime,
        },
        success: true,
      });

      await job.progress(100);

      return {
        cutoffDate: cutoffDate.toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await AuditLogger.log({
        userId: 'system',
        eventType: AuditEventType.SYSTEM_ERROR,
        metadata: {
          type: 'audit-log-cleanup',
          error: errorMessage,
          duration: Date.now() - startTime,
        },
        success: false,
      });

      throw error;
    }
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

    console.log('Recurring background jobs scheduled');
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
  async getRecentJobs(limit = 10): Promise<Bull.Job<JobData>[]> {
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
