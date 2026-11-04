/**
 * Scheduler Adapter Service
 * Adapter for AWS Content Scheduler integration
 */

import type { ContentStatus } from '@postolio/database';
import {
  ContentSchedulerClient,
  type ContentSchedulerConfig,
} from '../clients/content-scheduler-client.js';
import { getDatabaseClient } from '../config/database.js';
import type { StatusBroadcaster } from './status-broadcaster.js';
import type { GenerationParams } from '../types/scheduler.js';
import { logger } from '@postolio/logger';
import { scheduleContentImpl } from './scheduler-adapter-schedule.js';
import { publishNowImpl } from './scheduler-adapter-publish.js';
import { rescheduleContentImpl } from './scheduler-adapter-reschedule.js';
import { updateScheduledContentImpl } from './scheduler-adapter-update.js';
import {
  getScheduledContentImpl,
  getSchedulingStatsImpl,
  logInconsistencyImpl,
} from './scheduler-adapter-stats.js';
export { deriveScheduleMediaType } from './scheduler-adapter-shared.js';

const prisma = getDatabaseClient();

export class SchedulerAdapter {
  private _client: ContentSchedulerClient | null = null;
  private _clientPromise: Promise<ContentSchedulerClient> | null = null;
  private static instance: SchedulerAdapter | null = null;
  private broadcaster: StatusBroadcaster | null = null;

  private schedulerEnabled = true;

  private constructor(private config?: Partial<ContentSchedulerConfig>) {
    // Configuration stored for lazy initialization
  }

  static async create(config?: Partial<ContentSchedulerConfig>): Promise<SchedulerAdapter> {
    const adapter = new SchedulerAdapter(config);
    // Trigger initialization immediately
    await adapter.client;
    return adapter;
  }

  /**
   * Lazy-initialized client getter with automatic service discovery
   */
  private get client(): Promise<ContentSchedulerClient> {
    if (!this._clientPromise) {
      this._clientPromise = this.initializeClient();
    }
    return this._clientPromise;
  }

  private async initializeClient(): Promise<ContentSchedulerClient> {
    try {
      const client = await ContentSchedulerClient.create({
        timeout: 30000,
        maxRetries: 3,
        ...this.config,
      });

      logger.info('ContentSchedulerClient initialized with service discovery');
      this.schedulerEnabled = true;
      this._client = client;
      return client;
    } catch (error) {
      logger.error('Failed to initialize ContentSchedulerClient', { error });

      // Fallback: try with alternative environment variable
      const fallbackUrl = process.env.SCHEDULER_API_URL || 'http://localhost:4000';

      // Check if scheduler is properly configured
      const isPlaceholderUrl =
        fallbackUrl.includes('your-scheduler-api') ||
        fallbackUrl.includes('scheduler-api-not-configured') ||
        fallbackUrl.includes('example.com');

      if (isPlaceholderUrl) {
        logger.warn('AWS Content Scheduler is not configured properly', { baseURL: fallbackUrl });
        logger.warn(
          'Running in degraded mode - content will be saved but not scheduled for automatic publishing.'
        );
        logger.warn(
          'To enable scheduling, deploy the ContentScheduler stack or set SCHEDULER_API_URL to a valid endpoint.'
        );
        this.schedulerEnabled = false;
        throw new Error('Scheduler not configured - degraded mode', { cause: error });
      } else {
        // Try with fallback URL
        try {
          const client = new ContentSchedulerClient({
            baseURL: fallbackUrl,
            timeout: 30000,
            maxRetries: 3,
            ...this.config,
          });
          logger.warn('Using fallback ContentScheduler URL', { baseURL: fallbackUrl });
          this.schedulerEnabled = true;
          this._client = client;
          return client;
        } catch (fallbackError) {
          logger.error('Failed to initialize ContentScheduler with fallback URL', {
            error: fallbackError,
          });
          this.schedulerEnabled = false;
          throw fallbackError;
        }
      }
    }
  }

  /**
   * Set the status broadcaster for real-time updates
   */
  setBroadcaster(broadcaster: StatusBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  /**
   * Get the client instance (for testing purposes only)
   * @internal
   */
  getClient(): ContentSchedulerClient | null {
    return this._client;
  }

  /**
   * Get singleton instance (deprecated - use create() for proper async initialization)
   */
  static getInstance(config?: Partial<ContentSchedulerConfig>): SchedulerAdapter {
    if (!SchedulerAdapter.instance) {
      SchedulerAdapter.instance = new SchedulerAdapter(config);
    }
    return SchedulerAdapter.instance;
  }

  /**
   * Get singleton instance with proper async initialization
   */
  static async getInstanceAsync(
    config?: Partial<ContentSchedulerConfig>
  ): Promise<SchedulerAdapter> {
    if (!SchedulerAdapter.instance) {
      SchedulerAdapter.instance = await SchedulerAdapter.create(config);
    }
    return SchedulerAdapter.instance;
  }

  /**
   * Schedule content with timezone-aware handling and proper consistency
   */
  async scheduleContent(
    contentId: string,
    customTime?: Date,
    userId?: string
  ): Promise<{
    success: boolean;
    scheduleId?: string;
    brandId?: string;
    error?: string;
  }> {
    return scheduleContentImpl(this, contentId, customTime, userId);
  }

  /**
   * Publish content immediately via the scheduler pipeline.
   *
   * This creates/updates a schedule record with scheduledAt=now and emits schedule.due right away.
   * The publisher uses the schedule record as the source of truth for publishing payload.
   */
  async publishNow(
    contentId: string,
    userId?: string
  ): Promise<{
    success: boolean;
    scheduleId?: string;
    brandId?: string;
    error?: string;
  }> {
    return publishNowImpl(this, contentId, userId);
  }

  /**
   * Cancel scheduled content with proper consistency
   */
  async cancelSchedule(contentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const content = await this.getContentForCancellation(contentId);
      if (!content) {
        return { success: false, error: 'Content not found' };
      }

      const generationParams = (content.generationParams as GenerationParams | null) || {};
      const scheduleRef = await this.resolveCancellationScheduleRef(
        contentId,
        content,
        generationParams
      );
      const awsCancelled = await this.cancelAwsScheduleIfPresent(contentId, content, scheduleRef);
      await this.persistCancelledContent(
        contentId,
        generationParams,
        awsCancelled,
        scheduleRef.wasAwsScheduled
      );

      if (this.broadcaster) {
        await this.broadcaster.broadcastStatusChange(
          content.id,
          content.brandId,
          'scheduled',
          'draft',
          { cancelled: true }
        );
      }

      return { success: true };
    } catch (error) {
      logger.error('Error canceling schedule', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async getContentForCancellation(contentId: string) {
    return prisma.content.findUnique({
      where: { id: contentId },
      include: { brand: { select: { id: true, userId: true } } },
    });
  }

  private async resolveCancellationScheduleRef(
    contentId: string,
    content: { brand: { id: string; userId: string } | null },
    generationParams: GenerationParams
  ) {
    let scheduleId = generationParams.scheduleId;
    let wasAwsScheduled = generationParams.awsScheduleCreated;
    if ((scheduleId && wasAwsScheduled) || !content.brand?.id) {
      return { scheduleId, wasAwsScheduled };
    }

    try {
      const list = await (await this.client).getUpcomingSchedules(content.brand.id, 50);
      const match = list.find((schedule) => schedule.contentId === contentId);
      if (match) {
        scheduleId = match.scheduleId;
        wasAwsScheduled = true;
      }
    } catch (listErr) {
      logger.warn('Failed to list schedules for fallback cancel lookup', {
        error: listErr,
        brandId: content.brand.id,
      });
    }
    return { scheduleId, wasAwsScheduled };
  }

  private async cancelAwsScheduleIfPresent(
    contentId: string,
    content: { brand: { userId: string } | null },
    ref: { scheduleId?: string | null; wasAwsScheduled?: boolean | null }
  ) {
    if (!ref.scheduleId || !ref.wasAwsScheduled || !content.brand?.userId) {
      return false;
    }

    try {
      await (await this.client).deleteSchedule(ref.scheduleId, { userId: content.brand.userId });
      logger.info('AWS schedule cancelled successfully', { scheduleId: ref.scheduleId });
      return true;
    } catch (error: unknown) {
      const code = (error as { code?: string } | undefined)?.code;
      if (code === 'NOT_FOUND') {
        logger.info('AWS schedule already deleted', { scheduleId: ref.scheduleId });
        return true;
      }
      if (code === 'CIRCUIT_BREAKER_OPEN' || code === 'EOPENBREAKER') {
        logger.warn('Circuit breaker open - continuing with local cancellation only');
      } else if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
        logger.warn('Network or timeout error - continuing with local cancellation only');
      } else if (code === 'SERVICE_BUSY') {
        logger.warn('Scheduler service busy - continuing with local cancellation only');
      } else {
        logger.error('Failed to cancel in AWS', { error });
        await this.logInconsistency(contentId, 'AWS_CANCEL_FAILED', {
          scheduleId: ref.scheduleId,
          error,
        });
      }
      return false;
    }
  }

  private async persistCancelledContent(
    contentId: string,
    generationParams: GenerationParams,
    awsCancelled: boolean,
    wasAwsScheduled: boolean | null | undefined
  ) {
    await prisma.content.update({
      where: { id: contentId },
      data: {
        status: 'draft' as ContentStatus,
        scheduledAt: null,
        schedulingError:
          awsCancelled || !wasAwsScheduled ? null : 'Warning: AWS schedule may still be active',
        generationParams: JSON.parse(
          JSON.stringify({
            ...generationParams,
            scheduleId: null,
            awsScheduleCreated: false,
            cancelledAt: new Date().toISOString(),
          })
        ),
      },
    });
  }

  /**
   * Reschedule content to new time with timezone awareness
   */
  async rescheduleContent(
    contentId: string,
    newTime: Date,
    isLocalTime = true
  ): Promise<{ success: boolean; error?: string }> {
    return rescheduleContentImpl(this, contentId, newTime, isLocalTime);
  }

  /**
   * Sync the AWS schedule payload (caption/media/etc) without changing time.
   * This keeps scheduled posts accurate when users edit them after scheduling.
   */
  async updateScheduledContent(contentId: string): Promise<{ success: boolean; error?: string }> {
    return updateScheduledContentImpl(this, contentId);
  }

  /**
   * Get scheduled content for a brand with proper typing
   */
  async getScheduledContent(
    brandId: string,
    limit = 10
  ): Promise<
    Array<{
      id: string;
      brandId: string;
      caption: string;
      status: string;
      scheduledAt: Date | null;
      scheduleId?: string;
      source: 'aws' | 'local' | 'merged';
    }>
  > {
    return getScheduledContentImpl(this, brandId, limit);
  }

  /**
   * Get scheduling statistics with proper typing
   */
  async getSchedulingStats(brandId: string): Promise<{
    aws: { total: number; upcoming: number; failed: number } | null;
    local: {
      total: number;
      scheduled: number;
      draft: number;
      published: number;
    };
    synced: boolean;
  }> {
    return getSchedulingStatsImpl(this, brandId);
  }

  /**
   * Health check for scheduler service
   */
  async healthCheck(): Promise<boolean> {
    try {
      return await (await this.client).healthCheck();
    } catch (error) {
      logger.error('Scheduler health check failed', { error });
      return false;
    }
  }

  /**
   * Get circuit breaker stats
   */
  getCircuitBreakerStats(): {
    opened: boolean;
    failures: number;
    successes: number;
    fallbacks: number;
  } {
    if (!this._client) {
      return {
        opened: false,
        failures: 0,
        successes: 0,
        fallbacks: 0,
      };
    }
    const stats = this._client.getCircuitBreakerStats() as unknown as {
      open?: boolean;
      failures: number;
      successes: number;
      fallbacks: number;
    };
    return {
      opened: !!stats.open,
      failures: stats.failures,
      successes: stats.successes,
      fallbacks: stats.fallbacks,
    };
  }

  /**
   * Log data inconsistency for monitoring and reconciliation
   */
  private async logInconsistency(
    contentId: string,
    type:
      | 'AWS_SCHEDULE_WITHOUT_LOCAL'
      | 'AWS_CANCEL_FAILED'
      | 'LOCAL_WITHOUT_AWS'
      | 'DATA_MISMATCH'
      | 'LOCAL_DB_UPDATE_FAILED_AFTER_AWS_SUCCESS',
    details: Record<string, unknown>
  ): Promise<void> {
    await logInconsistencyImpl(contentId, type, details);
  }
}

// Export singleton instance. We intentionally avoid logging deprecation warnings here
// because this synchronous accessor is safe: the underlying client is lazily
// initialized via the async `client` getter when first used.
export const schedulerAdapter = SchedulerAdapter.getInstance();
