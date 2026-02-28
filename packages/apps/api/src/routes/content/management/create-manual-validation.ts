import type { AssetRecord } from '@postolio/assets-client';
import { validateContentPayload } from '@postolio/content-validation';

import { supportsScheduling, toValidationPlatform } from '../../../utils/platform.js';
import type { DestinationAccount } from './shared.js';

export type RouteValidationError = {
  statusCode: number;
  body: Record<string, unknown>;
};

function buildMediaAssetsForValidation(resolvedAssets: AssetRecord[]) {
  return resolvedAssets.map((asset) => ({
    key: asset.id,
    type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
  }));
}

function validateMediaRules(
  contentType: string,
  resolvedAssets: AssetRecord[]
): RouteValidationError | null {
  if (contentType === 'reel') {
    if (resolvedAssets.length !== 1 || resolvedAssets[0]?.fileType !== 'video') {
      return {
        statusCode: 400,
        body: { error: 'invalid_media', message: 'Reels require exactly one video asset' },
      };
    }
  }

  if (resolvedAssets.length > 1) {
    const nonImages = resolvedAssets.filter((asset) => asset.fileType !== 'image');
    if (nonImages.length > 0) {
      return {
        statusCode: 400,
        body: { error: 'invalid_media', message: 'Carousels currently support images only' },
      };
    }
  }

  return null;
}

function validatePlatforms(params: {
  contentType: string;
  caption: string;
  resolvedAssets: AssetRecord[];
  destinations: DestinationAccount[];
}): RouteValidationError | null {
  const mediaAssets = buildMediaAssetsForValidation(params.resolvedAssets);
  const mediaTypeHint =
    params.contentType === 'reel' || mediaAssets.some((asset) => asset.type === 'video')
      ? 'video'
      : mediaAssets.length > 0
        ? 'image'
        : undefined;

  const captionForValidation = params.contentType === 'story' ? '' : params.caption;
  const platforms =
    params.destinations.length > 0
      ? params.destinations.map((destination) => destination.platform)
      : ['instagram'];

  for (const platform of platforms) {
    const validationPlatform = toValidationPlatform(platform);
    if (!validationPlatform) {
      return {
        statusCode: 400,
        body: {
          error: 'unsupported_platform',
          message: `Platform ${platform} is not supported for content creation yet`,
        },
      };
    }

    const validation = validateContentPayload({
      platform: validationPlatform,
      contentType: params.contentType as any,
      mediaType: mediaTypeHint,
      caption: captionForValidation,
      mediaAssets,
    });

    if (!validation.ok) {
      return {
        statusCode: 400,
        body: {
          error: 'invalid_content',
          message: validation.errors[0]?.message || 'Invalid content payload',
          platform,
          details: validation.errors,
        },
      };
    }
  }

  return null;
}

export function validateCreateRequest(params: {
  contentType: string;
  caption: string;
  resolvedAssets: AssetRecord[];
  destinations: DestinationAccount[];
  scheduledAt?: string;
}): RouteValidationError | null {
  const mediaError = validateMediaRules(params.contentType, params.resolvedAssets);
  if (mediaError) {
    return mediaError;
  }

  const platformError = validatePlatforms({
    contentType: params.contentType,
    caption: params.caption,
    resolvedAssets: params.resolvedAssets,
    destinations: params.destinations,
  });
  if (platformError) {
    return platformError;
  }

  if (!params.scheduledAt) {
    return null;
  }

  const unsupported = Array.from(
    new Set(
      params.destinations
        .filter((destination) => !supportsScheduling(destination.platform))
        .map((destination) => destination.platform)
    )
  );

  if (unsupported.length > 0) {
    return {
      statusCode: 400,
      body: {
        error: 'scheduling_not_supported',
        message: 'Scheduling is not yet supported for one or more selected destinations',
        details: unsupported,
      },
    };
  }

  return null;
}
