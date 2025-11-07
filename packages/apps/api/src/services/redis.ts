import { Redis } from 'ioredis';
import { logger as baseLogger } from '@postolio/logger';
import { getRedisUrl } from '../utils/redis-url.js';

const redisLogger = baseLogger.child({ module: 'redis-service' });

// Global Redis client instance
let redisInstance: Redis | null = null;

class RedisService {
  private client: Redis | null = null;

  constructor() {
    this.connect();
  }

  private connect() {
    // Use singleton pattern for Redis connection
    if (redisInstance) {
      this.client = redisInstance;
      return;
    }

    try {
      // Use shared utility for Redis URL construction
      const redisUrl = getRedisUrl();

      this.client = new Redis(redisUrl, {
        enableReadyCheck: true,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
      });

      this.client.on('error', (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        redisLogger.error('Redis connection error', {
          error: { name: error.name, message: error.message, stack: error.stack },
        });
      });

      this.client.on('connect', () => {
        redisLogger.info('Successfully connected to Redis', {
          url: redisUrl.replace(/\/\/.*@/, '//***@'),
        });
      });

      redisInstance = this.client;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      redisLogger.warn('Redis connection failed, falling back to in-memory storage', {
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      this.client = null;
      redisInstance = null;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) {
      return null;
    }

    try {
      return await this.client.get(key);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      redisLogger.error('Redis GET error', {
        key,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      redisLogger.error('Redis SET error', {
        key,
        ttlSeconds,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      redisLogger.error('Redis DEL error', {
        key,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      return false;
    }
  }

  async increment(key: string, ttlSeconds?: number): Promise<number | null> {
    if (!this.client) {
      return null;
    }

    try {
      const count = await this.client.incr(key);
      if (ttlSeconds && count === 1) {
        await this.client.expire(key, ttlSeconds);
      }
      return count;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      redisLogger.error('Redis INCR error', {
        key,
        ttlSeconds,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      return null;
    }
  }

  isConnected(): boolean {
    return this.client?.status === 'ready';
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  async setex(key: string, ttl: number, value: string): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      await this.client.setex(key, ttl, value);
      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      redisLogger.error('Redis SETEX error', {
        key,
        ttl,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      return false;
    }
  }
}

export const redisService = new RedisService();
export const getRedisClient = () => redisService.getClient();
