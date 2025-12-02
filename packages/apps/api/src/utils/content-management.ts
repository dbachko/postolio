/**
 * Utility functions for content management operations
 */

import { Prisma } from '@postolio/database';

import { schedulerService } from '../services/scheduler.js';
import { attachAssetToContent, getAssetsClient } from '../services/assets-media.js';
import {
  verifyBrandOwnership,
  verifyCampaignAccess,
} from '../services/content-operations/authorization.js';
import {
  validateContentPayload,
  type ContentType as ValidationContentType,
  type MediaType as ValidationMediaType,
} from '@postolio/content-validation';
import { extractHashtagsFromCaption } from './hashtag-extractor.js';

export interface CreateManualContentBody {
  brandId: string;
  caption: string;
  assetIds?: string[]; // Asset IDs from Assets database (single image or carousel)
  mediaType?: ValidationMediaType;
  contentType?: ValidationContentType;
  videoUrl?: string;
  campaignId?: string;
  scheduledAt?: string;
  shareToFeed?: boolean;
}

export interface ApproveContentBody {
  contentId: string;
  scheduledAt?: string;
}

/**
 * Validates the request body for content creation
 */
export function validateRequestBody(body: CreateManualContentBody) {
  const normalizedContentType: ValidationContentType = body.contentType ?? 'post';
  const normalizedMediaType: ValidationMediaType = body.mediaType ?? 'image';

  const mediaAssets =
    body.assetIds?.map((id) => ({
      key: id,
      type: (normalizedMediaType === 'video' ? 'video' : 'image') as ValidationMediaType,
    })) || [];

  const validation = validateContentPayload({
    platform: 'instagram',
    contentType: normalizedContentType,
    mediaType: normalizedMediaType,
    caption: body.caption,
    videoUrl: body.videoUrl,
    mediaAssets,
  });

  if (!validation.ok) {
    return {
      ok: false,
      error: {
        error: validation.errors[0]?.message || 'Invalid content',
        details: validation.errors,
      },
    };
  }

  return { ok: true };
}

/**
 * Verifies brand ownership and optional campaign access
 */
export async function verifyBrandAndCampaign(
  userId: string,
  brandId: string,
  campaignId?: string
): Promise<{ authorized: boolean; code?: number; error?: string }> {
  const authResult = await verifyBrandOwnership(userId, brandId);
  if (!authResult.authorized) {
    return { authorized: false, code: 404, error: authResult.error };
  }

  if (campaignId) {
    const campaignAuthResult = await verifyCampaignAccess(userId, campaignId);
    if (!campaignAuthResult.authorized) {
      return { authorized: false, code: 404, error: campaignAuthResult.error };
    }
  }

  return { authorized: true };
}

/**
 * Resolves and validates assets for content creation
 */
export async function resolveAssets(
  assetIds: string[] | undefined,
  brandId: string,
  request: any
): Promise<{
  success: boolean;
  code?: number;
  error?: string;
  resolvedAsset?: any;
  resolvedCarouselAssets?: any;
}> {
  if (!assetIds || assetIds.length === 0) {
    return { success: true, resolvedAsset: null, resolvedCarouselAssets: null };
  }

  const assetsClient = getAssetsClient();

  try {
    const assets = await assetsClient.getBatchAssets(assetIds);

    const missingAssets = assets
      .map((asset, idx) => (!asset ? assetIds[idx] : null))
      .filter(Boolean);

    if (missingAssets.length > 0) {
      return {
        success: false,
        code: 404,
        error: `Assets not found: ${missingAssets.join(', ')}`,
      };
    }

    const validAssets = assets.filter(Boolean) as NonNullable<(typeof assets)[number]>[];

    const invalidAssets = validAssets.filter((asset) => asset.brandId !== brandId);
    if (invalidAssets.length > 0) {
      return {
        success: false,
        code: 400,
        error: 'All assets must belong to the same brand as the content',
      };
    }

    if (assetIds.length === 1) {
      const asset = validAssets[0];
      return {
        success: true,
        resolvedAsset: {
          id: asset.id,
          url: asset.url,
          brandId: asset.brandId,
          width: asset.width ?? null,
          height: asset.height ?? null,
        },
        resolvedCarouselAssets: null,
      };
    } else {
      return {
        success: true,
        resolvedAsset: null,
        resolvedCarouselAssets: validAssets.map((asset) => ({
          id: asset.id,
          url: asset.url,
          brandId: asset.brandId,
          width: asset.width ?? null,
          height: asset.height ?? null,
        })),
      };
    }
  } catch (error) {
    request.log.error(error);
    return {
      success: false,
      code: 400,
      error: 'Failed to fetch assets. Please try again.',
    };
  }
}

/**
 * Creates content in a database transaction
 */
export async function createContentInTransaction(
  params: {
    brandId: string;
    caption: string;
    mediaType?: string;
    contentType?: string;
    videoUrl?: string;
    campaignId?: string;
    scheduledAt?: string;
    shareToFeed?: boolean;
    resolvedAsset: any;
    resolvedCarouselAssets: any;
  },
  prismaClient: any
) {
  const status = params.scheduledAt ? 'scheduled' : 'draft';
  const resolvedCampaignId = params.campaignId || null;

  return await prismaClient.$transaction(async (tx: any) => {
    const created = await tx.content.create({
      data: {
        caption: params.caption,
        hashtags: extractHashtagsFromCaption(params.caption),
        status,
        brandId: params.brandId,
        campaignId: resolvedCampaignId,
        scheduledAt: params.scheduledAt ? new Date(params.scheduledAt) : null,
        mediaType: params.mediaType || 'image',
        contentType: params.contentType || 'post',
        videoUrl: params.videoUrl || null,
        shareToFeed: params.shareToFeed ?? null,
        generationParams: Prisma.JsonNull,
      },
      select: {
        id: true,
        caption: true,
        primaryAssetCdnUrl: true,
        primaryAssetId: true,
        primaryAssetHeight: true,
        primaryAssetWidth: true,
        status: true,
        brandId: true,
        generationParams: true,
        createdAt: true,
        mediaType: true,
        contentType: true,
        videoUrl: true,
        shareToFeed: true,
      },
    });

    if (params.resolvedAsset) {
      await attachAssetToContent({
        contentId: created.id,
        asset: params.resolvedAsset,
        prisma: tx,
      });
      return {
        ...created,
        primaryAssetId: params.resolvedAsset.id,
        primaryAssetCdnUrl: params.resolvedAsset.url,
        primaryAssetWidth: params.resolvedAsset.width,
        primaryAssetHeight: params.resolvedAsset.height,
      };
    }

    if (params.resolvedCarouselAssets && params.resolvedCarouselAssets.length > 0) {
      const firstAsset = params.resolvedCarouselAssets[0];

      for (let i = 0; i < params.resolvedCarouselAssets.length; i++) {
        const asset = params.resolvedCarouselAssets[i];
        await tx.postMediaAsset.create({
          data: {
            contentId: created.id,
            assetId: asset.id,
            cdnUrl: asset.url,
            displayOrder: i,
            usageContext: i === 0 ? 'primary' : `carousel_${i}`,
          },
        });
      }

      await tx.content.update({
        where: { id: created.id },
        data: {
          primaryAssetId: firstAsset.id,
          primaryAssetCdnUrl: firstAsset.url,
          primaryAssetWidth: firstAsset.width,
          primaryAssetHeight: firstAsset.height,
        },
      });

      return {
        ...created,
        primaryAssetId: firstAsset.id,
        primaryAssetCdnUrl: firstAsset.url,
        primaryAssetWidth: firstAsset.width,
        primaryAssetHeight: firstAsset.height,
      };
    }

    return created;
  });
}

/**
 * Handles AWS scheduling for content
 */
export async function handleScheduling(contentId: string, scheduledAt?: string) {
  if (!scheduledAt) return null;

  try {
    const scheduleResult = await schedulerService.scheduleContent(contentId);

    if (!scheduleResult.success) {
      console.error('Failed to create AWS schedule:', scheduleResult.error);
      if (
        typeof scheduleResult.error === 'string' &&
        scheduleResult.error.toLowerCase().includes('upgrade required')
      ) {
        return { upgradeRequired: true, message: scheduleResult.error };
      }
    } else {
      console.log(`Content ${contentId} scheduled successfully in AWS`);
    }
  } catch (scheduleError) {
    console.error('Error calling scheduler service:', scheduleError);
  }

  return null;
}
