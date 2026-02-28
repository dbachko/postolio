import {
  validateContentPayload,
  type MediaType as ValidationMediaType,
} from '@postolio/content-validation';
import type { AssetRecord } from '@postolio/assets-client';

import { getAssetsClient } from '../../../services/assets-media.js';
import { supportsScheduling, toValidationPlatform } from '../../../utils/platform.js';
import { isMultiDestinationEnabledForUser } from '../../../utils/feature-flags.js';
import {
  isDisconnected,
  prisma,
  type PublishableValidationInput,
  type RouteError,
  type TargetResolution,
} from './shared.js';

export function normalizeTargetSocialAccountId(
  value: unknown
): string | null | undefined | '__invalid__' {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    return '__invalid__';
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function getExistingTargetSocialAccountId(content: any): string | null {
  const raw = content?.targetSocialAccountId;
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveSocialAccount(params: {
  brandId: string;
  effectiveTargetSocialAccountId: string | null;
  normalizedTargetSocialAccountId: string | null | undefined;
}): Promise<{
  resolvedTargetSocialAccount: { id: string; platform: string } | null;
  resolvedTargetSocialAccountDisconnected: boolean;
  error?: RouteError;
}> {
  if (!params.effectiveTargetSocialAccountId) {
    return {
      resolvedTargetSocialAccount: null,
      resolvedTargetSocialAccountDisconnected: false,
    };
  }

  const socialAccount = await prisma.socialAccount.findFirst({
    where: {
      id: params.effectiveTargetSocialAccountId,
      brandId: params.brandId,
    },
    select: { id: true, platform: true, metadata: true },
  });

  if (!socialAccount) {
    if (params.normalizedTargetSocialAccountId !== undefined) {
      return {
        resolvedTargetSocialAccount: null,
        resolvedTargetSocialAccountDisconnected: false,
        error: {
          statusCode: 400,
          body: {
            error: 'invalid_target_social_account',
            message: 'Target social account is not connected to this brand',
          },
        },
      };
    }

    return {
      resolvedTargetSocialAccount: null,
      resolvedTargetSocialAccountDisconnected: false,
    };
  }

  const disconnected = isDisconnected(socialAccount.metadata);
  if (params.normalizedTargetSocialAccountId !== undefined && disconnected) {
    return {
      resolvedTargetSocialAccount: null,
      resolvedTargetSocialAccountDisconnected: true,
      error: {
        statusCode: 400,
        body: {
          error: 'invalid_target_social_account',
          message: 'Target social account is not connected to this brand',
        },
      },
    };
  }

  return {
    resolvedTargetSocialAccount: {
      id: socialAccount.id,
      platform: String(socialAccount.platform),
    },
    resolvedTargetSocialAccountDisconnected: disconnected,
  };
}

function resolveFeatureConstraints(params: {
  userId: string;
  email?: string | null;
  normalizedTargetSocialAccountId: string | null | undefined;
  resolvedTargetSocialAccount: { id: string; platform: string } | null;
}): RouteError | null {
  const multiDestinationEnabled = isMultiDestinationEnabledForUser({
    userId: params.userId,
    email: params.email,
  });

  if (
    !multiDestinationEnabled &&
    params.normalizedTargetSocialAccountId !== undefined &&
    params.resolvedTargetSocialAccount &&
    params.resolvedTargetSocialAccount.platform.toLowerCase() !== 'instagram'
  ) {
    return {
      statusCode: 403,
      body: {
        error: 'feature_disabled',
        code: 'PLATFORM_NOT_ENABLED',
        message: 'Only Instagram destinations are enabled for this account',
      },
    };
  }

  return null;
}

export async function resolveTargetForUpdate(params: {
  userId: string;
  email?: string | null;
  content: any;
  targetSocialAccountId: unknown;
}): Promise<{ data?: TargetResolution; error?: RouteError }> {
  const normalizedTargetSocialAccountId = normalizeTargetSocialAccountId(
    params.targetSocialAccountId
  );
  if (normalizedTargetSocialAccountId === '__invalid__') {
    return {
      error: {
        statusCode: 400,
        body: {
          error: 'Invalid targetSocialAccountId',
          details: ['targetSocialAccountId must be a string or null'],
        },
      },
    };
  }

  const existingTargetSocialAccountId = getExistingTargetSocialAccountId(params.content);
  const effectiveTargetSocialAccountId =
    normalizedTargetSocialAccountId === undefined
      ? existingTargetSocialAccountId
      : normalizedTargetSocialAccountId;

  const accountResult = await resolveSocialAccount({
    brandId: params.content.brandId,
    effectiveTargetSocialAccountId,
    normalizedTargetSocialAccountId,
  });
  if (accountResult.error) {
    return { error: accountResult.error };
  }

  const featureError = resolveFeatureConstraints({
    userId: params.userId,
    email: params.email,
    normalizedTargetSocialAccountId,
    resolvedTargetSocialAccount: accountResult.resolvedTargetSocialAccount,
  });
  if (featureError) {
    return { error: featureError };
  }

  const destinationPlatform = accountResult.resolvedTargetSocialAccount?.platform ?? 'instagram';
  const schedulingSupported = supportsScheduling(destinationPlatform);
  const schedulingEligible =
    schedulingSupported &&
    (!effectiveTargetSocialAccountId ||
      (Boolean(accountResult.resolvedTargetSocialAccount) &&
        !accountResult.resolvedTargetSocialAccountDisconnected));

  return {
    data: {
      normalizedTargetSocialAccountId,
      effectiveTargetSocialAccountId,
      resolvedTargetSocialAccount: accountResult.resolvedTargetSocialAccount,
      resolvedTargetSocialAccountDisconnected:
        accountResult.resolvedTargetSocialAccountDisconnected,
      destinationPlatform,
      schedulingSupported,
      schedulingEligible,
      updateTargetSocialAccountId:
        normalizedTargetSocialAccountId === undefined
          ? undefined
          : normalizedTargetSocialAccountId
            ? accountResult.resolvedTargetSocialAccount?.id || null
            : null,
    },
  };
}

export function validateSchedulingRequest(params: {
  scheduledAt?: string;
  destinationPlatform: string;
  schedulingSupported: boolean;
  schedulingEligible: boolean;
}): RouteError | null {
  if (params.scheduledAt !== undefined && params.scheduledAt && !params.schedulingSupported) {
    return {
      statusCode: 400,
      body: {
        error: 'scheduling_not_supported',
        message: `Scheduling is not yet supported for ${params.destinationPlatform}`,
      },
    };
  }

  if (params.scheduledAt !== undefined && params.scheduledAt && !params.schedulingEligible) {
    return {
      statusCode: 400,
      body: {
        error: 'invalid_target_social_account',
        message:
          'Selected destination account is no longer connected. Choose a different destination and try again.',
      },
    };
  }

  return null;
}

function buildMediaAssetsForValidation(params: {
  joinMediaAssets: Array<{ assetId: string; displayOrder: number }>;
  resolvedAssets: Array<AssetRecord | null>;
}) {
  const resolvedById = new Map(
    (params.resolvedAssets.filter(Boolean) as AssetRecord[]).map((asset) => [asset.id, asset])
  );

  return params.joinMediaAssets
    .map((asset) => {
      const resolved = resolvedById.get(asset.assetId);
      if (!resolved) {
        return null;
      }
      return {
        key: resolved.id,
        type: resolved.fileType === 'video' ? ('video' as const) : ('image' as const),
      };
    })
    .filter((asset): asset is { key: string; type: 'image' | 'video' } => Boolean(asset));
}

function resolveMediaTypeHint(
  effectiveContentType: 'post' | 'reel' | 'story',
  mediaAssetsForValidation: Array<{ key: string; type: 'image' | 'video' }>
): ValidationMediaType | undefined {
  if (effectiveContentType === 'reel') {
    return 'video';
  }
  if (mediaAssetsForValidation.some((asset) => asset.type === 'video')) {
    return 'video';
  }
  if (mediaAssetsForValidation.length > 0) {
    return 'image';
  }
  return undefined;
}

export async function validatePublishableContent(
  request: { log: { error: (context: unknown, message: string) => void } },
  params: PublishableValidationInput
): Promise<RouteError | null> {
  const isUnscheduling = params.scheduledAt !== undefined && !params.scheduledAt;
  const requiresPublishableValidation =
    !isUnscheduling &&
    (Boolean(params.content.publishingQueueItem) ||
      params.content.status === 'scheduled' ||
      (params.scheduledAt !== undefined && Boolean(params.scheduledAt)));

  if (!requiresPublishableValidation) {
    return null;
  }

  const joinMediaAssets = (params.content.mediaAssets ?? [])
    .map((asset: { assetId?: unknown; displayOrder?: unknown }) => ({
      assetId: asset.assetId,
      displayOrder: asset.displayOrder,
    }))
    .sort((left: any, right: any) => left.displayOrder - right.displayOrder);

  const assetIds = joinMediaAssets
    .map((asset: { assetId?: unknown }) => asset.assetId)
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);

  let resolvedAssets: Array<AssetRecord | null> = [];
  if (assetIds.length > 0) {
    try {
      resolvedAssets = await getAssetsClient().getBatchAssets(assetIds);
    } catch (error) {
      request.log.error(
        { err: error, contentId: params.contentId, assetCount: assetIds.length },
        'Failed to fetch media assets'
      );
      return {
        statusCode: 400,
        body: { error: 'Failed to fetch linked media assets. Please try again.' },
      };
    }
  }

  const missingAssets = resolvedAssets
    .map((asset, index) => (!asset ? assetIds[index] : null))
    .filter((id): id is string => Boolean(id));
  if (missingAssets.length > 0) {
    return {
      statusCode: 400,
      body: {
        error: 'Some linked media assets could not be found',
        details: missingAssets,
      },
    };
  }

  const mediaAssetsForValidation = buildMediaAssetsForValidation({
    joinMediaAssets,
    resolvedAssets,
  });
  const mediaTypeHint = resolveMediaTypeHint(params.effectiveContentType, mediaAssetsForValidation);

  const validationPlatform = toValidationPlatform(params.destinationPlatform);
  if (!validationPlatform) {
    return {
      statusCode: 400,
      body: {
        error: 'unsupported_platform',
        message: `Platform ${params.destinationPlatform} is not supported for content updates yet`,
      },
    };
  }

  const validation = validateContentPayload({
    platform: validationPlatform,
    contentType: params.effectiveContentType,
    mediaType: mediaTypeHint,
    caption: params.effectiveContentType === 'story' ? '' : params.effectiveCaption,
    mediaAssets: mediaAssetsForValidation,
  });

  if (!validation.ok) {
    return {
      statusCode: 400,
      body: {
        error: validation.errors[0]?.message || 'Invalid content payload',
        details: validation.errors,
      },
    };
  }

  return null;
}
