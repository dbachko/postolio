/**
 * Publishing Operations Service
 * Handles content publishing to social media platforms (currently Instagram)
 */

import { instagramService } from '../instagram.js';
import { getDatabaseClient } from '../../config/database.js';
import type { Brand } from '@postolio/database';

const prisma = getDatabaseClient();

export interface PublishingResult {
  success: boolean;
  error?: string;
  retryable?: boolean;
  data?: {
    instagramPostId: string;
    instagramPermalink: string;
    postedAt: Date;
  };
}

/**
 * Publish content to Instagram
 */
export async function publishContentToInstagram(
  contentId: string,
  brand: Brand
): Promise<PublishingResult> {
  try {
    // Get content
    const content = await prisma.content.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        primaryAssetCdnUrl: true,
        caption: true,
        hashtags: true,
        status: true,
      },
    });

    if (!content) {
      return {
        success: false,
        error: 'Content not found',
        retryable: false,
      };
    }

    // Validate content
    if (content.status !== 'scheduled' && content.status !== 'draft') {
      return {
        success: false,
        error: 'Content must be scheduled or in draft status before publishing',
        retryable: false,
      };
    }

    if (!content.primaryAssetCdnUrl) {
      return {
        success: false,
        error: 'Image is required for Instagram posting',
        retryable: false,
      };
    }

    if (!content.caption || content.caption.trim().length === 0) {
      return {
        success: false,
        error: 'Caption is required for Instagram posting',
        retryable: false,
      };
    }

    if (!content.hashtags || content.hashtags.length === 0) {
      return {
        success: false,
        error: 'At least one hashtag is required for Instagram posting',
        retryable: false,
      };
    }

    // Check Instagram connection
    if (!instagramService.isConfigured(brand)) {
      return {
        success: false,
        error: 'Instagram account not connected to this brand',
        retryable: false,
      };
    }

    // Get CDN URL
    // Publish to Instagram
    const publishResult = await instagramService.publishMedia(brand, {
      cdnImageUrl: content.primaryAssetCdnUrl,
      caption: content.caption,
      hashtags: content.hashtags,
    });

    // Update content status
    const postedAt = new Date();
    await prisma.content.update({
      where: { id: contentId },
      data: {
        status: 'published',
        postedAt,
        instagramPostId: publishResult.id,
        instagramPermalink: publishResult.permalink,
      },
    });

    return {
      success: true,
      data: {
        instagramPostId: publishResult.id,
        instagramPermalink: publishResult.permalink,
        postedAt,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to publish to Instagram';
    const isRetryable = !/permission|invalid token|not found/i.test(errorMessage);

    return {
      success: false,
      error: errorMessage,
      retryable: isRetryable,
    };
  }
}
