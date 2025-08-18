/**
 * Scheduler Service - Refactored to use AWS Content Scheduler
 * This service now acts as a facade to the scheduler-adapter
 */

import { schedulerAdapter } from './scheduler-adapter.js';
import { SCHEDULER_TIME_INTERVALS } from '../constants/scheduler.js';

export interface ScheduledPost {
  id: string;
  contentId: string;
  brandId: string;
  scheduledTime: Date;
  status: 'pending' | 'processing' | 'published' | 'failed';
  retryCount: number;
  lastError?: string;
}

export interface SchedulingResult {
  success: boolean;
  scheduledPost?: ScheduledPost;
  error?: string;
}

class SchedulerService {
  /**
   * Schedule content for optimal posting time
   */
  async scheduleContent(contentId: string, customTime?: Date): Promise<SchedulingResult> {
    const result = await schedulerAdapter.scheduleContent(contentId, customTime);
    
    if (result.success) {
      // Ensure brandId is available - it should always be returned by the adapter
      if (!result.brandId) {
        console.error(`Warning: brandId not returned for content ${contentId}`);
        return {
          success: false,
          error: 'Failed to retrieve brand information',
        };
      }
      
      return {
        success: true,
        scheduledPost: {
          id: result.scheduleId || `schedule_${contentId}`,
          contentId,
          brandId: result.brandId,
          scheduledTime: customTime || new Date(Date.now() + SCHEDULER_TIME_INTERVALS.DEFAULT_SCHEDULE_DELAY_MS),
          status: 'pending',
          retryCount: 0,
        },
      };
    }
    
    return {
      success: false,
      error: result.error || 'Unknown error',
    };
  }

  /**
   * Cancel a scheduled post
   */
  async cancelScheduledPost(contentId: string): Promise<{ success: boolean; error?: string }> {
    return schedulerAdapter.cancelSchedule(contentId);
  }

  /**
   * Reschedule a post to a new time
   */
  async reschedulePost(contentId: string, newTime: Date): Promise<{ success: boolean; error?: string }> {
    return schedulerAdapter.rescheduleContent(contentId, newTime);
  }

  /**
   * Get upcoming scheduled posts for a brand
   */
  async getUpcomingPosts(brandId: string, limit: number = 10): Promise<any[]> {
    return schedulerAdapter.getScheduledContent(brandId, limit);
  }

  /**
   * Get scheduling statistics for a brand
   */
  async getSchedulingStats(brandId: string): Promise<any> {
    return schedulerAdapter.getSchedulingStats(brandId);
  }

  /**
   * Check scheduler health
   */
  async healthCheck(): Promise<boolean> {
    return schedulerAdapter.healthCheck();
  }

  /**
   * Bulk schedule multiple content items
   */
  async bulkSchedule(contentIds: string[], startTime?: Date): Promise<SchedulingResult[]> {
    const results: SchedulingResult[] = [];
    let currentTime = startTime || new Date(Date.now() + SCHEDULER_TIME_INTERVALS.DEFAULT_SCHEDULE_DELAY_MS);
    
    for (const contentId of contentIds) {
      const result = await this.scheduleContent(contentId, currentTime);
      results.push(result);
      
      // Increment time for next post to maintain minimum interval
      currentTime = new Date(currentTime.getTime() + SCHEDULER_TIME_INTERVALS.MIN_POST_INTERVAL_MS);
    }
    
    return results;
  }
}

export const schedulerService = new SchedulerService();