/**
 * DM Rate Limiter Service
 * Enforces Instagram's 350 DMs/hour limit per brand
 */

import { redisService } from './redis.js';
import { logger as baseLogger } from '@postolio/logger';

const logger = baseLogger.child({ module: 'dm-rate-limiter' });

// Instagram's limit: 350 DMs per hour per account
const MAX_DMS_PER_HOUR = 350;
const HOUR_IN_SECONDS = 3600;

export const dmRateLimiter = {
  /**
   * Check if a social account can send a DM within hourly rate limit
   * @param socialAccountId - SocialAccount ID to check
   * @returns Rate limit status with remaining DMs count
   */
  async checkLimit(socialAccountId: string): Promise<{ allowed: boolean; remainingHour: number }> {
    try {
      const redis = redisService.getClient();

      if (!redis) {
        // If Redis is unavailable, allow the request but log warning
        logger.warn('Redis unavailable, skipping DM rate limit check', { socialAccountId });
        return { allowed: true, remainingHour: MAX_DMS_PER_HOUR };
      }

      // Create hourly window key (includes current hour for auto-reset)
      const currentHour = new Date().getHours();
      const key = `dm_rate_limit:${socialAccountId}:${currentHour}`;

      // Get current count
      const currentCount = await redis.get(key);
      const count = currentCount ? parseInt(currentCount, 10) : 0;

      // Check if limit exceeded
      const allowed = count < MAX_DMS_PER_HOUR;
      const remainingHour = Math.max(0, MAX_DMS_PER_HOUR - count);

      if (!allowed) {
        logger.warn('DM rate limit exceeded', {
          socialAccountId,
          count,
          limit: MAX_DMS_PER_HOUR,
          currentHour,
        });
      }

      return { allowed, remainingHour };
    } catch (error) {
      logger.error('Error checking DM rate limit', {
        socialAccountId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // On error, allow request to prevent blocking legitimate usage
      return { allowed: true, remainingHour: MAX_DMS_PER_HOUR };
    }
  },

  /**
   * Increment DM count for a social account (call after successfully sending)
   * @param socialAccountId - SocialAccount ID
   * @returns New count for current hour
   */
  async incrementCount(socialAccountId: string): Promise<number> {
    try {
      const redis = redisService.getClient();

      if (!redis) {
        logger.warn('Redis unavailable, cannot track DM count', { socialAccountId });
        return 0;
      }

      const currentHour = new Date().getHours();
      const key = `dm_rate_limit:${socialAccountId}:${currentHour}`;

      // Increment counter
      const newCount = await redis.incr(key);

      // Set TTL on first increment (auto-expires after 1 hour)
      if (newCount === 1) {
        await redis.expire(key, HOUR_IN_SECONDS);
      }

      logger.debug('DM count incremented', {
        socialAccountId,
        count: newCount,
        limit: MAX_DMS_PER_HOUR,
        remaining: MAX_DMS_PER_HOUR - newCount,
      });

      return newCount;
    } catch (error) {
      logger.error('Error incrementing DM count', {
        socialAccountId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  },

  /**
   * Get total DM count for the current day (all hours)
   * @param socialAccountId - SocialAccount ID
   * @returns Total DMs sent today across all hours
   */
  async getDailyCount(socialAccountId: string): Promise<number> {
    try {
      const redis = redisService.getClient();

      if (!redis) {
        return 0;
      }

      // Scan for all keys matching pattern dm_rate_limit:brandId:*
      const keyPattern = `dm_rate_limit:${socialAccountId}:*`;
      const keys = await redis.keys(keyPattern);

      if (!keys || keys.length === 0) {
        return 0;
      }

      // Sum up all hourly counts
      let total = 0;
      for (const key of keys) {
        const count = await redis.get(key);
        if (count) {
          total += parseInt(count, 10);
        }
      }

      logger.debug('Daily DM count retrieved', {
        socialAccountId,
        dailyCount: total,
        hoursActive: keys.length,
      });

      return total;
    } catch (error) {
      logger.error('Error getting daily DM count', {
        socialAccountId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  },

  /**
   * Get current hour's DM count
   * @param socialAccountId - SocialAccount ID
   * @returns DMs sent in current hour
   */
  async getCurrentHourCount(socialAccountId: string): Promise<number> {
    try {
      const redis = redisService.getClient();

      if (!redis) {
        return 0;
      }

      const currentHour = new Date().getHours();
      const key = `dm_rate_limit:${socialAccountId}:${currentHour}`;

      const count = await redis.get(key);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      logger.error('Error getting current hour DM count', {
        socialAccountId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  },

  /**
   * Reset rate limit for a social account (for testing or manual override)
   * @param socialAccountId - SocialAccount ID
   */
  async resetLimit(socialAccountId: string): Promise<void> {
    try {
      const redis = redisService.getClient();

      if (!redis) {
        return;
      }

      const keyPattern = `dm_rate_limit:${socialAccountId}:*`;
      const keys = await redis.keys(keyPattern);

      if (keys && keys.length > 0) {
        await redis.del(...keys);
        logger.info('DM rate limit reset', {
          socialAccountId,
          keysDeleted: keys.length,
        });
      }
    } catch (error) {
      logger.error('Error resetting DM rate limit', {
        socialAccountId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
};
