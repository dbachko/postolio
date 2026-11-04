/**
 * Publishing Operations Service
 * Handles content publishing to social media platforms
 */

import { getDatabaseClient } from '../../config/database.js';
import { ConnectorFactory } from '../connectors/index.js';
import type { PlatformName } from '@postolio/connectors';
import { logger as baseLogger } from '@postolio/logger';
import { fetchTokensForSocialAccountFromService } from '../../utils/token-service-client.js';
import { getAssetsClient } from '../assets-media.js';
import { resolvePrimarySocialAccount } from '../social-account-resolver.js';

const prisma = getDatabaseClient();
const logger = baseLogger.child({ module: 'publishing' });

export interface PublishingResult {
  success: boolean;
  error?: string;
  retryable?: boolean;
  data?: {
    platform: string;
    externalPostId: string;
    permalink: string;
    postedAt: Date;
  };
}

type PublishContext = {
  content: any;
  socialAccount: any;
  connector: any;
  tokens: {
    accessToken: string;
    refreshToken?: string | null;
  };
};

function failure(error: string, retryable = false): PublishingResult {
  return {
    success: false,
    error,
    retryable,
  };
}

async function loadPublishContext(
  contentId: string,
  platform: PlatformName
): Promise<{ ok: true; context: PublishContext } | { ok: false; result: PublishingResult }> {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: {
      brand: true,
      mediaAssets: {
        select: { assetId: true, displayOrder: true },
        orderBy: { displayOrder: 'asc' },
      },
    },
  });
  if (!content) {
    return { ok: false, result: failure('Content not found') };
  }

  const socialAccount = await resolvePrimarySocialAccount(content.brandId, platform);
  if (!socialAccount) {
    return {
      ok: false,
      result: failure(`${platform} account not connected to this brand`),
    };
  }

  if (!ConnectorFactory.supports(platform)) {
    return { ok: false, result: failure(`Platform ${platform} is not yet supported`) };
  }

  const connector = ConnectorFactory.get(platform);
  if (!connector.publish) {
    return {
      ok: false,
      result: failure(`Publishing is not supported for platform ${platform}`),
    };
  }

  const tokens = await fetchTokensForSocialAccountFromService(
    content.brand.userId,
    content.brandId,
    String(platform),
    socialAccount.id
  );
  if (!tokens) {
    return {
      ok: false,
      result: failure(`No valid credentials found for ${platform}`),
    };
  }

  return {
    ok: true,
    context: {
      content,
      socialAccount,
      connector,
      tokens,
    },
  };
}

async function buildConnectorPayload(content: any) {
  const primaryAssetId = content.mediaAssets?.[0]?.assetId ?? null;
  if (!primaryAssetId) {
    return { ok: false as const, result: failure('Content has no attached media assets') };
  }

  const assetsClient = getAssetsClient();
  const [primaryAsset] = await assetsClient.getBatchAssets([primaryAssetId]);
  if (!primaryAsset) {
    return {
      ok: false as const,
      result: failure('Primary media asset could not be found'),
    };
  }

  const isReel = content.contentType === 'reel';
  const isStory = content.contentType === 'story';
  const isVideo = primaryAsset.fileType === 'video' || isReel;
  const mediaType = isReel
    ? ('REELS' as const)
    : isStory
      ? ('STORIES' as const)
      : isVideo
        ? ('VIDEO' as const)
        : ('IMAGE' as const);

  const thumbnailCandidate = (primaryAsset as any)?.thumbnailUrl;
  const imageUrl =
    primaryAsset.fileType === 'image'
      ? primaryAsset.url
      : typeof thumbnailCandidate === 'string'
        ? thumbnailCandidate
        : undefined;

  return {
    ok: true as const,
    payload: {
      caption: content.caption || '',
      imageUrl,
      mediaUrl: primaryAsset.url,
      mediaType,
      thumbOffset: typeof content.thumbOffset === 'number' ? content.thumbOffset : undefined,
      shareToFeed:
        typeof content.shareToFeed === 'boolean' ? Boolean(content.shareToFeed) : undefined,
    },
  };
}

async function persistPublishedContent(params: {
  contentId: string;
  platform: PlatformName;
  socialAccount: any;
  publishResult: { externalPostId: string; permalink?: string };
}) {
  const postedAt = new Date();

  await prisma.content.update({
    where: { id: params.contentId },
    data: {
      status: 'published',
      postedAt,
    },
  });

  await prisma.contentPublication.create({
    data: {
      contentId: params.contentId,
      socialAccountId: params.socialAccount.id,
      platform: params.platform,
      externalPostId: params.publishResult.externalPostId,
      externalAccountId: params.socialAccount.externalAccountId,
      externalPageId: params.socialAccount.externalPageId,
      permalink: params.publishResult.permalink,
      publishedAt: postedAt,
      status: 'published',
    },
  });

  return postedAt;
}

/**
 * Publish content to a social platform
 */
export async function publishContent(
  contentId: string,
  platform: PlatformName
): Promise<PublishingResult> {
  try {
    logger.info('Publishing content', { contentId, platform });

    const setup = await loadPublishContext(contentId, platform);
    if (!setup.ok) {
      return setup.result;
    }

    const { content, socialAccount, connector, tokens } = setup.context;
    logger.info('Publishing via connector', { contentId, platform, brandId: content.brandId });

    const connectorPayload = await buildConnectorPayload(content);
    if (!connectorPayload.ok) {
      return connectorPayload.result;
    }

    const publishResult = await connector.publish(
      connectorPayload.payload,
      {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || undefined,
      },
      {
        platform,
        externalAccountId: socialAccount.externalAccountId,
        externalPageId: socialAccount.externalPageId,
        username: socialAccount.username,
      }
    );

    const postedAt = await persistPublishedContent({
      contentId,
      platform,
      socialAccount,
      publishResult,
    });

    logger.info('Content published successfully', {
      contentId,
      platform,
      externalPostId: publishResult.externalPostId,
    });

    return {
      success: true,
      data: {
        platform,
        externalPostId: publishResult.externalPostId,
        permalink: publishResult.permalink || '',
        postedAt,
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : `Failed to publish to ${platform}`;
    const isRetryable = !/permission|invalid token|not found|authentication/i.test(errorMessage);

    logger.error('Publishing failed', {
      contentId,
      platform,
      error: errorMessage,
      retryable: isRetryable,
    });

    return failure(errorMessage, isRetryable);
  }
}

/**
 * Publish content to Instagram
 *
 * @deprecated Use publishContent(contentId, 'instagram') instead.
 */
export async function publishContentToInstagram(
  contentId: string,
  _brand: any
): Promise<PublishingResult> {
  return publishContent(contentId, 'instagram');
}
