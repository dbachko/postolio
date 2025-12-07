import { FastifyRequest, FastifyReply } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import { createRedisClient } from './redis.js';

const redis = createRedisClient();
const RATE_LIMIT_ENABLED =
  process.env.RATE_LIMIT_ENABLED === 'true' || process.env.NODE_ENV === 'prod';
const prisma = getDatabaseClient();

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyPrefix?: string; // Redis key prefix
  skipSuccessfulRequests?: boolean; // Skip counting successful requests
  skipFailedRequests?: boolean; // Skip counting failed requests
  message?: string; // Custom error message
}

// Default rate limit configurations for different endpoints
export const RateLimitConfigs = {
  // Authentication endpoints
  register: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    message: 'Too many registration attempts. Please try again later.',
    keyPrefix: 'rl:register',
  },
  login: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10,
    message: 'Too many login attempts. Please try again later.',
    keyPrefix: 'rl:login',
  },
  passwordReset: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 3,
    message: 'Too many password reset requests. Please try again later.',
    keyPrefix: 'rl:password-reset',
  },

  // Email endpoints
  emailVerification: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 5,
    message: 'Too many verification emails requested. Please try again later.',
    keyPrefix: 'rl:email-verify',
  },
  magicLink: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 5,
    message: 'Too many magic link requests. Please try again later.',
    keyPrefix: 'rl:magic-link',
  },

  // API endpoints
  contentGeneration: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 50,
    message: 'Content generation limit reached. Please try again later.',
    keyPrefix: 'rl:content-gen',
  },
  campaignCreation: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 20,
    message: 'Campaign creation limit reached. Please try again later.',
    keyPrefix: 'rl:campaign-create',
  },
  instagramPublish: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 30,
    message: 'Instagram publishing limit reached. Please try again later.',
    keyPrefix: 'rl:instagram-publish',
  },

  // General API rate limit
  general: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    message: 'Too many requests. Please slow down.',
    keyPrefix: 'rl:general',
  },

  // Strict rate limit for sensitive operations
  strict: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10,
    message: 'Rate limit exceeded for this operation.',
    keyPrefix: 'rl:strict',
  },
};

export class EnhancedRateLimiter {
  /**
   * Create a rate limiter with the specified configuration
   */
  static createLimiter(config: RateLimitConfig) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!RATE_LIMIT_ENABLED) {
        // In local/dev, bypass rate limiting entirely unless explicitly enabled
        return;
      }
      // Get identifier (IP address or user ID)
      const identifier = this.getIdentifier(request);
      const key = `${config.keyPrefix || 'rl'}:${identifier}`;

      try {
        // Get current count
        const current = await redis.get(key);
        const count = current ? parseInt(current, 10) : 0;

        // Check if limit exceeded
        if (count >= config.maxRequests) {
          const ttl = await redis.ttl(key);

          reply.header('X-RateLimit-Limit', config.maxRequests.toString());
          reply.header('X-RateLimit-Remaining', '0');
          reply.header('X-RateLimit-Reset', new Date(Date.now() + ttl * 1000).toISOString());
          reply.header('Retry-After', ttl.toString());

          return reply.code(429).send({
            error: config.message || 'Too many requests',
            retryAfter: ttl,
          });
        }

        // Increment counter
        const newCount = await redis.incr(key);

        // Set expiry on first request
        if (newCount === 1) {
          await redis.pexpire(key, config.windowMs);
        }

        // Get TTL for headers
        const ttl = await redis.ttl(key);

        // Set rate limit headers
        reply.header('X-RateLimit-Limit', config.maxRequests.toString());
        reply.header(
          'X-RateLimit-Remaining',
          Math.max(0, config.maxRequests - newCount).toString()
        );
        reply.header('X-RateLimit-Reset', new Date(Date.now() + ttl * 1000).toISOString());
      } catch (error) {
        // Log error but don't block request if Redis is down
        console.error('Rate limiter error:', error);
      }
    };
  }

  /**
   * Get identifier for rate limiting (IP or user ID)
   */
  private static getIdentifier(request: FastifyRequest): string {
    // If user is authenticated, use user ID
    if (request.user?.id) {
      return `user:${request.user.id}`;
    }

    // Otherwise use IP address
    const forwarded = request.headers['x-forwarded-for'];
    const ip = forwarded
      ? Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded.split(',')[0]
      : request.ip;

    return `ip:${ip}`;
  }

  /**
   * Create a dynamic rate limiter based on user tier
   */
  static createTieredLimiter(
    baseConfig: RateLimitConfig,
    tierMultipliers: Record<string, number> = {
      free: 1,
      basic: 2,
      premium: 5,
      custom: 10,
    }
  ) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!RATE_LIMIT_ENABLED) {
        return;
      }
      // Get user tier if authenticated
      let multiplier = 1;
      if (request.user?.id) {
        const user = await prisma.user.findUnique({
          where: { id: request.user.id },
          select: { subscriptionTier: true },
        });

        if (user?.subscriptionTier) {
          multiplier = tierMultipliers[user.subscriptionTier] || 1;
        }
      }

      // Apply multiplier to max requests
      const config = {
        ...baseConfig,
        maxRequests: baseConfig.maxRequests * multiplier,
      };

      // Use the regular rate limiter with adjusted config
      return this.createLimiter(config)(request, reply);
    };
  }

  /**
   * Clear rate limit for a specific identifier
   */
  static async clearLimit(identifier: string, keyPrefix?: string): Promise<void> {
    const key = `${keyPrefix || 'rl'}:${identifier}`;
    await redis.del(key);
  }

  /**
   * Get remaining requests for an identifier
   */
  static async getRemaining(
    identifier: string,
    config: RateLimitConfig
  ): Promise<{ remaining: number; resetTime: Date | null }> {
    const key = `${config.keyPrefix || 'rl'}:${identifier}`;

    const current = await redis.get(key);
    const count = current ? parseInt(current, 10) : 0;
    const ttl = await redis.ttl(key);

    return {
      remaining: Math.max(0, config.maxRequests - count),
      resetTime: ttl > 0 ? new Date(Date.now() + ttl * 1000) : null,
    };
  }
}

// Export middleware factory functions for common use cases
export const enhancedRateLimiters = {
  register: () => EnhancedRateLimiter.createLimiter(RateLimitConfigs.register),
  login: () => EnhancedRateLimiter.createLimiter(RateLimitConfigs.login),
  passwordReset: () => EnhancedRateLimiter.createLimiter(RateLimitConfigs.passwordReset),
  emailVerification: () => EnhancedRateLimiter.createLimiter(RateLimitConfigs.emailVerification),
  magicLink: () => EnhancedRateLimiter.createLimiter(RateLimitConfigs.magicLink),
  contentGeneration: () =>
    EnhancedRateLimiter.createTieredLimiter(RateLimitConfigs.contentGeneration),
  campaignCreation: () =>
    EnhancedRateLimiter.createTieredLimiter(RateLimitConfigs.campaignCreation),
  instagramPublish: () =>
    EnhancedRateLimiter.createTieredLimiter(RateLimitConfigs.instagramPublish),
  general: () => EnhancedRateLimiter.createLimiter(RateLimitConfigs.general),
  strict: () => EnhancedRateLimiter.createLimiter(RateLimitConfigs.strict),
};
