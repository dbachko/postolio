/**
 * Scheduler Adapter Service
 * Bridges the gap between legacy scheduler and new AWS Content Scheduler
 */

import { randomUUID } from 'crypto';
import { ContentStatus } from '@postolio/database';
import {
  ContentSchedulerClient,
  ContentSchedulerConfig,
} from '../clients/content-scheduler-client.js';
import { SCHEDULER_TIME_INTERVALS, SYNC_TOLERANCE } from '../constants/scheduler.js';
import { getDatabaseClient } from '../config/database.js';
import { TimezoneService } from './timezone.js';
import type { StatusBroadcaster } from './status-broadcaster.js';
import type { GenerationParams } from '../types/scheduler.js';

const prisma = getDatabaseClient();

export class SchedulerAdapter {
  private _client: ContentSchedulerClient | null = null;
  private _clientPromise: Promise<ContentSchedulerClient> | null = null;
  private static instance: SchedulerAdapter | null = null;
  private broadcaster: StatusBroadcaster | null = null;

  private schedulerEnabled: boolean = true;

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
      // Use the new service discovery-aware factory method
      const client = await ContentSchedulerClient.create({
        timeout: 30000,
        maxRetries: 3,
        ...this.config,
      });

      console.log('✅ ContentSchedulerClient initialized with service discovery');
      this.schedulerEnabled = true;
      this._client = client;
      return client;
    } catch (error) {
      console.error('❌ Failed to initialize ContentSchedulerClient:', error);

      // Fallback: try with legacy environment variable
      const fallbackUrl = process.env.SCHEDULER_API_URL || 'http://localhost:4000';

      // Check if scheduler is properly configured
      const isPlaceholderUrl =
        fallbackUrl.includes('your-scheduler-api') ||
        fallbackUrl.includes('scheduler-api-not-configured') ||
        fallbackUrl.includes('example.com');

      if (isPlaceholderUrl) {
        console.warn('⚠️  AWS Content Scheduler is not configured properly.');
        console.warn(`⚠️  Current URL: ${fallbackUrl}`);
        console.warn(
          '⚠️  Running in degraded mode - content will be saved but not scheduled for automatic publishing.'
        );
        console.warn(
          '⚠️  To enable scheduling, deploy the ContentScheduler stack or set SCHEDULER_API_URL to a valid endpoint.'
        );
        this.schedulerEnabled = false;
        throw new Error('Scheduler not configured - degraded mode');
      } else {
        // Try with fallback URL
        try {
          const client = new ContentSchedulerClient({
            baseURL: fallbackUrl,
            timeout: 30000,
            maxRetries: 3,
            ...this.config,
          });
          console.warn('⚠️  Using fallback ContentScheduler URL:', fallbackUrl);
          this.schedulerEnabled = true;
          this._client = client;
          return client;
        } catch (fallbackError) {
          console.error(
            '❌ Failed to initialize ContentScheduler with fallback URL:',
            fallbackError
          );
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
   * @deprecated Use SchedulerAdapter.create() instead
   */
  static getInstance(config?: Partial<ContentSchedulerConfig>): SchedulerAdapter {
    if (!SchedulerAdapter.instance) {
      // This is problematic but kept for backward compatibility
      console.warn(
        '⚠️ Using deprecated getInstance(). Migrate to SchedulerAdapter.create() for proper async initialization.\n' +
          'Migration guide:\n' +
          '  Before: const adapter = SchedulerAdapter.getInstance(config);\n' +
          '  After:  const adapter = await SchedulerAdapter.create(config);\n' +
          'This ensures proper service discovery and prevents race conditions. getInstance() will be removed in v3.0.0.'
      );
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
    // Store original state for rollback
    let originalStatus: ContentStatus | null = null;
    let originalScheduledAt: Date | null = null;

    try {
      // 1. Get content with brand and user info
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        include: {
          brand: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!content) {
        return { success: false, error: 'Content not found' };
      }

      // Store original state for potential rollback
      originalStatus = content.status as ContentStatus;
      originalScheduledAt = content.scheduledAt;

      // 2. Get the brand's timezone for proper scheduling
      const brandTimezone = await TimezoneService.getBrandTimezone(content.brandId);
      console.log(`Scheduling for brand ${content.brandId} in timezone: ${brandTimezone}`);

      // 3. Determine the scheduled time
      let scheduledTimeUTC: Date;

      if (customTime) {
        // If customTime is provided, assume it's in the brand's timezone and convert to UTC
        scheduledTimeUTC = TimezoneService.toUTC(customTime, brandTimezone);
        console.log(
          `Custom time ${customTime.toISOString()} in ${brandTimezone} converted to UTC: ${scheduledTimeUTC.toISOString()}`
        );
      } else if (content.scheduledAt) {
        // If content already has a scheduled time, use it (assume it's already in UTC)
        scheduledTimeUTC = new Date(content.scheduledAt);
      } else {
        // Default: schedule for 1 hour from now in the brand's timezone
        const defaultTimeLocal = new Date(
          Date.now() + SCHEDULER_TIME_INTERVALS.DEFAULT_SCHEDULE_DELAY_MS
        );
        scheduledTimeUTC = TimezoneService.toUTC(defaultTimeLocal, brandTimezone);
      }

      // 4. Handle concurrency and set processing state
      const currentParams = (content.generationParams as GenerationParams | null) || {};
      const operationId = randomUUID();

      // Check if another operation is in progress
      if (currentParams.processing?.active) {
        console.log(`Canceling existing operation for content ${contentId}`);

        // Cancel existing AWS schedule if it exists
        if (currentParams.scheduleId) {
          try {
            await (await this.client).cancelSchedule(currentParams.scheduleId);
            console.log(`Canceled existing AWS schedule ${currentParams.scheduleId}`);
          } catch (cancelError) {
            console.warn(`Failed to cancel existing schedule ${currentParams.scheduleId}:`, cancelError);
            // Continue with new operation anyway
          }
        }
      }

      // Set processing state before AWS call
      await prisma.content.update({
        where: { id: contentId },
        data: {
          generationParams: JSON.parse(JSON.stringify({
            ...currentParams,
            processing: {
              active: true,
              operation: 'scheduling',
              startedAt: new Date().toISOString(),
              operationId,
            },
          })),
        },
      });

      // 5. Create schedule in AWS microservice first (primary system)
      let scheduleId: string | undefined;
      let awsScheduleCreated = false;

      // Skip AWS scheduling if scheduler is not enabled
      if (!this.schedulerEnabled) {
        console.info('Scheduler is disabled - saving content locally without AWS scheduling');
        // Clear processing state since we're not actually scheduling
        await prisma.content.update({
          where: { id: contentId },
          data: {
            generationParams: JSON.parse(JSON.stringify({
              ...currentParams,
              processing: null, // Clear processing state
              awsScheduleCreated: false,
            })),
          },
        });
      } else {
        try {
          const schedule = await (
            await this.client
          ).createSchedule({
            contentId: content.id,
            brandId: content.brandId,
            userId: userId || content.brand.userId,
            platform: 'instagram', // Default for now, could expand to other platforms
            scheduledAt: scheduledTimeUTC.toISOString(), // Lambda expects 'scheduledAt'
            contentType: 'image', // Default to image, could be video/carousel/reel/story
            // Store content details in scheduler's DynamoDB
            // When content is edited, EventBridge events will update this
            caption: content.caption || '',
            hashtags: content.hashtags || [],
            mediaUrls: content.cdnImageUrl
              ? [content.cdnImageUrl]
              : content.imageUrl
                ? [content.imageUrl]
                : [],
            metadata: {
              timezone: brandTimezone,
              localTime: customTime ? customTime.toISOString() : undefined,
            },
          });

          scheduleId = schedule.scheduleId;
          awsScheduleCreated = true;
        } catch (awsError: unknown) {
          // Handle circuit breaker and network errors gracefully
          const code =
            typeof awsError === 'object' && awsError && 'code' in awsError
              ? (awsError as { code?: string }).code
              : undefined;
          if (code === 'CIRCUIT_BREAKER_OPEN' || code === 'EOPENBREAKER') {
            console.warn(
              'Circuit breaker is open - AWS scheduler temporarily unavailable. Content will be saved locally but not scheduled for publishing.'
            );
          } else if (code === 'NETWORK_ERROR') {
            console.warn(
              'Network error connecting to AWS scheduler. Content will be saved locally but not scheduled for publishing.'
            );
          } else {
            console.error('Failed to create schedule in AWS:', awsError);
          }
          // AWS scheduling failed - we'll handle this below by updating local DB with error
        }
      }

      // 6. Handle processing state based on AWS result
      if (!awsScheduleCreated) {
        // AWS scheduling failed - clear processing state and set error
        try {
          await prisma.content.update({
            where: { id: contentId },
            data: {
              status: originalStatus, // Keep original status
              scheduledAt: originalScheduledAt, // Keep original time
              schedulingError: `AWS Scheduler unavailable - content not scheduled`,
              generationParams: JSON.parse(JSON.stringify({
                ...currentParams,
                processing: null, // Clear processing flag
                awsScheduleCreated: false,
              })),
            },
          });
        } catch (dbError) {
          console.error('Failed to update local database with scheduling error:', dbError);
          throw dbError;
        }
      }
      // If AWS succeeded, leave processing state active - EventBridge events will clear it

      // 6. Broadcast status change (only after both AWS and DB succeed)
      if (awsScheduleCreated && this.broadcaster) {
        await this.broadcaster.broadcastStatusChange(
          content.id,
          content.brandId,
          originalStatus,
          'scheduled',
          {
            scheduleId: scheduleId,
            scheduledAt: scheduledTimeUTC.toISOString(),
            timezone: brandTimezone,
          }
        );
      }

      // Log with timezone context
      if (awsScheduleCreated) {
        const localTimeDisplay = TimezoneService.formatWithTimezone(
          scheduledTimeUTC,
          brandTimezone
        );
        console.log(`Content ${contentId} scheduled successfully for ${localTimeDisplay}`);
      }

      return awsScheduleCreated
        ? { success: true, scheduleId: scheduleId!, brandId: content.brandId }
        : {
            success: false,
            error: 'AWS Scheduler unavailable - content not scheduled',
          };
    } catch (error) {
      console.error('Error scheduling content:', error);

      // Attempt to restore original state in database
      if (originalStatus !== null && contentId) {
        try {
          await prisma.content.update({
            where: { id: contentId },
            data: {
              status: originalStatus,
              scheduledAt: originalScheduledAt,
              schedulingError: `Scheduling failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          });
        } catch (restoreError) {
          console.error('Failed to restore original state:', restoreError);
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Cancel scheduled content with proper consistency
   */
  async cancelSchedule(contentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Get content to find schedule ID and store original state
      const content = await prisma.content.findUnique({
        where: { id: contentId },
      });

      if (!content) {
        return { success: false, error: 'Content not found' };
      }

      // Type-safe access to generationParams with proper null checking
      const generationParams = (content.generationParams as GenerationParams | null) || {};
      const scheduleId = generationParams.scheduleId;
      const wasAwsScheduled = generationParams.awsScheduleCreated;

      let awsCancelled = false;

      if (scheduleId && wasAwsScheduled) {
        // Cancel in AWS if it was actually created there
        try {
          await (await this.client).cancelSchedule(scheduleId);
          awsCancelled = true;
          console.log(`AWS schedule ${scheduleId} cancelled successfully`);
        } catch (error: unknown) {
          // Handle circuit breaker errors gracefully
          const errObj = error as { code?: string } | undefined;
          if (errObj?.code === 'CIRCUIT_BREAKER_OPEN' || errObj?.code === 'EOPENBREAKER') {
            console.warn(
              'Circuit breaker is open - AWS scheduler temporarily unavailable. Continuing with local cancellation only.'
            );
          } else if (errObj?.code === 'NETWORK_ERROR') {
            console.warn(
              'Network error connecting to AWS scheduler. Continuing with local cancellation only.'
            );
          } else {
            console.error('Failed to cancel in AWS:', error);
            // Log inconsistency but continue with local update
            await this.logInconsistency(contentId, 'AWS_CANCEL_FAILED', {
              scheduleId,
              error,
            });
          }
        }
      }

      // Update local database (always update to maintain user expectation)
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

      // Broadcast status change if we have a broadcaster
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
      console.error('Error canceling schedule:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Reschedule content to new time with timezone awareness
   */
  async rescheduleContent(
    contentId: string,
    newTime: Date,
    isLocalTime: boolean = true
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get content to find schedule ID
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        include: {
          brand: {
            select: {
              id: true,
              name: true,
              userId: true, // Include userId for scheduler
            },
          },
        },
      });

      if (!content) {
        return { success: false, error: 'Content not found' };
      }

      // Get brand timezone
      const brandTimezone = await TimezoneService.getBrandTimezone(content.brandId);

      // Convert new time to UTC if it's provided in local time
      const newTimeUTC = isLocalTime ? TimezoneService.toUTC(newTime, brandTimezone) : newTime;

      console.log(
        `Rescheduling content ${contentId} from ${content.scheduledAt} to ${newTimeUTC.toISOString()} (${brandTimezone})`
      );

      // Type-safe access to generationParams
      const generationParams = (content.generationParams as GenerationParams | null) || {};
      const scheduleId = generationParams.scheduleId;
      let awsRescheduleSuccess = false;
      // Removed unused awsError variable (errors handled inline)

      if (!scheduleId) {
        // Content should have a schedule ID if it's currently scheduled
        if (content.status === 'scheduled' && content.scheduledAt) {
          console.error(`Content ${contentId} is marked as scheduled but has no AWS schedule ID`);
          return {
            success: false,
            error:
              'Content is not properly scheduled in AWS - cannot reschedule. Please cancel and reschedule from scratch.',
          };
        } else {
          // Content is not scheduled, nothing to reschedule
          return {
            success: false,
            error: 'Content is not scheduled - nothing to reschedule',
          };
        }
      }

      // Reschedule in AWS FIRST - only update local DB if this succeeds
      // Use updateSchedule directly to include content updates
      try {
        await (
          await this.client
        ).updateSchedule(scheduleId, {
          scheduledAt: newTimeUTC.toISOString(),
          // Include required fields for API Gateway validation
          brandId: content.brandId,
          contentId: content.id,
          userId: content.brand.userId, // Include userId for token retrieval
          platform: 'instagram', // Default to instagram for now
          // Include content details in case they were edited
          caption: content.caption || '',
          hashtags: content.hashtags || [],
          mediaUrls: content.cdnImageUrl
            ? [content.cdnImageUrl]
            : content.imageUrl
              ? [content.imageUrl]
              : [],
        });
        awsRescheduleSuccess = true;
        console.log(`AWS schedule ${scheduleId} rescheduled successfully with updated content`);
      } catch (error: unknown) {
        // Handle circuit breaker errors with more specific messaging
        const errObj = error as { code?: string; message?: string } | undefined;
        if (errObj?.code === 'CIRCUIT_BREAKER_OPEN' || errObj?.code === 'EOPENBREAKER') {
          console.error(
            'Circuit breaker is open - AWS scheduler temporarily unavailable. Reschedule failed.'
          );
          return {
            success: false,
            error: 'AWS scheduler temporarily unavailable. Please try again in a few minutes.',
          };
        } else if (errObj?.code === 'NETWORK_ERROR') {
          console.error('Network error connecting to AWS scheduler. Reschedule failed.');
          return {
            success: false,
            error:
              'Network error connecting to scheduler service. Please check your connection and try again.',
          };
        } else {
          console.error('Failed to reschedule in AWS:', error);
          return {
            success: false,
            error: `Failed to reschedule: ${errObj?.message || 'Unknown AWS scheduler error'}`,
          };
        }
      }

      // Only update local database if AWS reschedule succeeded
      if (awsRescheduleSuccess) {
        try {
          await prisma.content.update({
            where: { id: contentId },
            data: {
              scheduledAt: newTimeUTC,
              schedulingError: null, // Clear any previous errors
              generationParams: JSON.parse(
                JSON.stringify({
                  ...generationParams,
                  scheduledTimezone: brandTimezone,
                  rescheduledAt: new Date().toISOString(),
                  rescheduledLocalTime: isLocalTime ? newTime.toISOString() : undefined,
                })
              ),
            },
          });

          // Log with timezone context
          const localTimeDisplay = TimezoneService.formatWithTimezone(newTimeUTC, brandTimezone);
          console.log(`Content ${contentId} rescheduled successfully for ${localTimeDisplay}`);

          return { success: true };
        } catch (dbError) {
          // AWS succeeded but local DB failed - this is a serious consistency issue
          console.error('CRITICAL: AWS reschedule succeeded but local DB update failed:', dbError);
          await this.logInconsistency(contentId, 'LOCAL_DB_UPDATE_FAILED_AFTER_AWS_SUCCESS', {
            awsScheduleId: scheduleId,
            newTime: newTimeUTC.toISOString(),
            error: dbError,
          });

          return {
            success: false,
            error:
              'Schedule was updated in AWS but local database sync failed. Please refresh the page.',
          };
        }
      }

      // This shouldn't be reached given the return statements above
      return {
        success: false,
        error: 'Unknown error during reschedule operation',
      };
    } catch (error) {
      console.error('Error rescheduling content:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get scheduled content for a brand with proper typing
   */
  async getScheduledContent(
    brandId: string,
    limit: number = 10
  ): Promise<
    Array<{
      id: string;
      brandId: string;
      caption: string;
      hashtags: string[];
      status: string;
      scheduledAt: Date | null;
      scheduleId?: string;
      source: 'aws' | 'local' | 'merged';
    }>
  > {
    try {
      // Fetch from AWS
      const schedules = await (await this.client).getUpcomingSchedules(brandId, limit);

      // Also get from local database for consistency check
      const localContent = await prisma.content.findMany({
        where: {
          brandId,
          status: 'scheduled',
          scheduledAt: { gte: new Date() },
        },
        orderBy: { scheduledAt: 'asc' },
        take: limit,
      });

      // Merge and deduplicate
      const mergedContent = this.mergeScheduledContent(schedules, localContent);
      return mergedContent;
    } catch (error) {
      console.error('Error getting scheduled content:', error);

      // Fallback to local database
      const content = await prisma.content.findMany({
        where: {
          brandId,
          status: 'scheduled',
          scheduledAt: { gte: new Date() },
        },
        orderBy: { scheduledAt: 'asc' },
        take: limit,
      });

      return content.map((c) => ({
        ...c,
        status: c.status,
        source: 'local' as const,
      }));
    }
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
    try {
      // Get from AWS
      const awsRawStats = await (await this.client).getSchedulingStats(brandId);

      // Transform AWS stats to match expected format
      const awsStats = {
        total:
          awsRawStats.scheduled +
          awsRawStats.published +
          awsRawStats.failed +
          awsRawStats.cancelled +
          awsRawStats.processing,
        upcoming: awsRawStats.scheduled + awsRawStats.processing,
        failed: awsRawStats.failed,
      };

      // Also get from local database
      const localStats = await this.getLocalSchedulingStats(brandId);

      // Return combined stats
      return {
        aws: awsStats,
        local: localStats,
        synced: this.areStatsSynced(awsStats, localStats),
      };
    } catch (error) {
      console.error('Error getting scheduling stats:', error);

      // Fallback to local stats
      return {
        local: await this.getLocalSchedulingStats(brandId),
        aws: null,
        synced: false,
      };
    }
  }

  /**
   * Health check for scheduler service
   */
  async healthCheck(): Promise<boolean> {
    try {
      return await (await this.client).healthCheck();
    } catch (error) {
      console.error('Scheduler health check failed:', error);
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
    try {
      // Log to console for immediate visibility
      console.error(
        `DATA INCONSISTENCY [${type}]:`,
        JSON.stringify({
          contentId,
          timestamp: new Date().toISOString(),
          ...details,
        })
      );

      // Store in database for reconciliation (using generationParams as audit trail)
      const content = await prisma.content.findUnique({
        where: { id: contentId },
      });

      if (content) {
        const generationParams = (content.generationParams as GenerationParams | null) || {};
        const inconsistencies = (generationParams.inconsistencies as Array<unknown>) || [];

        inconsistencies.push({
          type,
          timestamp: new Date().toISOString(),
          details,
        });

        await prisma.content.update({
          where: { id: contentId },
          data: {
            generationParams: JSON.parse(
              JSON.stringify({
                ...generationParams,
                inconsistencies,
                lastInconsistency: type,
                lastInconsistencyAt: new Date().toISOString(),
              })
            ),
          },
        });
      }

      // TODO: Send to monitoring service (CloudWatch, DataDog, etc.)
      // TODO: Trigger reconciliation job if critical inconsistency
    } catch (error) {
      // Don't let logging failures break the main flow
      console.error('Failed to log inconsistency:', error);
    }
  }

  // ==================== Private Helper Methods ====================

  private mergeScheduledContent(
    awsSchedules: Array<{
      contentId: string;
      scheduledAt: string;
      [key: string]: unknown;
    }>,
    localContent: Array<{
      id: string;
      brandId: string;
      caption: string;
      hashtags: string[];
      status: string;
      scheduledAt: Date | null;
      [key: string]: unknown;
    }>
  ): Array<{
    id: string;
    brandId: string;
    caption: string;
    hashtags: string[];
    status: string;
    scheduledAt: Date | null;
    scheduleId?: string;
    source: 'aws' | 'local' | 'merged';
  }> {
    const contentMap = new Map();

    // Add AWS schedules
    for (const schedule of awsSchedules) {
      contentMap.set(schedule.contentId, {
        ...schedule,
        source: 'aws',
      });
    }

    // Add/merge local content
    for (const content of localContent) {
      const existing = contentMap.get(content.id);
      if (existing) {
        // Merge, preferring AWS data
        contentMap.set(content.id, {
          ...content,
          ...existing,
          source: 'both',
        });
      } else {
        contentMap.set(content.id, {
          ...content,
          source: 'local',
        });
      }
    }

    return Array.from(contentMap.values());
  }

  private async getLocalSchedulingStats(brandId: string): Promise<{
    total: number;
    scheduled: number;
    draft: number;
    published: number;
  }> {
    const [draft, scheduled, published] = await Promise.all([
      prisma.content.count({
        where: { brandId, status: 'draft' },
      }),
      prisma.content.count({
        where: { brandId, status: 'scheduled' },
      }),
      prisma.content.count({
        where: { brandId, status: 'published' },
      }),
    ]);

    return {
      draft,
      scheduled,
      published,
      total: draft + scheduled + published,
    };
  }

  private areStatsSynced(
    awsStats: { total: number; upcoming: number; failed: number } | null,
    localStats: {
      total: number;
      scheduled: number;
      draft: number;
      published: number;
    }
  ): boolean {
    if (!awsStats || !localStats) return false;

    // Check if key metrics are within acceptable range (allow small differences)
    return (
      Math.abs((awsStats.upcoming || 0) - (localStats.scheduled || 0)) <= SYNC_TOLERANCE &&
      Math.abs((awsStats.total || 0) - (localStats.total || 0)) <= SYNC_TOLERANCE
    );
  }
}

// Export singleton instance
export const schedulerAdapter = SchedulerAdapter.getInstance();
