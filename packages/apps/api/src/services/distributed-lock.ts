import { randomUUID } from 'crypto';

import { logger as baseLogger } from '@postolio/logger';
import { getRedisClient } from './redis.js';

const logger = baseLogger.child({ module: 'distributed-lock' });
const localLocks = new Set<string>();

export type DistributedLockHandle = {
  acquired: boolean;
  release: () => Promise<void>;
};

export async function acquireDistributedLock(params: {
  key: string;
  ttlSeconds: number;
}): Promise<DistributedLockHandle> {
  const key = params.key;
  const ttlSeconds = Math.max(1, Math.floor(params.ttlSeconds));
  const redis = getRedisClient();

  if (redis) {
    const lockValue = randomUUID();
    try {
      const setRes = await redis.set(key, lockValue, 'EX', ttlSeconds, 'NX');
      if (setRes !== 'OK') {
        return {
          acquired: false,
          release: async () => {},
        };
      }

      return {
        acquired: true,
        release: async () => {
          try {
            await redis.eval(
              "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
              1,
              key,
              lockValue
            );
          } catch (error) {
            logger.warn('Failed to release Redis lock', {
              key,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      };
    } catch (error) {
      logger.warn('Redis lock acquisition failed, falling back to local lock', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (localLocks.has(key)) {
    return {
      acquired: false,
      release: async () => {},
    };
  }

  localLocks.add(key);
  return {
    acquired: true,
    release: async () => {
      localLocks.delete(key);
    },
  };
}
