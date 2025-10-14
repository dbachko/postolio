import { redisService } from './redis.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

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

export const draftRateLimiter = new RateLimiter({
  windowMs: 30 * 1000, // 30 seconds
  maxRequests: 10, // up to 10 autosaves per 30s
  keyPrefix: 'draft_rl',
});

/**
 * Fastify middleware for rate limiting
 */
export function createRateLimitMiddleware(rateLimiter: RateLimiter) {
  return async (request: FastifyRequest & { user?: { id?: string } }, reply: FastifyReply) => {
    const userId =
      request.user?.id || (request.headers['x-user-id'] as string | undefined) || 'anonymous';

    const result = await rateLimiter.checkRateLimit(userId);

    reply.header('X-RateLimit-Limit', rateLimiter['config'].maxRequests);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', Math.floor(result.resetTime.getTime() / 1000));

    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfter || 60);
      return reply.code(429).send({
        error: 'Too many requests',
        message: `Rate limit exceeded. Try again in ${result.retryAfter || 60} seconds.`,
        retryAfter: result.retryAfter || 60,
      });
    }
  };
}
