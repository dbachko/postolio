/**
 * Content scheduling facade for scheduler-adapter.
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
          scheduledTime:
            customTime || new Date(Date.now() + SCHEDULER_TIME_INTERVALS.DEFAULT_SCHEDULE_DELAY_MS),
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
  async reschedulePost(
    contentId: string,
    newTime: Date
  ): Promise<{ success: boolean; error?: string }> {
    // newTime is already UTC from database, don't convert again
    return schedulerAdapter.rescheduleContent(contentId, newTime, false);
  }

  /**
   * Update an existing AWS schedule payload (caption/media/etc) without changing time.
   */
  async updateScheduledContent(contentId: string): Promise<{ success: boolean; error?: string }> {
    return schedulerAdapter.updateScheduledContent(contentId);
  }

  /**
   * Publish content immediately (enqueue publisher via scheduler service).
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
    return schedulerAdapter.publishNow(contentId, userId);
  }

  /**
   * Get upcoming scheduled posts for a brand
   */
  async getUpcomingPosts(brandId: string, limit = 10): Promise<ScheduledPost[]> {
    const data = await schedulerAdapter.getScheduledContent(brandId, limit);
    // Best effort structural validation
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .filter((d) => d && typeof d === 'object')
      .map((d) => {
        const rec = d as Record<string, unknown>;
        return {
          id: typeof rec.id === 'string' ? rec.id : 'unknown',
          contentId: typeof rec.contentId === 'string' ? rec.contentId : 'unknown',
          brandId: typeof rec.brandId === 'string' ? rec.brandId : brandId,
          scheduledTime: rec.scheduledTime instanceof Date ? rec.scheduledTime : new Date(),
          status:
            rec.status === 'processing' || rec.status === 'published' || rec.status === 'failed'
              ? rec.status
              : 'pending',
          retryCount: typeof rec.retryCount === 'number' ? rec.retryCount : 0,
          lastError: typeof rec.lastError === 'string' ? rec.lastError : undefined,
        } satisfies ScheduledPost;
      });
  }

  /**
   * Get scheduling statistics for a brand
   */
  async getSchedulingStats(brandId: string): Promise<{
    totalScheduled: number;
    upcoming: number;
    lastScheduledAt?: Date;
  }> {
    const raw = await schedulerAdapter.getSchedulingStats(brandId);
    if (!raw || typeof raw !== 'object') {
      return { totalScheduled: 0, upcoming: 0 };
    }
    const rec = raw as Record<string, unknown>;
    const totalScheduled = typeof rec.totalScheduled === 'number' ? rec.totalScheduled : 0;
    const upcoming = typeof rec.upcoming === 'number' ? rec.upcoming : 0;
    const last = rec.lastScheduledAt instanceof Date ? rec.lastScheduledAt : undefined;
    return { totalScheduled, upcoming, lastScheduledAt: last };
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
    let currentTime =
      startTime || new Date(Date.now() + SCHEDULER_TIME_INTERVALS.DEFAULT_SCHEDULE_DELAY_MS);

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
