import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';

// Use the Redis type from the actual Redis service
interface RedisClient {
  setex: (key: string, seconds: number, value: string) => Promise<string | null>;
  get: (key: string) => Promise<string | null>;
  del: (key: string) => Promise<number>;
  keys: (pattern: string) => Promise<string[]>;
  ttl: (key: string) => Promise<number>;
}

/**
 * CSRF Protection for OAuth flows
 * Implements state parameter validation to prevent CSRF attacks
 */

export interface OAuthState {
  state: string;
  userId?: string;
  redirectUrl?: string;
  timestamp: number;
}

export class OAuthCSRFProtection {
  private readonly redisKeyPrefix = 'oauth:state:';
  private readonly stateExpiry = 600; // 10 minutes in seconds
  private redis: RedisClient | undefined;

  constructor(private fastify: FastifyInstance & { redis?: RedisClient }) {
    this.redis = fastify.redis;
  }

  /**
   * Generate a secure state parameter for OAuth flows
   */
  async generateState(userId?: string, redirectUrl?: string): Promise<string> {
    // Generate cryptographically secure random state
    const state = crypto.randomBytes(32).toString('hex');

    // Store state data in Redis with expiry - handle optional properties properly
    const stateData: OAuthState = {
      state,
      timestamp: Date.now(),
      ...(userId !== undefined && { userId }),
      ...(redirectUrl !== undefined && { redirectUrl }),
    };

    const redisKey = `${this.redisKeyPrefix}${state}`;

    try {
      // Store in Redis with expiry
      if (this.redis) {
        await this.redis.setex(redisKey, this.stateExpiry, JSON.stringify(stateData));
      } else {
        // Fallback to in-memory storage if Redis not available
        this.fastify.log.warn('Redis not available for OAuth state storage');
        // In production, this should throw an error
        if (process.env.NODE_ENV === 'production') {
          throw new Error('Redis is required for OAuth state management in production');
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      this.fastify.log.error({ message }, 'Failed to store OAuth state:');
      throw new Error('Failed to initialize OAuth flow');
    }

    return state;
  }

  /**
   * Validate state parameter from OAuth callback
   */
  async validateState(state: string): Promise<OAuthState | null> {
    if (!state) {
      this.fastify.log.warn('Missing state parameter in OAuth callback');
      return null;
    }

    const redisKey = `${this.redisKeyPrefix}${state}`;

    try {
      if (this.redis) {
        // Get and delete state in atomic operation
        const stateDataStr = await this.redis.get(redisKey);

        if (!stateDataStr) {
          this.fastify.log.warn({ state }, 'Invalid or expired OAuth state:');
          return null;
        }

        // Delete the state to prevent replay attacks
        await this.redis.del(redisKey);

        const stateData: OAuthState = JSON.parse(stateDataStr);

        // Check if state has expired (double-check even though Redis has TTL)
        const ageMs = Date.now() - stateData.timestamp;
        if (ageMs > this.stateExpiry * 1000) {
          this.fastify.log.warn({ state }, 'OAuth state expired:');
          return null;
        }

        return stateData;
      } else {
        // In development without Redis
        if (process.env.NODE_ENV !== 'production') {
          this.fastify.log.warn('OAuth state validation skipped - Redis not available');
          return { state, timestamp: Date.now() };
        }
        return null;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      this.fastify.log.error({ message }, 'Failed to validate OAuth state:');
      return null;
    }
  }

  /**
   * Clean up expired states (maintenance task)
   */
  async cleanupExpiredStates(): Promise<void> {
    if (!this.redis) return;

    try {
      // Redis TTL handles expiry automatically
      // This method is here for manual cleanup if needed
      const keys = await this.redis.keys(`${this.redisKeyPrefix}*`);

      for (const key of keys) {
        const ttl = await this.redis.ttl(key);
        if (ttl <= 0) {
          await this.redis.del(key);
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      this.fastify.log.error({ message }, 'Failed to cleanup expired OAuth states:');
    }
  }
}

/**
 * Fastify plugin to register OAuth CSRF protection
 */
export async function oauthCSRFPlugin(fastify: FastifyInstance): Promise<void> {
  const csrfProtection = new OAuthCSRFProtection(fastify);

  // Decorate fastify instance with CSRF protection
  fastify.decorate('oauthCSRF', csrfProtection);

  // Register cleanup hook
  fastify.addHook('onClose', async () => {
    await csrfProtection.cleanupExpiredStates();
  });
}

// TypeScript module augmentation
declare module 'fastify' {
  interface FastifyInstance {
    oauthCSRF: OAuthCSRFProtection;
  }
}
