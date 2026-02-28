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
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return Boolean((metadata as any).disconnected);
}

function normalizeContentType(raw: unknown): ValidationContentType {
  if (raw === 'reel' || raw === 'story') {
    return raw;
  }
  return 'post';
}

function validationFailure(
  code: QueueContentValidationErrorCode,
  message: string,
  details?: unknown
) {
  return details !== undefined
    ? { ok: false as const, code, message, details }
    : { ok: false as const, code, message };
}

function validateMediaRules(
  normalizedContentType: ValidationContentType,
  validationPlatform: string,
  resolvedAssets: AssetRecord[]
) {
  if (normalizedContentType === 'reel') {
    if (resolvedAssets.length !== 1 || resolvedAssets[0]?.fileType !== 'video') {
      return validationFailure('invalid_media', 'Reels require exactly one video asset.');
    }
  }

  if (resolvedAssets.length > 1) {
    const nonImages = resolvedAssets.filter((asset) => asset.fileType !== 'image');
    if (nonImages.length > 0) {
      return validationFailure('invalid_media', 'Carousels currently support images only.');
    }
  }

  if (
    validationPlatform === 'instagram' &&
    resolvedAssets.length > 1 &&
    !haveUniformAspectRatio(resolvedAssets)
  ) {
    return validationFailure(
      'invalid_media',
      'All carousel items must have the same aspect ratio before queueing. Please crop or resize your media so they match.'
    );
  }

  return null;
}

function buildMediaValidationInputs(
  normalizedContentType: ValidationContentType,
  resolvedAssets: AssetRecord[]
) {
  const mediaAssetsForValidation = resolvedAssets.map((asset) => ({
    key: asset.id,
    type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
  }));

  const hasVideo = mediaAssetsForValidation.some((asset) => asset.type === 'video');
  const mediaTypeHint: ValidationMediaType | undefined =
    normalizedContentType === 'reel' || hasVideo
      ? 'video'
      : mediaAssetsForValidation.length > 0
        ? 'image'
        : undefined;

  return { mediaAssetsForValidation, mediaTypeHint };
}

function resolveValidationPlatform(platform: string) {
  const validationPlatform = toValidationPlatform(platform);
  if (!validationPlatform) {
    return validationFailure(
      'unsupported_platform',
      `Platform ${platform} is not supported for queue scheduling yet.`
    );
  }
  if (!supportsScheduling(platform)) {
    return validationFailure(
      'unsupported_platform',
      `Queue scheduling is not available for ${platform} yet.`
    );
  }
  return { ok: true as const, validationPlatform };
}

async function resolveContentAssets(assetIds: string[]) {
  const assetsClient = getAssetsClient();
  const assets = assetIds.length ? await assetsClient.getBatchAssets(assetIds) : [];
  const missingAssets = assets.map((asset, idx) => (!asset ? assetIds[idx] : null)).filter(Boolean);

  if (missingAssets.length > 0) {
    return validationFailure(
      'missing_assets',
      'One or more media assets are missing.',
      missingAssets
    );
  }
  return { ok: true as const, resolvedAssets: assets.filter(Boolean) as AssetRecord[] };
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
    return validationFailure('destination_not_found', 'Destination social account not found.');
  }
  if (isDisconnected(destination.metadata)) {
    return validationFailure(
      'destination_disconnected',
      'Destination social account is disconnected.'
    );
  }

  const platformResult = resolveValidationPlatform(String(destination.platform));
  if (!platformResult.ok) {
    return platformResult;
  }
  const { validationPlatform } = platformResult;

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
    return validationFailure('content_not_found', 'Content not found.');
  }

  const normalizedContentType = normalizeContentType(content.contentType);
  const assetIds = content.mediaAssets.map((m) => m.assetId);
  const assetResult = await resolveContentAssets(assetIds);
  if (!assetResult.ok) {
    return assetResult;
  }
  const { resolvedAssets } = assetResult;
  const mediaRuleValidation = validateMediaRules(
    normalizedContentType,
    validationPlatform,
    resolvedAssets
  );
  if (mediaRuleValidation) {
    return mediaRuleValidation;
  }

  const { mediaAssetsForValidation, mediaTypeHint } = buildMediaValidationInputs(
    normalizedContentType,
    resolvedAssets
  );

  const validation = validateContentPayload({
    platform: validationPlatform,
    contentType: normalizedContentType,
    ...(mediaTypeHint ? { mediaType: mediaTypeHint } : {}),
    caption: normalizedContentType === 'story' ? '' : content.caption,
    ...(mediaAssetsForValidation.length > 0 ? { mediaAssets: mediaAssetsForValidation } : {}),
  });

  if (!validation.ok) {
    return validationFailure(
      'invalid_content',
      validation.errors[0]?.message || 'Invalid content payload.',
      validation.errors
    );
  }

  return { ok: true };
}
