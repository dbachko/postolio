import Bull from 'bull';
import { logger as baseLogger } from '@postolio/logger';
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
  CAMPAIGN_WINDOW_MAINTENANCE = 'campaign-window-maintenance',
  PUBLISHING_QUEUE_WINDOW_MAINTENANCE = 'publishing-queue-window-maintenance',
  NOTIFICATION_RETENTION = 'notification-retention',
  INBOX_COMMENTS_INGEST = 'inbox-comments-ingest',
  INBOX_COMMENTS_BACKFILL = 'inbox-comments-backfill',
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

    this.queue.process(JobType.CAMPAIGN_WINDOW_MAINTENANCE, async () => {
      return await this.processCampaignWindowMaintenance();
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

    // Campaign sliding window maintenance - every 30 minutes
    await this.queue.add(
      JobType.CAMPAIGN_WINDOW_MAINTENANCE,
      { type: JobType.CAMPAIGN_WINDOW_MAINTENANCE },
      {
        repeat: {
          cron: '*/30 * * * *',
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
    const start = Date.now();
    const maxAgeDays = Number(process.env.NOTIFICATION_RETENTION_DAYS || 90);
    const { notificationsService } = await import('./notifications.js');
    const res = await notificationsService.purgeOld(maxAgeDays);
    return { deletedCount: res.deleted, duration: Date.now() - start };
  }

  private async processInboxCommentsIngest(job: Bull.Job<JobData>): Promise<{
    brandId: string;
    postsProcessed: number;
    commentsUpserted: number;
    duration: number;
  }> {
    const start = Date.now();
    const brandId = String(job.data.metadata?.brandId ?? '').trim();
    const maxPosts = Number(job.data.metadata?.maxPosts ?? 50);
    const perPostLimit = Number(job.data.metadata?.perPostLimit ?? 100);
    const minStaleMs = Number(job.data.metadata?.minStaleMs ?? 0);

    if (!brandId) {
      throw new Error('Missing brandId for inbox comments ingest job');
    }

    await job.progress(5);

    const { ingestBrandComments } = await import('./inbox-comments-ingestor.js');
    await job.progress(15);

    const result = await ingestBrandComments(
      brandId,
      Number.isFinite(maxPosts) ? maxPosts : 50,
      Number.isFinite(perPostLimit) ? perPostLimit : 100,
      {
        minStaleMs: Number.isFinite(minStaleMs) ? minStaleMs : 0,
      }
    );
    await job.progress(100);

    return {
      brandId,
      ...result,
      duration: Date.now() - start,
    };
  }

  private async processInboxCommentsBackfill(job: Bull.Job<JobData>): Promise<{
    brandsTotal: number;
    brandsProcessed: number;
    brandsFailed: number;
    postsProcessed: number;
    commentsUpserted: number;
    duration: number;
  }> {
    const start = Date.now();
    const prisma = (await import('../config/database.js')).getDatabaseClient();
    const { ingestBrandComments } = await import('./inbox-comments-ingestor.js');

    const maxPosts = Number(
      job.data.metadata?.maxPosts ?? process.env.INBOX_COMMENTS_BACKFILL_MAX_POSTS ?? 20
    );
    const perPostLimit = Number(
      job.data.metadata?.perPostLimit ?? process.env.INBOX_COMMENTS_BACKFILL_PER_POST_LIMIT ?? 50
    );
    const minStaleMs = Number(
      job.data.metadata?.minStaleMs ??
        process.env.INBOX_COMMENTS_BACKFILL_MIN_STALE_MS ??
        15 * 60 * 1000
    );

    const brands = await prisma.brand.findMany({
      where: { socialAccounts: { some: { platform: { in: ['instagram', 'facebook'] } } } },
      select: { id: true },
    });

    const safeMaxPosts = Number.isFinite(maxPosts) ? maxPosts : 20;
    const safePerPostLimit = Number.isFinite(perPostLimit) ? perPostLimit : 50;
    const safeMinStaleMs = Number.isFinite(minStaleMs) ? minStaleMs : 15 * 60 * 1000;

    let brandsProcessed = 0;
    let brandsFailed = 0;
    let postsProcessed = 0;
    let commentsUpserted = 0;

    for (let i = 0; i < brands.length; i++) {
      const brand = brands[i];
      try {
        const res = await ingestBrandComments(brand.id, safeMaxPosts, safePerPostLimit, {
          minStaleMs: safeMinStaleMs,
        });
        brandsProcessed++;
        postsProcessed += res.postsProcessed;
        commentsUpserted += res.commentsUpserted;
      } catch (error) {
        brandsFailed++;
        this.logger.warn('Inbox comments backfill failed for brand', {
          brandId: brand.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await job.progress(Math.min(99, Math.round(((i + 1) / brands.length) * 100)));
    }

    await job.progress(100);

    return {
      brandsTotal: brands.length,
      brandsProcessed,
      brandsFailed,
      postsProcessed,
      commentsUpserted,
      duration: Date.now() - start,
    };
  }

  private async processCampaignWindowMaintenance(): Promise<{
    processed: number;
    generated: number;
  }> {
    const start = Date.now();
    let processed = 0;
    let generated = 0;
    try {
      const prisma = (await import('../config/database.js')).getDatabaseClient();
      const { campaignSlidingWindowService } = await import('./campaign-sliding-window.js');
      const { getMaxScheduledAheadForTier } = await import('../constants/subscription.js');

      // Find active campaigns with user info; cap batch size to avoid long jobs
      const campaigns = await prisma.campaign.findMany({
        where: { status: 'active' },
        select: {
          id: true,
          brand: { select: { userId: true, user: { select: { subscriptionTier: true } } } },
        },
        take: 200,
        orderBy: { updatedAt: 'desc' },
      });

      // Group by user
      const byUser = new Map<string, { tier: string; campaignIds: string[] }>();
      for (const c of campaigns) {
        const userId = c.brand.userId;
        const tier = c.brand.user?.subscriptionTier || 'free';
        const entry = byUser.get(userId) || { tier, campaignIds: [] };
        entry.campaignIds.push(c.id);
        byUser.set(userId, entry);
      }

      // Distribute in rounds across each user's campaigns
      for (const [userId, info] of byUser) {
        const now = new Date();
        const maxAhead = getMaxScheduledAheadForTier(info.tier);
        let remaining = Number.POSITIVE_INFINITY;
        if (Number.isFinite(maxAhead)) {
          const current = await prisma.content.count({
            where: {
              brand: { userId },
              scheduledAt: { gte: now },
              status: { in: ['scheduled', 'draft'] },
            },
          });
          remaining = Math.max(0, (maxAhead as number) - current);
        }
        if (remaining <= 0) continue;

        const ids = info.campaignIds;
        const maxRounds = Math.min(remaining, 50);
        for (let round = 0; round < maxRounds; round++) {
          let roundGenerated = 0;
          for (const id of ids) {
            processed += 1;
            try {
              const res = await campaignSlidingWindowService.maintainWindow(id, 1);
              if (res.generated && res.generated > 0) {
                generated += res.generated;
                roundGenerated += res.generated;
                if (Number.isFinite(remaining)) remaining -= res.generated;
                if (remaining <= 0) break;
              }
            } catch {
              // continue
            }
          }
          if (remaining <= 0 || roundGenerated === 0) break;
        }
      }

      this.logger.info('Campaign window maintenance completed', {
        processed,
        generated,
        durationMs: Date.now() - start,
      });
      return { processed, generated };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Campaign window maintenance error', {
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
      });
      return { processed, generated };
    }
  }

  private async processPublishingQueueWindowMaintenance(): Promise<{
    processed: number;
    assigned: number;
    scheduled: number;
    rescheduled: number;
    cancelled: number;
    errors: number;
  }> {
    const start = Date.now();
    let processed = 0;
    let assigned = 0;
    let scheduled = 0;
    let rescheduled = 0;
    let cancelled = 0;
    let errors = 0;

    try {
      const prisma = (await import('../config/database.js')).getDatabaseClient();
      const { publishingQueueScheduler } = await import('./publishing-queue/queue-scheduler.js');

      const batchSize = (() => {
        const raw = process.env.PUBLISHING_QUEUE_WINDOW_MAINTENANCE_BATCH_SIZE;
        const n = raw ? parseInt(raw, 10) : 50;
        return Number.isFinite(n) ? Math.max(1, Math.min(500, n)) : 50;
      })();

      const lookbackMinutes = (() => {
        const raw = process.env.PUBLISHING_QUEUE_WINDOW_MAINTENANCE_LOOKBACK_MINUTES;
        const n = raw ? parseInt(raw, 10) : 15;
        return Number.isFinite(n) ? Math.max(1, Math.min(180, n)) : 15;
      })();
      const since = new Date(Date.now() - lookbackMinutes * 60 * 1000);

      const brands = await prisma.content.findMany({
        where: {
          updatedAt: { gte: since },
          publishingQueueItem: { isNot: null },
        },
        select: { brandId: true },
        distinct: ['brandId'],
        take: batchSize,
        orderBy: { updatedAt: 'desc' },
      });

      for (const b of brands) {
        processed += 1;
        try {
          const res = await publishingQueueScheduler.recomputeBrandWindow(b.brandId);
          assigned += res.assigned;
          scheduled += res.scheduled;
          rescheduled += res.rescheduled;
          cancelled += res.cancelled;
          errors += res.errors.length;
        } catch {
          errors += 1;
        }
      }

      this.logger.info('Publishing queue window maintenance completed', {
        processed,
        assigned,
        scheduled,
        rescheduled,
        cancelled,
        errors,
        durationMs: Date.now() - start,
      });

      return { processed, assigned, scheduled, rescheduled, cancelled, errors };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Publishing queue window maintenance error', {
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
      });
      return { processed, assigned, scheduled, rescheduled, cancelled, errors };
    }
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
