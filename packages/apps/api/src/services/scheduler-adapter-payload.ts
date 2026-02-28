import {
  validateContentPayload,
  type ContentType as ValidationContentType,
  type MediaType as ValidationMediaType,
} from '@postolio/content-validation';
import { getDatabaseClient } from '../config/database.js';
import { resolvePrimarySocialAccount } from './social-account-resolver.js';
import { haveUniformAspectRatio } from '../utils/aspect-ratio.js';
import { toSchedulerPlatform, toValidationPlatform } from '../utils/platform.js';
import {
  deriveScheduleMediaType,
  isDisconnected,
  normalizeContentType,
  resolveStructuredMediaAssets,
  type StructuredMediaAsset,
} from './scheduler-adapter-shared.js';

const prisma = getDatabaseClient();

type ActionVariant = 'schedule' | 'publish' | 'reschedule' | 'update';

type ContentForPayload = {
  brandId: string;
  contentType?: string | null;
  caption?: string | null;
  firstComment?: string | null;
  hashtags?: string[] | null;
  shareToFeed?: boolean | null;
  thumbOffset?: number | null;
  targetSocialAccountId?: string | null;
  mediaAssets: Array<{ assetId: string; displayOrder: number | null }>;
};

export type PreparedSchedulingPayload = {
  destinationPlatform: string;
  schedulerPlatform: NonNullable<ReturnType<typeof toSchedulerPlatform>>;
  validationPlatform: NonNullable<ReturnType<typeof toValidationPlatform>>;
  socialAccountId: string;
  normalizedContentType: ValidationContentType;
  normalizedMediaType?: ValidationMediaType;
  structuredMediaAssets: StructuredMediaAsset[];
};

type DestinationResult =
  | { ok: true; destinationPlatform: string; socialAccountId: string }
  | { ok: false; error: string };

type PayloadResult = { ok: true; data: PreparedSchedulingPayload } | { ok: false; error: string };

function preferredSocialAccountId(content: ContentForPayload): string | null {
  if (typeof content.targetSocialAccountId !== 'string') {
    return null;
  }
  const id = content.targetSocialAccountId.trim();
  return id.length > 0 ? id : null;
}

function accountMissingMessage(platform: string, action: ActionVariant): string {
  const prefix =
    platform === 'facebook'
      ? 'No Facebook Page is connected for this brand.'
      : 'No Instagram account is connected for this brand.';
  if (action === 'schedule') {
    return `${prefix} Connect an ${platform === 'facebook' ? 'Facebook Page' : 'Instagram account'} before scheduling.`;
  }
  if (action === 'publish') {
    return `${prefix} Connect an ${platform === 'facebook' ? 'Facebook Page' : 'Instagram account'} before publishing.`;
  }
  if (action === 'reschedule') {
    return `${prefix} Connect an ${platform === 'facebook' ? 'Facebook Page' : 'Instagram account'} before rescheduling.`;
  }
  return `${prefix} Connect an ${platform === 'facebook' ? 'Facebook Page' : 'Instagram account'} before updating the schedule.`;
}

async function resolveDestination(
  content: ContentForPayload,
  action: ActionVariant
): Promise<DestinationResult> {
  const preferredId = preferredSocialAccountId(content);
  if (preferredId) {
    const account = await prisma.socialAccount.findFirst({
      where: { id: preferredId, brandId: content.brandId },
      select: { id: true, platform: true, metadata: true },
    });
    if (!account || isDisconnected(account.metadata)) {
      return {
        ok: false,
        error:
          'Selected destination account is no longer connected. Choose a different destination and try again.',
      };
    }
    return {
      ok: true,
      destinationPlatform: String(account.platform),
      socialAccountId: account.id,
    };
  }

  const primary = await resolvePrimarySocialAccount(content.brandId, 'instagram');
  const destinationPlatform = primary?.platform ?? 'instagram';
  const socialAccountId = primary?.id ?? null;
  if (!socialAccountId) {
    return { ok: false, error: accountMissingMessage(destinationPlatform, action) };
  }
  return { ok: true, destinationPlatform, socialAccountId };
}

function unsupportedPlatformMessage(destinationPlatform: string): string {
  return `Scheduling is not supported for platform: ${destinationPlatform}`;
}

function unsupportedValidationMessage(destinationPlatform: string): string {
  return `Content validation is not supported for platform: ${destinationPlatform}`;
}

function missingMediaMessage(action: ActionVariant): string {
  if (action === 'publish') {
    return 'Missing media assets for publishing. Please attach media and try again.';
  }
  if (action === 'schedule') {
    return 'Missing media assets for scheduling. Please attach media and try again.';
  }
  return 'Missing media assets. Please attach media and try again.';
}

function aspectRatioMessage(action: ActionVariant): string {
  if (action === 'publish') {
    return 'All carousel items must have the same aspect ratio before publishing. Please crop or resize your media so they match.';
  }
  if (action === 'schedule') {
    return 'All carousel items must have the same aspect ratio before scheduling. Please crop or resize your media so they match.';
  }
  if (action === 'reschedule') {
    return 'All carousel items must have the same aspect ratio before rescheduling. Please crop or resize your media so they match.';
  }
  return 'All carousel items must have the same aspect ratio before updating the schedule. Please crop or resize your media so they match.';
}

function facebookMixedMediaMessage(action: ActionVariant): string {
  if (action === 'publish') {
    return 'Facebook posts cannot mix images and videos in the same published post.';
  }
  if (action === 'schedule') {
    return 'Facebook posts cannot mix images and videos in the same scheduled post.';
  }
  return 'Facebook posts cannot mix images and videos in the same post.';
}

function normalizeTypeForPlatform(
  contentType: string | null | undefined,
  validationPlatform: NonNullable<ReturnType<typeof toValidationPlatform>>
): ValidationContentType {
  if (validationPlatform !== 'instagram') {
    return 'post';
  }
  return normalizeContentType(contentType);
}

function validatePayload(params: {
  platform: NonNullable<ReturnType<typeof toValidationPlatform>>;
  normalizedContentType: ValidationContentType;
  normalizedMediaType?: ValidationMediaType;
  caption: string;
  structuredMediaAssets: StructuredMediaAsset[];
}): string | null {
  const validation = validateContentPayload({
    platform: params.platform,
    contentType: params.normalizedContentType,
    ...(params.normalizedMediaType ? { mediaType: params.normalizedMediaType } : {}),
    caption: params.normalizedContentType === 'story' ? '' : params.caption,
    ...(params.structuredMediaAssets.length > 0
      ? {
          mediaAssets: params.structuredMediaAssets.map((asset) => ({
            key: asset.key,
            type: asset.type,
          })),
        }
      : {}),
  });
  return validation.ok ? null : validation.errors[0]?.message || 'Invalid content payload';
}

function normalizeMediaType(params: {
  validationPlatform: NonNullable<ReturnType<typeof toValidationPlatform>>;
  normalizedContentType: ValidationContentType;
  structuredMediaAssets: StructuredMediaAsset[];
}): ValidationMediaType | undefined {
  if (params.structuredMediaAssets.length === 0) {
    return undefined;
  }
  if (params.validationPlatform === 'instagram') {
    return deriveScheduleMediaType(params.normalizedContentType, params.structuredMediaAssets);
  }
  const hasVideos = params.structuredMediaAssets.some((asset) => asset.type === 'video');
  return hasVideos ? 'video' : 'image';
}

function validateMediaReadiness(params: {
  action: ActionVariant;
  content: ContentForPayload;
  schedulerPlatform: NonNullable<ReturnType<typeof toSchedulerPlatform>>;
  validationPlatform: NonNullable<ReturnType<typeof toValidationPlatform>>;
  missingAssetIds: string[];
  structuredMediaAssets: StructuredMediaAsset[];
}): string | null {
  if (params.missingAssetIds.length > 0) {
    return `Some media assets could not be resolved: ${params.missingAssetIds.join(', ')}`;
  }

  const hasCaptionText = Boolean(
    params.content.caption && params.content.caption.trim().length > 0
  );
  if (
    params.structuredMediaAssets.length === 0 &&
    !(params.validationPlatform === 'facebook' && hasCaptionText)
  ) {
    return missingMediaMessage(params.action);
  }

  const hasImages = params.structuredMediaAssets.some((asset) => asset.type === 'image');
  const hasVideos = params.structuredMediaAssets.some((asset) => asset.type === 'video');
  if (params.validationPlatform === 'facebook' && hasImages && hasVideos) {
    return facebookMixedMediaMessage(params.action);
  }

  if (
    params.schedulerPlatform === 'instagram' &&
    params.structuredMediaAssets.length > 1 &&
    !haveUniformAspectRatio(params.structuredMediaAssets)
  ) {
    return aspectRatioMessage(params.action);
  }

  return null;
}

export async function prepareSchedulingPayload(
  content: ContentForPayload,
  action: ActionVariant,
  enforceValidation: boolean
): Promise<PayloadResult> {
  const destination = await resolveDestination(content, action);
  if (!destination.ok) {
    return destination;
  }

  const schedulerPlatform = toSchedulerPlatform(destination.destinationPlatform);
  if (!schedulerPlatform) {
    return { ok: false, error: unsupportedPlatformMessage(destination.destinationPlatform) };
  }

  const validationPlatform = toValidationPlatform(destination.destinationPlatform);
  if (!validationPlatform) {
    return { ok: false, error: unsupportedValidationMessage(destination.destinationPlatform) };
  }

  const normalizedContentType = normalizeTypeForPlatform(content.contentType, validationPlatform);
  const { missingAssetIds, structuredMediaAssets } = await resolveStructuredMediaAssets(
    content.mediaAssets
  );
  const mediaReadinessError = validateMediaReadiness({
    action,
    content,
    schedulerPlatform,
    validationPlatform,
    missingAssetIds,
    structuredMediaAssets,
  });
  if (mediaReadinessError) {
    return { ok: false, error: mediaReadinessError };
  }

  const normalizedMediaType = normalizeMediaType({
    validationPlatform,
    normalizedContentType,
    structuredMediaAssets,
  });

  if (enforceValidation) {
    const validationError = validatePayload({
      platform: validationPlatform,
      normalizedContentType,
      normalizedMediaType,
      caption: content.caption || '',
      structuredMediaAssets,
    });
    if (validationError) {
      return { ok: false, error: validationError };
    }
  }

  return {
    ok: true,
    data: {
      destinationPlatform: destination.destinationPlatform,
      schedulerPlatform,
      validationPlatform,
      socialAccountId: destination.socialAccountId,
      normalizedContentType,
      normalizedMediaType,
      structuredMediaAssets,
    },
  };
}
