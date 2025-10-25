import { redisService } from './redis.js';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyPrefix: string; // Redis key prefix for this rate limiter
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  retryAfter?: number; // Seconds until next request allowed
}

export class RateLimiter {
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if a request should be allowed for the given identifier
   */
  async checkRateLimit(identifier: string): Promise<RateLimitResult> {
    const windowSeconds = Math.ceil(this.config.windowMs / 1000);
    const key = `${this.config.keyPrefix}:${identifier}`;

    // Use Redis to track request count
    const currentCount = await redisService.increment(key, windowSeconds);

    if (currentCount === null) {
      // Redis unavailable, allow request (fail open)
      console.warn('Redis unavailable for rate limiting, allowing request');
      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetTime: new Date(Date.now() + this.config.windowMs),
      };
    }

    const allowed = currentCount <= this.config.maxRequests;
    const remaining = Math.max(0, this.config.maxRequests - currentCount);
    const resetTime = new Date(Date.now() + this.config.windowMs);

    const result: RateLimitResult = {
      allowed,
      remaining,
      resetTime,
    };

    if (!allowed) {
      result.retryAfter = Math.ceil(this.config.windowMs / 1000);
    }

    return result;
  }

  /**
   * Reset rate limit for a specific identifier (useful for testing or admin overrides)
   */
  async resetRateLimit(identifier: string): Promise<boolean> {
    const key = `${this.config.keyPrefix}:${identifier}`;
    return await redisService.del(key);
  }
}

// Pre-configured rate limiters for common use cases
export const campaignRateLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute window
  maxRequests: 10, // 10 campaign operations per minute per user
  keyPrefix: 'campaign_rl',
});

export const pauseResumeRateLimiter = new RateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minute window
  maxRequests: 20, // 20 pause/resume operations per 5 minutes per user
  keyPrefix: 'pause_resume_rl',
});

// Draft rate limiter removed (campaign drafts feature deprecated)

/**
 * Fastify middleware for rate limiting
 */
// createRateLimitMiddleware removed; direct checks are used inline by routes
