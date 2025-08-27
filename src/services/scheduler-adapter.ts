/**
 * Scheduler Adapter Service
 * Bridges the gap between legacy scheduler and new AWS Content Scheduler
 */

import { ContentStatus } from '@prisma/client';
import { ContentSchedulerClient, ContentSchedulerConfig } from '../clients/content-scheduler-client.js';
import { SCHEDULER_TIME_INTERVALS, SYNC_TOLERANCE } from '../constants/scheduler.js';
import { getDatabaseClient } from '../config/database.js';
import { TimezoneService } from './timezone.js';
import type { StatusBroadcaster } from './status-broadcaster.js';
import type { GenerationParams } from '../types/scheduler.js';

const prisma = getDatabaseClient();

export class SchedulerAdapter {
  private client: ContentSchedulerClient;
  private static instance: SchedulerAdapter | null = null;
  private broadcaster: StatusBroadcaster | null = null;

  constructor(config?: Partial<ContentSchedulerConfig>) {
    // Initialize with environment config
    this.client = new ContentSchedulerClient({
      baseURL: process.env.SCHEDULER_API_URL || 'http://localhost:4000',
      timeout: 30000,
      maxRetries: 3,
      ...config,
    });
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
  getClient(): ContentSchedulerClient {
    return this.client;
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<ContentSchedulerConfig>): SchedulerAdapter {
    if (!SchedulerAdapter.instance) {
      SchedulerAdapter.instance = new SchedulerAdapter(config);
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
  ): Promise<{ success: boolean; scheduleId?: string; brandId?: string; error?: string }> {
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
        console.log(`Custom time ${customTime.toISOString()} in ${brandTimezone} converted to UTC: ${scheduledTimeUTC.toISOString()}`);
      } else if (content.scheduledAt) {
        // If content already has a scheduled time, use it (assume it's already in UTC)
        scheduledTimeUTC = new Date(content.scheduledAt);
      } else {
        // Default: schedule for 1 hour from now in the brand's timezone
        const defaultTimeLocal = new Date(Date.now() + SCHEDULER_TIME_INTERVALS.DEFAULT_SCHEDULE_DELAY_MS);
        scheduledTimeUTC = TimezoneService.toUTC(defaultTimeLocal, brandTimezone);
      }

      // 4. Create schedule in AWS microservice first (primary system)
      let scheduleId: string | undefined;
      let awsScheduleCreated = false;
      
      try {
        const schedule = await this.client.createSchedule({
          contentId: content.id,
          brandId: content.brandId,
          userId: userId || content.brand.userId,
          platform: 'instagram', // Default for now, could expand to other platforms
          scheduledAt: scheduledTimeUTC.toISOString(), // Lambda expects 'scheduledAt'
          contentType: 'image', // Default to image, could be video/carousel/reel/story
          // DO NOT store content details here - they can change if user edits content
          // Publisher Lambda should fetch fresh content from database at publish time
          // using contentId to ensure we always publish the latest edited content
          metadata: {
            timezone: brandTimezone,
            localTime: customTime ? customTime.toISOString() : undefined,
            // Content details (caption, hashtags, mediaUrls) intentionally NOT stored
            // Publisher Lambda will fetch fresh content via /api/publisher/content endpoint
          },
        });
        
        scheduleId = schedule.scheduleId;
        awsScheduleCreated = true;
      } catch (awsError) {
        console.error('Failed to create schedule in AWS:', awsError);
        // AWS scheduling failed - we'll handle this below
      }

      // 5. Update local database only if AWS succeeded or as a tracked failure
      try {
        await prisma.content.update({
          where: { id: contentId },
          data: {
            status: awsScheduleCreated ? ('scheduled' as ContentStatus) : originalStatus,
            scheduledAt: awsScheduleCreated ? scheduledTimeUTC : originalScheduledAt,
            schedulingError: awsScheduleCreated 
              ? null 
              : `AWS Scheduler unavailable - content not scheduled`,
            generationParams: {
              ...(content.generationParams as GenerationParams || {}),
              scheduleId: scheduleId,
              scheduledTimezone: brandTimezone,
              scheduledLocalTime: customTime ? customTime.toISOString() : undefined,
              awsScheduleCreated, // Track whether AWS schedule was created
            } as GenerationParams,
          },
        });
      } catch (dbError) {
        console.error('Failed to update local database:', dbError);
        
        // If AWS schedule was created but local DB update failed, try to cancel AWS schedule
        if (awsScheduleCreated && scheduleId) {
          try {
            await this.client.cancelSchedule(scheduleId);
            console.log(`Rolled back AWS schedule ${scheduleId} due to DB failure`);
          } catch (rollbackError) {
            console.error('Failed to rollback AWS schedule:', rollbackError);
            // Log critical inconsistency - AWS has schedule but local DB doesn't
            await this.logInconsistency(contentId, 'AWS_SCHEDULE_WITHOUT_LOCAL', {
              scheduleId,
              error: dbError,
            });
          }
        }
        
        throw dbError; // Re-throw to trigger error response
      }

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
            timezone: brandTimezone
          }
        );
      }

      // Log with timezone context
      if (awsScheduleCreated) {
        const localTimeDisplay = TimezoneService.formatWithTimezone(scheduledTimeUTC, brandTimezone);
        console.log(`Content ${contentId} scheduled successfully for ${localTimeDisplay}`);
      }
      
      return awsScheduleCreated
        ? { success: true, scheduleId, brandId: content.brandId }
        : { success: false, error: 'AWS Scheduler unavailable - content not scheduled' };
        
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
        error: error instanceof Error ? error.message : 'Unknown error' 
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

      const generationParams = content.generationParams as GenerationParams;
      const scheduleId = generationParams?.scheduleId;
      const wasAwsScheduled = generationParams?.awsScheduleCreated;
      
      let awsCancelled = false;
      
      if (scheduleId && wasAwsScheduled) {
        // Cancel in AWS if it was actually created there
        try {
          await this.client.cancelSchedule(scheduleId);
          awsCancelled = true;
          console.log(`AWS schedule ${scheduleId} cancelled successfully`);
        } catch (error) {
          console.error('Failed to cancel in AWS:', error);
          // Log inconsistency but continue with local update
          await this.logInconsistency(contentId, 'AWS_CANCEL_FAILED', {
            scheduleId,
            error,
          });
        }
      }

      // Update local database (always update to maintain user expectation)
      await prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'draft' as ContentStatus,
          scheduledAt: null,
          schedulingError: awsCancelled || !wasAwsScheduled
            ? null
            : 'Warning: AWS schedule may still be active',
          generationParams: {
            ...generationParams,
            scheduleId: null,
            awsScheduleCreated: false,
            cancelledAt: new Date().toISOString(),
          } as GenerationParams,
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
        error: error instanceof Error ? error.message : 'Unknown error' 
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
        include: { brand: true },
      });

      if (!content) {
        return { success: false, error: 'Content not found' };
      }

      // Get brand timezone
      const brandTimezone = await TimezoneService.getBrandTimezone(content.brandId);
      
      // Convert new time to UTC if it's provided in local time
      const newTimeUTC = isLocalTime 
        ? TimezoneService.toUTC(newTime, brandTimezone)
        : newTime;
      
      console.log(`Rescheduling content ${contentId} from ${content.scheduledAt} to ${newTimeUTC.toISOString()} (${brandTimezone})`);

      const scheduleId = (content.generationParams as GenerationParams)?.scheduleId;
      
      if (scheduleId) {
        // Reschedule in AWS
        try {
          await this.client.reschedule(scheduleId, newTimeUTC);
        } catch (error) {
          console.error('Failed to reschedule in AWS:', error);
          // Continue with local update even if AWS fails
        }
      }

      // Update local database with UTC time
      await prisma.content.update({
        where: { id: contentId },
        data: {
          scheduledAt: newTimeUTC,
          generationParams: {
            ...(content.generationParams as GenerationParams || {}),
            scheduledTimezone: brandTimezone,
            rescheduledAt: new Date().toISOString(),
            rescheduledLocalTime: isLocalTime ? newTime.toISOString() : undefined,
          } as GenerationParams,
        },
      });

      // Log with timezone context
      const localTimeDisplay = TimezoneService.formatWithTimezone(newTimeUTC, brandTimezone);
      console.log(`Content ${contentId} rescheduled successfully for ${localTimeDisplay}`);

      return { success: true };
    } catch (error) {
      console.error('Error rescheduling content:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Get scheduled content for a brand with proper typing
   */
  async getScheduledContent(brandId: string, limit: number = 10): Promise<Array<{
    id: string;
    brandId: string;
    caption: string;
    hashtags: string[];
    status: string;
    scheduledAt: Date | null;
    scheduleId?: string;
    source: 'aws' | 'local' | 'merged';
  }>> {
    try {
      // Fetch from AWS
      const schedules = await this.client.getUpcomingSchedules(brandId, limit);
      
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
      return prisma.content.findMany({
        where: {
          brandId,
          status: 'scheduled',
          scheduledAt: { gte: new Date() },
        },
        orderBy: { scheduledAt: 'asc' },
        take: limit,
      });
    }
  }

  /**
   * Get scheduling statistics with proper typing
   */
  async getSchedulingStats(brandId: string): Promise<{
    aws: { total: number; upcoming: number; failed: number } | null;
    local: { total: number; scheduled: number; draft: number; published: number };
    synced: boolean;
  }> {
    try {
      // Get from AWS
      const awsStats = await this.client.getSchedulingStats(brandId);
      
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
      return await this.client.healthCheck();
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
    return this.client.getCircuitBreakerStats();
  }

  /**
   * Log data inconsistency for monitoring and reconciliation
   */
  private async logInconsistency(
    contentId: string,
    type: 'AWS_SCHEDULE_WITHOUT_LOCAL' | 'AWS_CANCEL_FAILED' | 'LOCAL_WITHOUT_AWS' | 'DATA_MISMATCH',
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      // Log to console for immediate visibility
      console.error(`DATA INCONSISTENCY [${type}]:`, {
        contentId,
        timestamp: new Date().toISOString(),
        ...details,
      });

      // Store in database for reconciliation (using generationParams as audit trail)
      const content = await prisma.content.findUnique({
        where: { id: contentId },
      });

      if (content) {
        const generationParams = content.generationParams as GenerationParams || {};
        const inconsistencies = (generationParams.inconsistencies as Array<unknown> || []);
        
        inconsistencies.push({
          type,
          timestamp: new Date().toISOString(),
          details,
        });

        await prisma.content.update({
          where: { id: contentId },
          data: {
            generationParams: {
              ...generationParams,
              inconsistencies,
              lastInconsistency: type,
              lastInconsistencyAt: new Date().toISOString(),
            } as GenerationParams,
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
    awsSchedules: Array<{ contentId: string; scheduledAt: string; [key: string]: unknown }>,
    localContent: Array<{ id: string; brandId: string; caption: string; hashtags: string[]; status: string; scheduledAt: Date | null; [key: string]: unknown }>
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
    const [draft, scheduled, published, failed] = await Promise.all([
      prisma.content.count({
        where: { brandId, status: 'draft' },
      }),
      prisma.content.count({
        where: { brandId, status: 'scheduled' },
      }),
      prisma.content.count({
        where: { brandId, status: 'published' },
      }),
      prisma.content.count({
        where: { brandId, status: 'failed' },
      }),
    ]);

    return {
      draft,
      scheduled,
      published,
      failed,
      total: draft + scheduled + published + failed,
    };
  }

  private areStatsSynced(
    awsStats: { total: number; upcoming: number; failed: number } | null,
    localStats: { total: number; scheduled: number; draft: number; published: number }
  ): boolean {
    if (!awsStats || !localStats) return false;
    
    // Check if key metrics are within acceptable range (allow small differences)
    return (
      Math.abs((awsStats.scheduled || 0) - (localStats.scheduled || 0)) <= SYNC_TOLERANCE &&
      Math.abs((awsStats.published || 0) - (localStats.published || 0)) <= SYNC_TOLERANCE
    );
  }
}

// Export singleton instance
export const schedulerAdapter = SchedulerAdapter.getInstance();
