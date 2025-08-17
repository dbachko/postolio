/**
 * Scheduler Adapter Service
 * Bridges the gap between legacy scheduler and new AWS Content Scheduler
 */

import { ContentStatus } from '@prisma/client';
import { ContentSchedulerClient, ContentSchedulerConfig } from '../clients/content-scheduler-client.js';
import { SCHEDULER_TIME_INTERVALS, SYNC_TOLERANCE } from '../constants/scheduler.js';
import { getDatabaseClient } from '../config/database.js';
import { TimezoneService } from './timezone.js';

const prisma = getDatabaseClient();

export class SchedulerAdapter {
  private client: ContentSchedulerClient;
  private static instance: SchedulerAdapter | null = null;

  constructor(config?: Partial<ContentSchedulerConfig>) {
    // Initialize with environment config
    const apiKey = process.env.SCHEDULER_API_KEY;
    this.client = new ContentSchedulerClient({
      baseURL: process.env.SCHEDULER_API_URL || 'http://localhost:4000',
      ...(apiKey && { apiKey }),
      timeout: 30000,
      maxRetries: 3,
      ...config,
    });
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
   * Schedule content with timezone-aware handling
   */
  async scheduleContent(
    contentId: string,
    customTime?: Date,
    userId?: string
  ): Promise<{ success: boolean; scheduleId?: string; brandId?: string; error?: string }> {
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

      // 4. Create schedule in AWS microservice (AWS expects UTC time)
      try {
        const schedule = await this.client.createSchedule({
          contentId: content.id,
          brandId: content.brandId,
          userId: userId || content.brand.userId,
          platform: 'instagram', // Default for now
          scheduledTime: scheduledTimeUTC.toISOString(),
          content: {
            caption: content.caption,
            mediaUrl: content.imageUrl || content.cdnImageUrl || undefined,
            hashtags: content.hashtags,
          },
          metadata: {
            timezone: brandTimezone,
            localTime: customTime ? customTime.toISOString() : undefined,
          },
        });

        // 5. Update local database to maintain consistency (store UTC time)
        await prisma.content.update({
          where: { id: contentId },
          data: {
            status: 'scheduled' as ContentStatus,
            scheduledAt: scheduledTimeUTC,
            // Store external schedule ID and timezone info for reference
            schedulingError: null,
            generationParams: {
              ...(content.generationParams as any || {}),
              scheduleId: schedule.id,
              scheduledTimezone: brandTimezone,
              scheduledLocalTime: customTime ? customTime.toISOString() : undefined,
            },
          },
        });

        // Log with timezone context
        const localTimeDisplay = TimezoneService.formatWithTimezone(scheduledTimeUTC, brandTimezone);
        console.log(`Content ${contentId} scheduled successfully for ${localTimeDisplay}`);
        
        return { success: true, scheduleId: schedule.id, brandId: content.brandId };
      } catch (schedulerError) {
        console.error('Failed to create schedule in AWS:', schedulerError);
        
        // Log error but continue with local scheduling as fallback
        await prisma.content.update({
          where: { id: contentId },
          data: {
            schedulingError: `AWS Scheduler error: ${schedulerError instanceof Error ? schedulerError.message : 'Unknown error'}`,
          },
        });
        
        return { 
          success: false, 
          error: `Scheduler error: ${schedulerError instanceof Error ? schedulerError.message : 'Unknown error'}` 
        };
      }
    } catch (error) {
      console.error('Error scheduling content:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Cancel scheduled content
   */
  async cancelSchedule(contentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Get content to find schedule ID
      const content = await prisma.content.findUnique({
        where: { id: contentId },
      });

      if (!content) {
        return { success: false, error: 'Content not found' };
      }

      const scheduleId = (content.generationParams as any)?.scheduleId;
      
      if (scheduleId) {
        // Cancel in AWS
        try {
          await this.client.cancelSchedule(scheduleId);
        } catch (error) {
          console.error('Failed to cancel in AWS:', error);
          // Continue with local update even if AWS fails
        }
      }

      // Update local database
      await prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'draft' as ContentStatus,
          scheduledAt: null,
        },
      });

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

      const scheduleId = (content.generationParams as any)?.scheduleId;
      
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
            ...(content.generationParams as any || {}),
            scheduledTimezone: brandTimezone,
            rescheduledAt: new Date().toISOString(),
            rescheduledLocalTime: isLocalTime ? newTime.toISOString() : undefined,
          },
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
   * Get scheduled content for a brand
   */
  async getScheduledContent(brandId: string, limit: number = 10): Promise<any[]> {
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
   * Get scheduling statistics
   */
  async getSchedulingStats(brandId: string): Promise<any> {
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
  getCircuitBreakerStats(): any {
    return this.client.getCircuitBreakerStats();
  }

  // ==================== Private Helper Methods ====================

  private mergeScheduledContent(awsSchedules: any[], localContent: any[]): any[] {
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

  private async getLocalSchedulingStats(brandId: string): Promise<any> {
    const [pending, scheduled, published, failed] = await Promise.all([
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
      pending,
      scheduled,
      published,
      failed,
      total: pending + scheduled + published + failed,
    };
  }

  private areStatsSynced(awsStats: any, localStats: any): boolean {
    if (!awsStats || !localStats) return false;
    
    // Check if key metrics are within acceptable range (allow small differences)
    return (
      Math.abs((awsStats.pending || 0) - (localStats.pending || 0)) <= SYNC_TOLERANCE &&
      Math.abs((awsStats.published || 0) - (localStats.published || 0)) <= SYNC_TOLERANCE
    );
  }
}

// Export singleton instance
export const schedulerAdapter = SchedulerAdapter.getInstance();