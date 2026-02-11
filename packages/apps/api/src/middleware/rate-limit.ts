/**
 * Rate Limiting Middleware
 * Implements tiered rate limiting for different endpoint types
 */

import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { errorResponse } from '../utils/api-response.js';

// Enable/disable rate limiting in non-prod. Always enabled in prod.
const RATE_LIMIT_ENABLED =
  process.env.RATE_LIMIT_ENABLED === 'true' || process.env.NODE_ENV === 'prod';

// Rate limit configurations for different endpoint categories
export const RateLimitTiers = {
  // Strict limits for expensive AI operations
  AI_GENERATION: {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => `ai:${req.user?.id || req.ip}`,
    errorMessage: 'Too many AI generation requests. Please wait before trying again.',
  },

  // Content publishing
  PUBLISHING: {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => `publish:${req.user?.id || req.ip}`,
    errorMessage: 'Publishing rate limit exceeded. Please wait before publishing more content.',
  },

  // Analytics and reporting
  ANALYTICS: {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => `analytics:${req.user?.id || req.ip}`,
    errorMessage: 'Too many analytics requests. Please wait.',
  },

  // Authentication endpoints
  AUTH: {
    max: 5,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => `auth:${req.ip}`,
    errorMessage: 'Too many authentication attempts. Please wait.',
  },

  // Registration (stricter)
  REGISTRATION: {
    max: 2,
    timeWindow: '15 minutes',
    keyGenerator: (req: FastifyRequest) => `register:${req.ip}`,
    errorMessage: 'Too many registration attempts. Please wait 15 minutes.',
  },

  // Password reset
  PASSWORD_RESET: {
    max: 3,
    timeWindow: '15 minutes',
    keyGenerator: (req: FastifyRequest) => {
      const body = req.body as { email?: string } | undefined;
      return `reset:${body?.email || req.ip}`;
    },
    errorMessage: 'Too many password reset attempts. Please wait.',
  },

  // General API requests
  GENERAL: {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => `general:${req.user?.id || req.ip}`,
    errorMessage: 'Rate limit exceeded. Please slow down.',
  },

  // Strict limit for webhook endpoints
  WEBHOOK: {
    max: 10,
    timeWindow: '1 second',
    keyGenerator: (req: FastifyRequest) => `webhook:${req.headers['x-webhook-id'] || req.ip}`,
    errorMessage: 'Webhook rate limit exceeded.',
  },
};

/**
 * Create rate limiter with Redis backend
 */
// Accept both a minimal custom interface and ioredis' multi which returns a chainable commander
interface RedisLikeClient {
  multi(): {
    incr(key: string): unknown;
    expire(key: string, seconds: number): unknown;
    exec(): Promise<unknown[]> | Promise<[unknown, number | unknown][]>;
  };
}

export function createRateLimiter(redisClient: RedisLikeClient, tier: keyof typeof RateLimitTiers) {
  const config = RateLimitTiers[tier];

  return async function rateLimiter(request: FastifyRequest, reply: FastifyReply) {
    const key = config.keyGenerator(request);
    const windowKey = `ratelimit:${key}:${Math.floor(Date.now() / parseTimeWindow(config.timeWindow))}`;

    try {
      // Use Redis INCR with expiry for atomic rate limiting
      const multi = redisClient.multi();
      multi.incr(windowKey);
      multi.expire(windowKey, Math.ceil(parseTimeWindow(config.timeWindow) / 1000));
      const results = await multi.exec();
      const first = results && Array.isArray(results) ? results[0] : undefined;
      const countRaw = Array.isArray(first) ? first[1] : 0;
      const count = typeof countRaw === 'number' ? countRaw : Number(countRaw) || 0;
      const remaining = Math.max(0, config.max - count);

      // Set rate limit headers
      reply.header('X-RateLimit-Limit', config.max.toString());
      reply.header('X-RateLimit-Remaining', remaining.toString());
      reply.header(
        'X-RateLimit-Reset',
        new Date(
          Math.ceil(Date.now() / parseTimeWindow(config.timeWindow)) *
            parseTimeWindow(config.timeWindow)
        ).toISOString()
      );

      if (count > config.max) {
        // Calculate retry after
        const retryAfter = Math.ceil(parseTimeWindow(config.timeWindow) / 1000);
        reply.header('Retry-After', retryAfter.toString());

        return reply.code(429).send(
          errorResponse(config.errorMessage, 'RATE_LIMIT_EXCEEDED', {
            limit: config.max,
            window: config.timeWindow,
            retryAfter,
          })
        );
      }
    } catch (error) {
      // Log error but don't block the request if Redis fails
      console.error('Rate limiting error:', error);
      // In production, you might want to fail closed (block request) instead
    }
  };
}

/**
 * Parse time window string to milliseconds
 */
function parseTimeWindow(window: string): number {
  const match = window.match(/^(\d+)\s*(second|minute|hour)s?$/i);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid time window: ${window}`);
  }

  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'second':
      return value * 1000;
    case 'minute':
      return value * 60 * 1000;
    case 'hour':
      return value * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }
}

/**
 * Apply rate limiting to specific routes
 */
export function applyRateLimiting(app: FastifyInstance, redisClient: RedisLikeClient) {
  if (!RATE_LIMIT_ENABLED) {
    // Bypass rate limiting entirely in local/dev unless explicitly enabled
    return;
  }
  // AI Generation endpoints
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const aiEndpoints = ['/api/content/generate'];

    if (aiEndpoints.some((endpoint) => request.url.startsWith(endpoint))) {
      await createRateLimiter(redisClient, 'AI_GENERATION')(request, reply);
    }
  });

  // Authentication endpoints
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === '/api/auth/login') {
      await createRateLimiter(redisClient, 'AUTH')(request, reply);
    }

    if (request.url === '/api/auth/register') {
      await createRateLimiter(redisClient, 'REGISTRATION')(request, reply);
    }

    if (request.url === '/api/auth/refresh') {
      await createRateLimiter(redisClient, 'AUTH')(request, reply);
    }

    if (request.url === '/api/auth/password-reset') {
      await createRateLimiter(redisClient, 'PASSWORD_RESET')(request, reply);
    }

    if (request.url === '/api/magic-link/send' || request.url === '/api/magic-link/verify') {
      await createRateLimiter(redisClient, 'AUTH')(request, reply);
    }
  });

  // Publishing endpoints
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const publishEndpoints = [
      '/api/instagram/publish',
      '/api/content/schedule',
      '/api/content/publish',
    ];

    if (publishEndpoints.some((endpoint) => request.url.startsWith(endpoint))) {
      await createRateLimiter(redisClient, 'PUBLISHING')(request, reply);
    }
  });

  // Analytics endpoints
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const analyticsEndpoints = ['/api/analytics/', '/api/instagram/insights'];

    if (analyticsEndpoints.some((endpoint) => request.url.startsWith(endpoint))) {
      await createRateLimiter(redisClient, 'ANALYTICS')(request, reply);
    }
  });
}

// Export for use in specific routes
export { createRateLimiter as rateLimiter };
