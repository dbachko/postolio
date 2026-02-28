import type { PlatformName } from '@postolio/connectors';

import { prisma } from '../../config/database.js';
import { ConnectorFactory } from '../../services/connectors/index.js';
import { getAssetsClient } from '../../services/assets-media.js';
import { getStatusBroadcaster } from '../../services/broadcast-registry.js';
import { fetchTokensForSocialAccountFromService } from '../../utils/token-service-client.js';
import { logger, SocialRouteReplyError, resolveSocialAccountForBrandPlatform } from './shared.js';

const PLATFORM_CAPTION_LIMITS: Record<string, number> = {
  instagram: 2200,
  facebook: 63206,
  linkedin: 3000,
  x: 280,
  youtube: 5000,
  tiktok: 2200,
};

type ConnectorPublishResult = {
  externalPostId: string;
  permalink?: string | null;
  publishedAt: string;
  metadata?: unknown;
};

type PublishConnector = {
  publish: (
    payload: unknown,
    tokens: { accessToken: string; refreshToken?: string },
    account: {
      platform: PlatformName;
      externalAccountId: string;
      externalPageId?: string | null;
      username?: string | null;
    }
  ) => Promise<unknown>;
};

function ensurePublishConnector(platform: string) {
  const connector = ConnectorFactory.get(platform as PlatformName);
  if (!connector.publish) {
    throw new Error(`Connector for ${platform} does not support publishing yet`);
  }
  return connector as PublishConnector;
}

export async function fetchContentForPublish(contentId: string): Promise<any | null> {
  return prisma.content.findUnique({
    where: { id: contentId },
    include: {
      brand: true,
      mediaAssets: {
        select: { assetId: true, displayOrder: true },
        orderBy: { displayOrder: 'asc' },
      },
    },
  });
}

export async function assertPublishPermission(params: {
  req: any;
  content: any;
  contentId: string;
  platform: string;
  userId: string;
}) {
  const { req, content, contentId, platform, userId } = params;
  if (content.brand.userId === userId) {
    return;
  }

  try {
    await prisma.auditLog.create({
      data: {
        userId,
        email: req.user!.email,
        eventType: 'social.unauthorized_access',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: {
          brandId: content.brandId,
          platform,
          operation: 'publish',
          contentId,
        },
        success: false,
      },
    });
  } catch (error: unknown) {
    logger.warn('Failed to create audit log', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  throw new SocialRouteReplyError(403, {
    error: 'forbidden',
    message: 'You do not have permission to publish this content',
  });
}

export function validateCaptionLength(platform: string, caption: string) {
  const maxCaptionLength = PLATFORM_CAPTION_LIMITS[platform];
  if (!maxCaptionLength || caption.length <= maxCaptionLength) {
    return;
  }
  throw new SocialRouteReplyError(400, {
    error: 'caption_too_long',
    message: `Caption exceeds ${platform} limit of ${maxCaptionLength} characters`,
    maxLength: maxCaptionLength,
    currentLength: caption.length,
  });
}

export async function resolvePublishTarget(params: {
  brandId: string;
  platform: string;
  preferredSocialAccountId?: string | null;
  userId: string;
}) {
  const socialAccount = await resolveSocialAccountForBrandPlatform({
    brandId: params.brandId,
    platform: params.platform,
    preferredSocialAccountId: params.preferredSocialAccountId,
  });
  if (!socialAccount) {
    throw new SocialRouteReplyError(400, {
      error: 'Social account not connected',
      message: `Brand has not connected ${params.platform}`,
    });
  }

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

  return {
    socialAccount,
    connector: ensurePublishConnector(params.platform),
    tokens,
  };
}

async function fetchPrimaryAsset(content: any) {
  const primaryAssetId = content.mediaAssets?.[0]?.assetId ?? null;
  if (!primaryAssetId) {
    throw new SocialRouteReplyError(400, {
      error: 'media_required',
      message: 'Content has no attached media assets',
    });
  }

  const assetsClient = getAssetsClient();
  const [primaryAsset] = await assetsClient.getBatchAssets([primaryAssetId]);
  if (!primaryAsset) {
    throw new SocialRouteReplyError(400, {
      error: 'media_not_found',
      message: 'Primary media asset could not be found',
    });
  }
  return primaryAsset;
}

function buildPublishPayload(content: any, primaryAsset: any) {
  const isReel = content.contentType === 'reel';
  const isVideo = primaryAsset.fileType === 'video' || isReel;
  const mediaType = isReel ? ('REELS' as const) : isVideo ? ('VIDEO' as const) : ('IMAGE' as const);

  const shareToFeed =
    isReel && typeof content.shareToFeed === 'boolean' ? Boolean(content.shareToFeed) : undefined;
  const thumbnailCandidate = primaryAsset.thumbnailUrl;
  const imageUrl =
    primaryAsset.fileType === 'image'
      ? primaryAsset.url
      : typeof thumbnailCandidate === 'string'
        ? thumbnailCandidate
        : undefined;

  return {
    caption: content.caption || '',
    imageUrl,
    mediaUrl: primaryAsset.url,
    mediaType,
    ...(shareToFeed !== undefined ? { shareToFeed } : {}),
  };
}

export async function publishToConnector(params: {
  content: any;
  connector: PublishConnector;
  tokens: { accessToken: string; refreshToken?: string | null };
  socialAccount: any;
  platform: string;
}) {
  const primaryAsset = await fetchPrimaryAsset(params.content);
  const payload = buildPublishPayload(params.content, primaryAsset);
  const result = (await params.connector.publish(
    payload,
    {
      accessToken: params.tokens.accessToken,
      refreshToken: params.tokens.refreshToken || undefined,
    },
    {
      platform: params.platform as PlatformName,
      externalAccountId: params.socialAccount.externalAccountId,
      externalPageId: params.socialAccount.externalPageId,
      username: params.socialAccount.username,
    }
  )) as ConnectorPublishResult;

  return {
    externalPostId: result.externalPostId,
    permalink: result.permalink,
    publishedAt: result.publishedAt,
    metadata: result.metadata,
  };
}

export async function savePublishSuccess(params: {
  contentId: string;
  content: any;
  platform: string;
  socialAccountId: string;
  publishResult: {
    externalPostId: string;
    permalink?: string | null;
    publishedAt: string;
    metadata?: unknown;
  };
}) {
  await prisma.$transaction(async (tx) => {
    await tx.contentPublication.create({
      data: {
        contentId: params.contentId,
        socialAccountId: params.socialAccountId,
        platform: params.platform as any,
        externalPostId: params.publishResult.externalPostId,
        permalink: params.publishResult.permalink,
        publishedAt: new Date(params.publishResult.publishedAt),
        metadata: params.publishResult.metadata
          ? JSON.parse(JSON.stringify(params.publishResult.metadata))
          : undefined,
      },
    });

    await tx.content.update({
      where: { id: params.contentId },
      data: {
        status: 'published',
        postedAt: new Date(params.publishResult.publishedAt),
        updatedAt: new Date(),
      },
    });
  });
}

export async function broadcastPublishStatus(params: {
  content: any;
  contentId: string;
  platform: string;
  publishResult: {
    externalPostId: string;
    permalink?: string | null;
    publishedAt: string;
  };
}) {
  try {
    const broadcaster = getStatusBroadcaster();
    if (!broadcaster || params.content.status === 'published') {
      return;
    }

    await broadcaster.broadcastStatusChange(
      params.contentId,
      params.content.brandId,
      params.content.status as any,
      'published',
      {
        platform: params.platform,
        externalPostId: params.publishResult.externalPostId,
        permalink: params.publishResult.permalink,
        publishedAt: params.publishResult.publishedAt,
      }
    );
  } catch (error: unknown) {
    logger.warn('Failed to broadcast published status update', {
      contentId: params.contentId,
      platform: params.platform,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function auditPublishSuccess(params: {
  req: any;
  userId: string;
  brandId: string;
  platform: string;
  contentId: string;
  externalPostId: string;
  permalink?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        email: params.req.user!.email,
        eventType: 'social.content_published',
        ipAddress: params.req.ip,
        userAgent: params.req.headers['user-agent'],
        metadata: {
          brandId: params.brandId,
          platform: params.platform,
          contentId: params.contentId,
          externalPostId: params.externalPostId,
          permalink: params.permalink,
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

export async function auditPublishFailure(params: {
  req: any;
  userId: string;
  brandId: string;
  platform: string;
  contentId: string;
  error: unknown;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        email: params.req.user!.email,
        eventType: 'social.content_publish_failed',
        ipAddress: params.req.ip,
        userAgent: params.req.headers['user-agent'],
        metadata: {
          brandId: params.brandId,
          platform: params.platform,
          contentId: params.contentId,
          errorMessage: params.error instanceof Error ? params.error.message : String(params.error),
        },
        success: false,
      },
    });
  } catch (auditError: unknown) {
    logger.warn('Failed to create audit log', {
      error: auditError instanceof Error ? auditError.message : String(auditError),
    });
  }
}
