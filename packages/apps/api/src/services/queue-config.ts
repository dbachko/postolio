import { getRedisUrl } from '../utils/redis-url.js';

/**
 * BullMQ cannot read Bull's Redis data, so it gets its own key prefix rather than
 * sharing Bull's default `bull:` keys.
 */
const QUEUE_PREFIX = 'bullmq';

export function getQueueOptions() {
  return {
    prefix: QUEUE_PREFIX,
    connection: { url: getRedisUrl(), protocol: 2 as const },
  };
}
