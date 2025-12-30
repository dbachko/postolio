import { formatInTimeZone } from 'date-fns-tz';

import type { AssetReference } from '@/components/multi-image-uploader/types';
import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';
import type { ContentGroupTemplateFormState } from '@/components/post-editor/content-group-template-editor/types';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import type { PostPreviewAccount, PreviewMedia } from '@/components/post-preview/types';

import { getUserTimezone } from '@/lib/timezone';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';

import type {
  InstagramContentType,
  InstagramMediaType,
  Platform as ValidationPlatform,
} from '@postolio/content-validation';

export function toValidationPlatform(platform: Platform): ValidationPlatform | null {
  if (platform === 'x') return 'twitter';
  if (platform === 'tiktok') return null;
  return platform;
}

export function getScheduleBlockerMessage(params: {
  atCapacity: boolean;
  limitMessage: string;
  validationOk: boolean;
  validationError: string | null;
  hasScheduleTime: boolean;
  pausedCampaign: boolean;
  hasSelectedPlatforms: boolean;
  schedulingSupported: boolean;
}): string | null {
  const {
    atCapacity,
    limitMessage,
    validationOk,
    validationError,
    hasScheduleTime,
    pausedCampaign,
    hasSelectedPlatforms,
    schedulingSupported,
  } = params;
  if (!hasSelectedPlatforms) {
    return 'Select at least one social account before continuing.';
  }
  if (!schedulingSupported) {
    return 'Scheduling is not available for one or more selected destinations. Save as a draft instead.';
  }
  if (pausedCampaign) {
    return 'This campaign is paused. Resume it before scheduling new posts.';
  }
  if (atCapacity) return limitMessage || 'You have reached your scheduling limit.';
  if (!validationOk) return validationError || 'Please fix validation errors before continuing.';
  if (!hasScheduleTime) return 'Pick a time before scheduling.';
  return null;
}

export function createEmptyPostFormState(): PostEditorFormState {
  return {
    caption: '',
    carouselAssets: [],
    contentType: 'post',
    scheduledAt: '',
    shareToFeed: true,
    firstComment: '',
  };
}

export function createEmptyTemplateFormState(): ContentGroupTemplateFormState {
  return {
    caption: '',
    carouselAssets: [],
    contentType: 'post',
    shareToFeed: true,
    firstComment: '',
  };
}

export function formatScheduledInput(value?: string | null, timezone?: string) {
  if (!value) return '';
  const effectiveTimezone = timezone || getUserTimezone();
  return formatInTimeZone(new Date(value), effectiveTimezone, "yyyy-MM-dd'T'HH:mm");
}

export function deriveMediaTypeFromAssets(
  assets: AssetReference[],
  contentType: InstagramContentType
): InstagramMediaType {
  if (contentType === 'reel') return 'video';
  if (assets.length > 1) return 'image';
  if (assets.length === 1) {
    return assets[0]?.type === 'video' ? 'video' : 'image';
  }
  return 'image';
}

export function mergeUniqueAssets(items: AssetReference[], limit: number): AssetReference[] {
  const seen = new Set<string>();
  const result: AssetReference[] = [];
  for (const item of items) {
    const key = item.id || item.url;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

export function getScheduleErrorMessage(
  error: unknown,
  fallback: string = 'Failed to schedule post. Please try again.'
): string {
  const normalized = error as any;
  if (
    normalized?.data?.errors &&
    Array.isArray(normalized.data.errors) &&
    normalized.data.errors[0]
  ) {
    return normalized.data.errors[0];
  }
  if (typeof normalized?.data?.message === 'string' && normalized.data.message) {
    return normalized.data.message;
  }
  if (normalized?.data?.error) return normalized.data.error;
  if (typeof normalized?.message === 'string' && normalized.message) return normalized.message;
  return fallback;
}

export function getQueueErrorMessage(
  error: unknown,
  fallback: string = 'Failed to add to queue. Please try again.'
): string {
  const normalized = error as any;
  const code =
    (typeof normalized === 'string' && normalized) ||
    (typeof normalized?.data?.error === 'string' && normalized.data.error) ||
    (typeof normalized?.message === 'string' && normalized.message) ||
    null;

  if (code === 'queue_depth_limit') {
    const maxAllowed = normalized?.data?.maxAllowed;
    if (typeof maxAllowed === 'number' && Number.isFinite(maxAllowed)) {
      return `Queue limit reached for this social account (max ${maxAllowed}).`;
    }
    return 'Queue limit reached for this social account.';
  }

  if (code === 'missing_destination') {
    return 'Pick a destination social account before adding to queue.';
  }

  if (code === 'missing_queue') {
    return 'No default queue found for this social account.';
  }

  return getScheduleErrorMessage(error, fallback);
}

export function normalizePreviewContentType(value: unknown): InstagramContentType {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'post' || normalized === 'reel' || normalized === 'story') {
    return normalized as InstagramContentType;
  }
  return 'post';
}

export function mapAssetReferencesToPreviewMedia(assets: AssetReference[]): PreviewMedia[] {
  return assets
    .filter((asset) => typeof asset?.url === 'string' && asset.url.trim().length > 0)
    .map((asset) => ({
      url: asset.url,
      type: asset.type === 'video' ? 'video' : 'image',
    }));
}

export function toPreviewAccountFromOption(option: SocialAccountsPickerOption): PostPreviewAccount {
  const platformConfig = getPlatformConfig(option.platform);
  const label = option.label?.trim() || platformConfig.displayName;
  const avatarName = option.avatarName?.trim() || label || platformConfig.displayName;
  return {
    id: option.id,
    platform: option.platform,
    label,
    avatarName,
    avatarUrl: option.avatarUrl ?? null,
    disconnected: option.disabled === true,
  };
}
