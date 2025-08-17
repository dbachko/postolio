/**
 * Scheduler Adapter Service
 * Bridges the gap between legacy scheduler and new AWS Content Scheduler
 */

import { PrismaClient, ContentStatus } from '@prisma/client';
import { ContentSchedulerClient, ContentSchedulerConfig } from '../clients/content-scheduler-client.js';
import { SCHEDULER_TIME_INTERVALS, SYNC_TOLERANCE } from '../constants/scheduler.js';

const prisma = new PrismaClient();

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
   * Schedule content with dual-write pattern
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

      // Use default time if not provided (optimal time calculation can be added later)
      const scheduledTime = customTime || new Date(Date.now() + SCHEDULER_TIME_INTERVALS.DEFAULT_SCHEDULE_DELAY_MS);

      // 2. Create schedule in AWS microservice
      try {
        const schedule = await this.client.createSchedule({
          contentId: content.id,
          brandId: content.brandId,
          userId: userId || content.brand.userId,
          platform: 'instagram', // Default for now
          scheduledTime: scheduledTime.toISOString(),
          content: {
            caption: content.caption,
            mediaUrl: content.imageUrl || content.cdnImageUrl || undefined,
            hashtags: content.hashtags,
          },
        });

        // 3. Update local database to maintain consistency
        await prisma.content.update({
          where: { id: contentId },
          data: {
            status: 'scheduled' as ContentStatus,
            scheduledAt: scheduledTime,
            // Store external schedule ID for reference
            schedulingError: null,
            generationParams: {
              ...(content.generationParams as any || {}),
              scheduleId: schedule.id,
            },
          },
        });

        console.log(`Content ${contentId} scheduled successfully at ${scheduledTime.toISOString()}`);
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
   * Reschedule content to new time
   */
  async rescheduleContent(
    contentId: string,
    newTime: Date
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

      const scheduleId = (content.generationParams as any)?.scheduleId;
      
      if (scheduleId) {
        // Reschedule in AWS
        try {
          await this.client.reschedule(scheduleId, newTime);
        } catch (error) {
          console.error('Failed to reschedule in AWS:', error);
          // Continue with local update even if AWS fails
        }
      }

      // Update local database
      await prisma.content.update({
        where: { id: contentId },
        data: {
          scheduledAt: newTime,
        },
      });

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