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

/**
 * Publish content to a social platform
 *
 * Generic publishing function that works with any supported platform.
 * It uses the Connector pattern to route to the appropriate platform and
 * is responsible for updating Content / ContentPublication records.
 *
 * @param contentId - The content to publish
 * @param platform - The platform to publish to (instagram, facebook, etc.)
 * @returns Publishing result with success status and post details
 */
export async function publishContent(
  contentId: string,
  platform: PlatformName
): Promise<PublishingResult> {
  try {
    logger.info('Publishing content', { contentId, platform });

    // Get content with brand and campaign
    const content = await prisma.content.findUnique({
      where: { id: contentId },
      include: {
        brand: true,
        campaign: true,
        mediaAssets: {
          select: { assetId: true, displayOrder: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    if (!content) {
      return {
        success: false,
        error: 'Content not found',
        retryable: false,
      };
    }

    // If content is associated with a campaign, enforce campaign status
    if (content.campaignId && content.campaign && content.campaign.status !== 'active') {
      const status = String(content.campaign.status || '').toLowerCase() || 'unknown';
      logger.warn('Publishing blocked: campaign is not active', {
        contentId,
        campaignId: content.campaignId,
        campaignStatus: content.campaign.status,
      });
      return {
        success: false,
        error: `Cannot publish content for a ${status} campaign`,
        retryable: false,
      };
    }

    const socialAccount = await resolvePrimarySocialAccount(content.brandId, platform);

    if (!socialAccount) {
      return {
        success: false,
        error: `${platform} account not connected to this brand`,
        retryable: false,
      };
    }

    // Check if connector exists for platform
    if (!ConnectorFactory.supports(platform)) {
      return {
        success: false,
        error: `Platform ${platform} is not yet supported`,
        retryable: false,
      };
    }

    // Get connector
    const connector = ConnectorFactory.get(platform as PlatformName);

    // Get credentials from token service
    const tokens = await fetchTokensForSocialAccountFromService(
      content.brand.userId,
      content.brandId,
      platform as string,
      socialAccount.id
    );

    if (!tokens) {
      return {
        success: false,
        error: `No valid credentials found for ${platform}`,
        retryable: false,
      };
    }

    // Publish using connector
    if (!connector.publish) {
      // Connector exists but does not implement publishing for this platform
      return {
        success: false,
        error: `Publishing is not supported for platform ${platform}`,
        retryable: false,
      };
    }
    logger.info('Publishing via connector', {
      contentId,
      platform,
      brandId: content.brandId,
    });

    // Convert content/media type to Instagram Graph media_type semantics.
    // Internally, carousels are modeled as image posts with multiple assets.
    // Reels and stories are identified via contentType; mediaType remains the raw format.
    const isReel = content.contentType === 'reel';
    const isStory = content.contentType === 'story';
    const primaryAssetId = content.mediaAssets?.[0]?.assetId ?? null;
    if (!primaryAssetId) {
      return {
        success: false,
        error: 'Content has no attached media assets',
        retryable: false,
      };
    }

    const assetsClient = getAssetsClient();
    const [primaryAsset] = await assetsClient.getBatchAssets([primaryAssetId]);
    if (!primaryAsset) {
      return {
        success: false,
        error: 'Primary media asset could not be found',
        retryable: false,
      };
    }

    const isVideo = primaryAsset.fileType === 'video' || isReel;
    const instagramMediaType = isReel
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
    const mediaUrl = primaryAsset.url;

    const publishResult = await connector.publish(
      {
        caption: content.caption || '',
        imageUrl,
        mediaUrl,
        mediaType: instagramMediaType,
        thumbOffset: typeof content.thumbOffset === 'number' ? content.thumbOffset : undefined,
        shareToFeed:
          typeof content.shareToFeed === 'boolean' ? Boolean(content.shareToFeed) : undefined,
      },
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

    // Update content status
    const postedAt = new Date();
    await prisma.content.update({
      where: { id: contentId },
      data: {
        status: 'published',
        postedAt,
      },
    });

    // Create ContentPublication record
    await prisma.contentPublication.create({
      data: {
        contentId,
        socialAccountId: socialAccount.id,
        platform,
        externalPostId: publishResult.externalPostId,
        externalAccountId: socialAccount.externalAccountId,
        externalPageId: socialAccount.externalPageId,
        permalink: publishResult.permalink,
        publishedAt: postedAt,
        status: 'published',
      },
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

    // Determine if error is retryable
    const isRetryable = !/permission|invalid token|not found|authentication/i.test(errorMessage);

    logger.error('Publishing failed', {
      contentId,
      platform,
      error: errorMessage,
      retryable: isRetryable,
    });

    return {
      success: false,
      error: errorMessage,
      retryable: isRetryable,
    };
  }
}

/**
 * Publish content to Instagram
 *
 * @deprecated Use publishContent(contentId, 'instagram') instead.
 * This wrapper exists for backward compatibility with existing routes.
 */
export async function publishContentToInstagram(
  contentId: string,
  _brand: any // Brand parameter no longer used
): Promise<PublishingResult> {
  return publishContent(contentId, 'instagram');
}
