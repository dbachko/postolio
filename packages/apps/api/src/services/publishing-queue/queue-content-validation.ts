import type { AssetRecord } from '@postolio/assets-client';
import {
  validateContentPayload,
  type ContentType as ValidationContentType,
  type MediaType as ValidationMediaType,
} from '@postolio/content-validation';

import { getDatabaseClient } from '../../config/database.js';
import { haveUniformAspectRatio } from '../../utils/aspect-ratio.js';
import { supportsScheduling, toValidationPlatform } from '../../utils/platform.js';
import { getAssetsClient } from '../assets-media.js';

const prisma = getDatabaseClient();

type QueueContentValidationErrorCode =
  | 'content_not_found'
  | 'destination_not_found'
  | 'destination_disconnected'
  | 'unsupported_platform'
  | 'missing_assets'
  | 'invalid_media'
  | 'invalid_content';

function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return Boolean((metadata as any).disconnected);
}

function normalizeContentType(raw: unknown): ValidationContentType {
  if (raw === 'reel' || raw === 'story') return raw;
  return 'post';
}

export async function validateQueueableContent(params: {
  contentId: string;
  brandId: string;
  socialAccountId: string;
}): Promise<
  | { ok: true }
  | { ok: false; code: QueueContentValidationErrorCode; message: string; details?: unknown }
> {
  const destination = await prisma.socialAccount.findFirst({
    where: { id: params.socialAccountId, brandId: params.brandId },
    select: { id: true, platform: true, metadata: true },
  });
  if (!destination) {
    return {
      ok: false,
      code: 'destination_not_found',
      message: 'Destination social account not found.',
    };
  }
  if (isDisconnected(destination.metadata)) {
    return {
      ok: false,
      code: 'destination_disconnected',
      message: 'Destination social account is disconnected.',
    };
  }

  const validationPlatform = toValidationPlatform(String(destination.platform));
  if (!validationPlatform) {
    return {
      ok: false,
      code: 'unsupported_platform',
      message: `Platform ${destination.platform} is not supported for queue scheduling yet.`,
    };
  }
  if (!supportsScheduling(String(destination.platform))) {
    return {
      ok: false,
      code: 'unsupported_platform',
      message: `Queue scheduling is not available for ${destination.platform} yet.`,
    };
  }

  const content = await prisma.content.findFirst({
    where: { id: params.contentId, brandId: params.brandId },
    select: {
      id: true,
      caption: true,
      contentType: true,
      mediaAssets: {
        select: { assetId: true, displayOrder: true },
        orderBy: { displayOrder: 'asc' },
      },
    },
  });
  if (!content) {
    return { ok: false, code: 'content_not_found', message: 'Content not found.' };
  }

  const normalizedContentType = normalizeContentType(content.contentType);
  const assetIds = content.mediaAssets.map((m) => m.assetId);

  const assetsClient = getAssetsClient();
  const assets = assetIds.length ? await assetsClient.getBatchAssets(assetIds) : [];

  const missingAssets = assets.map((asset, idx) => (!asset ? assetIds[idx] : null)).filter(Boolean);
  if (missingAssets.length > 0) {
    return {
      ok: false,
      code: 'missing_assets',
      message: 'One or more media assets are missing.',
      details: missingAssets,
    };
  }

  const resolvedAssets = assets.filter(Boolean) as AssetRecord[];

  // Queue items must be publishable-ready.
  if (normalizedContentType === 'reel') {
    if (resolvedAssets.length !== 1 || resolvedAssets[0]?.fileType !== 'video') {
      return {
        ok: false,
        code: 'invalid_media',
        message: 'Reels require exactly one video asset.',
      };
    }
  }
  if (resolvedAssets.length > 1) {
    const nonImages = resolvedAssets.filter((a) => a.fileType !== 'image');
    if (nonImages.length > 0) {
      return {
        ok: false,
        code: 'invalid_media',
        message: 'Carousels currently support images only.',
      };
    }
  }

  // For Instagram carousels, keep aspect ratios consistent to avoid schedule-time failures.
  if (
    validationPlatform === 'instagram' &&
    resolvedAssets.length > 1 &&
    !haveUniformAspectRatio(resolvedAssets)
  ) {
    return {
      ok: false,
      code: 'invalid_media',
      message:
        'All carousel items must have the same aspect ratio before queueing. Please crop or resize your media so they match.',
    };
  }

  const mediaAssetsForValidation = resolvedAssets.map((asset) => ({
    key: asset.id,
    type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
  }));

  const mediaTypeHint: ValidationMediaType | undefined =
    normalizedContentType === 'reel' || mediaAssetsForValidation.some((a) => a.type === 'video')
      ? 'video'
      : mediaAssetsForValidation.length > 0
        ? 'image'
        : undefined;

  const validation = validateContentPayload({
    platform: validationPlatform,
    contentType: normalizedContentType,
    ...(mediaTypeHint ? { mediaType: mediaTypeHint } : {}),
    caption: normalizedContentType === 'story' ? '' : content.caption,
    ...(mediaAssetsForValidation.length > 0 ? { mediaAssets: mediaAssetsForValidation } : {}),
  });

  if (!validation.ok) {
    return {
      ok: false,
      code: 'invalid_content',
      message: validation.errors[0]?.message || 'Invalid content payload.',
      details: validation.errors,
    };
  }

  return { ok: true };
}
