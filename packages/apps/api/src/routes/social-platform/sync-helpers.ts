import type { PlatformName } from '@postolio/connectors';

import { prisma } from '../../config/database.js';
import { ConnectorFactory } from '../../services/connectors/index.js';
import { getRedisClient } from '../../services/redis.js';
import { fetchTokensForSocialAccountFromService } from '../../utils/token-service-client.js';
import { logger, SocialRouteReplyError, resolveSocialAccountForBrandPlatform } from './shared.js';

const SYNC_COOLDOWN_SECONDS = 300;

export { syncFetchedPosts } from './sync-posts.js';

export function getSyncCooldownKey(brandId: string, platform: string) {
  return `sync:cooldown:${brandId}:${platform}`;
}

export async function enforceSyncCooldown(params: {
  req: any;
  userId: string;
  brandId: string;
  platform: string;
}) {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  const cooldownTtl = await redis.ttl(getSyncCooldownKey(params.brandId, params.platform));
  if (cooldownTtl <= 0) {
    return;
  }

  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        email: params.req.user!.email,
        eventType: 'social.rate_limit_hit',
        ipAddress: params.req.ip,
        userAgent: params.req.headers['user-agent'],
        metadata: {
          brandId: params.brandId,
          platform: params.platform,
          operation: 'sync',
          retryAfter: cooldownTtl,
        },
        success: false,
      },
    });
  } catch (error: unknown) {
    logger.warn('Failed to create audit log', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  throw new SocialRouteReplyError(429, {
    error: 'rate_limited',
    message: 'Sync cooldown active. Please wait before syncing again.',
    retryAfter: cooldownTtl,
    cooldownSeconds: SYNC_COOLDOWN_SECONDS,
  });
}

export async function resolveSyncTarget(params: {
  userId: string;
  brandId: string;
  platform: string;
  preferredSocialAccountId?: string | null;
}) {
  const socialAccount = await resolveSocialAccountForBrandPlatform({
    brandId: params.brandId,
    platform: params.platform,
    preferredSocialAccountId: params.preferredSocialAccountId,
  });
  if (!socialAccount) {
    throw new SocialRouteReplyError(400, {
      error: 'platform_not_connected',
      message: `Brand has not connected ${params.platform}`,
    });
  }

  const connector = ConnectorFactory.get(params.platform as PlatformName);
  const tokens = await fetchTokensForSocialAccountFromService(
    params.userId,
    params.brandId,
    params.platform,
    socialAccount.id
  );
  if (!tokens?.accessToken) {
    throw new SocialRouteReplyError(401, {
      error: 'invalid_credentials',
      message: `No valid credentials found for ${params.platform}`,
    });
  }

  return { socialAccount, connector, tokens };
}

export async function listRecentPlatformPosts(params: {
  connector: any;
  tokens: { accessToken: string; refreshToken?: string | null };
  socialAccount: any;
  platform: string;
}) {
  return params.connector.listRecentPosts(
    {
      accessToken: params.tokens.accessToken,
      refreshToken: params.tokens.refreshToken,
    },
    {
      platform: params.platform as PlatformName,
      externalAccountId: params.socialAccount.externalAccountId,
      externalPageId: params.socialAccount.externalPageId,
      username: params.socialAccount.username,
    },
    25
  );
}

export async function setSyncCooldown(brandId: string, platform: string) {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }
  await redis.setex(getSyncCooldownKey(brandId, platform), SYNC_COOLDOWN_SECONDS, '1');
}

export async function auditSyncSuccess(params: {
  req: any;
  userId: string;
  brandId: string;
  platform: string;
  syncedCount: number;
  skippedCount: number;
  totalPosts: number;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        email: params.req.user!.email,
        eventType: 'social.posts_synced',
        ipAddress: params.req.ip,
        userAgent: params.req.headers['user-agent'],
        metadata: {
          brandId: params.brandId,
          platform: params.platform,
          syncedCount: params.syncedCount,
          skippedCount: params.skippedCount,
          totalPosts: params.totalPosts,
        },
        success: true,
      },
    });
  } catch (error: unknown) {
    logger.warn('Failed to create audit log', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
