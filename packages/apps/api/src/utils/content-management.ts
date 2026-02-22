/**
 * Utility functions for content management operations
 */

import { Prisma } from '@postolio/database';

import { schedulerService } from '../services/scheduler.js';
import { getAssetsClient } from '../services/assets-media.js';
import {
  validateContentPayload,
  type ContentType as ValidationContentType,
  type MediaType as ValidationMediaType,
} from '@postolio/content-validation';
import { extractHashtagsFromCaption } from './hashtag-extractor.js';
import { haveUniformAspectRatio } from './aspect-ratio.js';
import type { AssetRecord } from '@postolio/assets-client';

export interface CreateManualContentBody {
  brandId: string;
  caption: string;
  assetIds?: string[]; // Asset IDs from Assets database (single image or carousel)
  contentType?: ValidationContentType;
  scheduledAt?: string;
  shareToFeed?: boolean;
  firstComment?: string;
  targetSocialAccountIds?: string[];
  targetSocialAccountId?: string | null;
}

export interface ApproveContentBody {
  contentId: string;
  scheduledAt?: string;
}

/**
 * Validates the request body for content creation
 */
export function validateRequestBody(body: CreateManualContentBody) {
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      error: {
        error: 'Invalid request body',
        details: ['Request body must be an object'],
      },
    };
  }

  if (!body.brandId || typeof body.brandId !== 'string') {
    return {
      ok: false,
      error: {
        error: 'brandId is required',
        details: ['brandId is required'],
      },
    };
  }

  if (body.caption == null || typeof body.caption !== 'string') {
    return {
      ok: false,
      error: {
        error: 'caption is required',
        details: ['caption is required'],
      },
    };
  }

  if (body.assetIds !== undefined && !Array.isArray(body.assetIds)) {
    return {
      ok: false,
      error: {
        error: 'assetIds must be an array if provided',
        details: ['assetIds must be an array if provided'],
      },
    };
  }

  if (body.firstComment !== undefined) {
    if (typeof body.firstComment !== 'string') {
      return {
        ok: false,
        error: {
          error: 'firstComment must be a string if provided',
          details: ['firstComment must be a string if provided'],
        },
      };
    }
    if (body.firstComment.length > 2200) {
      return {
        ok: false,
        error: {
          error: 'firstComment must be at most 2200 characters',
          details: ['firstComment must be at most 2200 characters'],
        },
      };
    }
  }

  if (
    body.targetSocialAccountId !== undefined &&
    body.targetSocialAccountId !== null &&
    typeof body.targetSocialAccountId !== 'string'
  ) {
    return {
      ok: false,
      error: {
        error: 'targetSocialAccountId must be a string or null if provided',
        details: ['targetSocialAccountId must be a string or null if provided'],
      },
    };
  }

  if (body.targetSocialAccountIds !== undefined) {
    if (!Array.isArray(body.targetSocialAccountIds)) {
      return {
        ok: false,
        error: {
          error: 'targetSocialAccountIds must be an array if provided',
          details: ['targetSocialAccountIds must be an array if provided'],
        },
      };
    }

    const normalized = body.targetSocialAccountIds
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    if (normalized.length === 0) {
      if (body.scheduledAt) {
        return {
          ok: false,
          error: {
            error: 'targetSocialAccountIds must include at least one destination',
            details: ['targetSocialAccountIds must include at least one destination'],
          },
        };
      }
    }
  }

  return { ok: true };
}

export function validateInstagramContentForCreate(params: {
  caption: string;
  contentType: ValidationContentType;
  assets: AssetRecord[];
}): { ok: true } | { ok: false; error: { error: string; details: unknown } } {
  const normalizedContentType: ValidationContentType = params.contentType ?? 'post';
  const assets = params.assets ?? [];

  if (normalizedContentType === 'reel') {
    if (assets.length !== 1 || assets[0]?.fileType !== 'video') {
      return {
        ok: false,
        error: {
          error: 'Reels require exactly one video asset',
          details: ['contentType=reel requires one asset with fileType=video'],
        },
      };
    }
  }

  if (assets.length > 1) {
    const nonImages = assets.filter((a) => a.fileType !== 'image');
    if (nonImages.length > 0) {
      return {
        ok: false,
        error: {
          error: 'Carousels currently support images only',
          details: ['Attach one video for video posts, or images for carousels'],
        },
      };
    }
  }

  const mediaAssets = assets.map((asset) => ({
    key: asset.id,
    type: (asset.fileType === 'video' ? 'video' : 'image') as ValidationMediaType,
  }));

  const mediaTypeHint: ValidationMediaType =
    normalizedContentType === 'reel'
      ? 'video'
      : assets.length === 1 && assets[0]?.fileType === 'video'
        ? 'video'
        : 'image';

  const validation = validateContentPayload({
    platform: 'instagram',
    contentType: normalizedContentType,
    mediaType: mediaTypeHint,
    caption: params.caption,
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
 * Resolves and validates assets for content creation
 */
export async function resolveAssets(
  assetIds: string[] | undefined,
  brandId: string,
  request: any,
  options?: { enforceUniformAspectRatio?: boolean }
): Promise<{
  success: boolean;
  code?: number;
  error?: string;
  resolvedAssets: AssetRecord[];
}> {
  if (!assetIds || assetIds.length === 0) {
    return { success: true, resolvedAssets: [] };
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
        resolvedAssets: [],
      };
    }

    const validAssets = assets.filter(Boolean) as Array<NonNullable<(typeof assets)[number]>>;

    const invalidAssets = validAssets.filter((asset) => asset.brandId !== brandId);
    if (invalidAssets.length > 0) {
      return {
        success: false,
        code: 400,
        error: 'All assets must belong to the same brand as the content',
        resolvedAssets: [],
      };
    }

    const enforceUniformAspectRatio = options?.enforceUniformAspectRatio !== false;

    // When creating a carousel, require all assets to share the same aspect ratio.
    if (enforceUniformAspectRatio && assetIds.length > 1 && !haveUniformAspectRatio(validAssets)) {
      return {
        success: false,
        code: 400,
        error:
          'All carousel items must have the same aspect ratio. Please crop or resize your media so they match.',
        resolvedAssets: [],
      };
    }

    return {
      success: true,
      resolvedAssets: validAssets,
    };
  } catch (error) {
    request.log.error(error);
    return {
      success: false,
      code: 400,
      error: 'Failed to fetch assets. Please try again.',
      resolvedAssets: [],
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
    contentType?: string;
    scheduledAt?: string;
    shareToFeed?: boolean;
    firstComment?: string;
    contentGroupId?: string | null;
    targetSocialAccountId?: string | null;
    resolvedAssets: AssetRecord[];
  },
  prismaClient: any
) {
  const status = params.scheduledAt ? 'scheduled' : 'draft';

  return await prismaClient.$transaction(async (tx: any) => {
    const created = await tx.content.create({
      data: {
        caption: params.caption,
        hashtags: extractHashtagsFromCaption(params.caption),
        status,
        brandId: params.brandId,
        contentGroupId: params.contentGroupId ?? null,
        scheduledAt: params.scheduledAt ? new Date(params.scheduledAt) : null,
        contentType: params.contentType || 'post',
        shareToFeed: params.shareToFeed ?? null,
        firstComment: params.firstComment ? params.firstComment.trim() : null,
        targetSocialAccountId: params.targetSocialAccountId ?? null,
        generationParams: Prisma.JsonNull,
      },
      select: {
        id: true,
      },
    });

    if (params.resolvedAssets.length > 0) {
      await tx.contentMediaAsset.createMany({
        data: params.resolvedAssets.map((asset, idx) => ({
          contentId: created.id,
          assetId: asset.id,
          displayOrder: idx,
        })),
      });
    }

    return tx.content.findUnique({
      where: { id: created.id },
      select: {
        id: true,
        caption: true,
        hashtags: true,
        status: true,
        brandId: true,
        contentGroupId: true,
        targetSocialAccountId: true,
        schedulingError: true,
        generationParams: true,
        createdAt: true,
        updatedAt: true,
        scheduledAt: true,
        postedAt: true,
        contentType: true,
        shareToFeed: true,
        firstComment: true,
        firstCommentStatus: true,
        firstCommentPostedAt: true,
        firstCommentError: true,
        mediaAssets: {
          select: { assetId: true, displayOrder: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
  });
}

/**
 * Handles AWS scheduling for content
 */
export async function handleScheduling(contentId: string, scheduledAt?: string) {
  if (!scheduledAt) {
    return null;
  }

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
