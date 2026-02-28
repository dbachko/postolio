import { logger as baseLogger } from '@postolio/logger';
import { redisService } from './redis.js';
import type { InstagramPost } from './instagram.js';

type BrandData = { id: string };
type ServiceLike = any;

const syncLogger = baseLogger.child({ module: 'instagram-sync' });

type SyncResults = {
  synced: number;
  skipped: number;
  failed: number;
  errors: string[];
};

function createSyncResults(): SyncResults {
  return {
    synced: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
}

async function acquireSyncLock(brandId: string) {
  const lockKey = `instagram_sync_lock:${brandId}`;
  const redis = redisService.getClient();
  let acquired = false;
  if (!redis) {
    return { redis, lockKey, acquired };
  }

  try {
    const lockResult = await redis.set(lockKey, String(Date.now()), 'EX', 900, 'NX');
    if (lockResult !== 'OK') {
      throw new Error('Sync already in progress');
    }
    acquired = true;
  } catch (error) {
    if ((error as Error).message === 'Sync already in progress') {
      throw error;
    }
  }

  return { redis, lockKey, acquired };
}

async function releaseSyncLock(
  lock: {
    redis: any;
    lockKey: string;
    acquired: boolean;
  },
  brandId: string
) {
  if (!lock.acquired || !lock.redis) {
    return;
  }

  try {
    await lock.redis.del(lock.lockKey);
  } catch (error) {
    syncLogger.warn('Failed to release Instagram sync lock', {
      brandId,
      lockKey: lock.lockKey,
      error: (error as Error)?.message,
    });
  }
}

async function fetchPostsForSync(
  service: ServiceLike,
  brand: BrandData | string,
  maxPosts: number,
  maxDays: number
) {
  const dateThreshold = new Date();
  dateThreshold.setDate(dateThreshold.getDate() - maxDays);

  const posts: InstagramPost[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore && posts.length < maxPosts) {
    const batchSize = Math.min(100, maxPosts - posts.length);
    const batch: { data: InstagramPost[]; hasMore: boolean; cursor: string | null } =
      await service.getRecentPostsPaginated(brand, batchSize, cursor);
    const recentPosts = batch.data.filter((post: InstagramPost) => {
      if (!post.timestamp) {
        return true;
      }
      return new Date(post.timestamp) >= dateThreshold;
    });

    posts.push(...recentPosts);
    hasMore = batch.hasMore && posts.length < maxPosts;
    cursor = batch.cursor;
    if (recentPosts.length < batch.data.length) {
      hasMore = false;
    }
  }

  return { posts, dateThreshold };
}

async function processSyncPosts(params: {
  service: ServiceLike;
  brand: BrandData | string;
  posts: InstagramPost[];
  skipExisting: boolean;
  results: SyncResults;
  brandId: string;
}) {
  for (const post of params.posts) {
    try {
      await params.service.syncSinglePost(
        typeof params.brand === 'string' ? { id: params.brand } : params.brand,
        post,
        params.skipExisting
      );
      params.results.synced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('already exists')) {
        params.results.skipped += 1;
      } else {
        params.results.failed += 1;
        params.results.errors.push(`Post ${post.id}: ${message}`);
        syncLogger.error('[Instagram Sync] Failed to sync post', {
          postId: post.id,
          brandId: params.brandId,
          error: message,
        });
      }
    }
  }
}

async function persistSyncMetadata(
  brandId: string,
  duration: number,
  results: SyncResults,
  options: { maxPosts: number; maxDays: number }
) {
  const syncMetadata = {
    brandId,
    timestamp: new Date().toISOString(),
    duration,
    results,
    options,
  };
  await redisService.set(`instagram_sync_metadata:${brandId}`, JSON.stringify(syncMetadata), 86400);
}

export async function syncPublishedPostsImpl(
  service: ServiceLike,
  brand: BrandData | string,
  options: { maxPosts?: number; maxDays?: number; skipExisting?: boolean } = {}
): Promise<SyncResults> {
  const { maxPosts = 100, maxDays = 30, skipExisting = true } = options;
  if (!(await service.isConfigured(brand))) {
    throw new Error('Instagram not connected for this brand');
  }

  const brandId = typeof brand === 'string' ? brand : brand.id;
  const lock = await acquireSyncLock(brandId);
  const credentials = await service.getCredentialsOrThrow(brand);
  await service.checkRateLimit(String(credentials.accountId));
  const results = createSyncResults();

  try {
    const startTime = Date.now();
    const { posts, dateThreshold } = await fetchPostsForSync(service, brand, maxPosts, maxDays);
    syncLogger.info('[Instagram Sync] fetched posts', {
      brandId,
      totalPosts: posts.length,
      dateThreshold: dateThreshold.toISOString(),
    });

    await processSyncPosts({
      service,
      brand,
      posts,
      skipExisting,
      results,
      brandId,
    });
    const duration = Date.now() - startTime;
    await persistSyncMetadata(brandId, duration, results, { maxPosts, maxDays });
    return results;
  } finally {
    await releaseSyncLock(lock, brandId);
  }
}
