import type { AssetReference } from '@/components/multi-image-uploader/types';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';
import type { PostDetailData } from '@/hooks/usePostDetail';
import type { InstagramContentType } from '@postolio/content-validation';

import { formatScheduledInput } from '../utils';

export function mapPostCarouselAssets(params: {
  post: PostDetailData;
  mediaAssetsById: Record<string, any> | undefined;
}): AssetReference[] {
  return (params.post.mediaAssets || []).map((entry) => {
    const asset = params.mediaAssetsById?.[entry.assetId] ?? null;
    const type = asset?.fileType === 'video' ? ('video' as const) : ('image' as const);
    return {
      id: entry.assetId,
      url: asset?.url || '',
      type,
    };
  });
}

export function getInitialSelectedPlatformIds(params: {
  post: PostDetailData;
  multiDestinationEnabled: boolean;
  platformPickerOptions: SocialAccountsPickerOption[];
}): string[] {
  const candidate =
    typeof params.post.targetSocialAccountId === 'string'
      ? params.post.targetSocialAccountId.trim()
      : '';
  if (candidate) {
    return [candidate];
  }

  const fallbackTargetId = !params.multiDestinationEnabled
    ? params.platformPickerOptions[0]?.id || ''
    : '';
  if (fallbackTargetId) {
    return [fallbackTargetId];
  }
  return [];
}

function getOriginalScheduledForFormChanges(params: {
  post: PostDetailData;
  brandTimezone: string;
  isMultiDestinationGroup: boolean;
  contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
}) {
  if (!params.isMultiDestinationGroup) {
    return formatScheduledInput(params.post.scheduledAt, params.brandTimezone);
  }
  if (params.contentGroupSchedule.kind === 'uniform') {
    return formatScheduledInput(params.contentGroupSchedule.scheduledAt, params.brandTimezone);
  }
  return '';
}

function hasCarouselChanged(formData: PostEditorFormState, post: PostDetailData): boolean {
  const formCarouselIds = (formData.carouselAssets || []).map((asset) => asset.id);
  const postCarouselIds = (post.mediaAssets || []).map((asset) => asset.assetId);
  return JSON.stringify(formCarouselIds) !== JSON.stringify(postCarouselIds);
}

function resolvePostShareToFeed(
  post: PostDetailData,
  postContentType: InstagramContentType
): boolean {
  if (postContentType !== 'reel') {
    return true;
  }
  return post.shareToFeed ?? true;
}

function hasDestinationChanged(params: {
  selectedTargetSocialAccountId: string | null;
  post: PostDetailData;
  multiDestinationEnabled: boolean;
}) {
  const postTargetSocialAccountId =
    typeof params.post.targetSocialAccountId === 'string' &&
    params.post.targetSocialAccountId.trim()
      ? params.post.targetSocialAccountId
      : null;

  if (params.selectedTargetSocialAccountId === postTargetSocialAccountId) {
    return false;
  }
  if (params.multiDestinationEnabled || postTargetSocialAccountId) {
    return true;
  }
  return !(
    typeof params.selectedTargetSocialAccountId === 'string' &&
    params.selectedTargetSocialAccountId.trim().length > 0
  );
}

export function hasPostEditorFormChanges(params: {
  post: PostDetailData;
  brandTimezone: string;
  formData: PostEditorFormState;
  firstCommentOpen: boolean;
  isMultiDestinationGroup: boolean;
  contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
  selectedTargetSocialAccountId: string | null;
  multiDestinationEnabled: boolean;
}): boolean {
  const trimmedCaption = (params.formData.caption || '').trim();
  const originalCaption = (params.post.caption || '').trim();

  const scheduledValue = params.formData.scheduledAt || '';
  const originalScheduled = getOriginalScheduledForFormChanges({
    post: params.post,
    brandTimezone: params.brandTimezone,
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    contentGroupSchedule: params.contentGroupSchedule,
  });
  const postContentType = (params.post.contentType as InstagramContentType) || 'post';
  const formShareToFeed = params.formData.shareToFeed ?? true;
  const postShareToFeed = resolvePostShareToFeed(params.post, postContentType);

  const formFirstComment = params.firstCommentOpen
    ? (params.formData.firstComment || '').trim()
    : '';
  const postFirstComment = ((params.post as any).firstComment || '').trim();
  const destinationChanged = hasDestinationChanged({
    selectedTargetSocialAccountId: params.selectedTargetSocialAccountId,
    post: params.post,
    multiDestinationEnabled: params.multiDestinationEnabled,
  });

  return (
    trimmedCaption !== originalCaption ||
    scheduledValue !== originalScheduled ||
    hasCarouselChanged(params.formData, params.post) ||
    params.formData.contentType !== postContentType ||
    formShareToFeed !== postShareToFeed ||
    formFirstComment !== postFirstComment ||
    destinationChanged
  );
}

export function parsePrefillAssetIds(
  qAssetId: string | null,
  qAssetIdsParam: string | null
): string[] {
  const ids = new Set<string>();
  if (qAssetId) {
    ids.add(qAssetId);
  }
  if (!qAssetIdsParam) {
    return Array.from(ids);
  }

  qAssetIdsParam
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => ids.add(value));

  return Array.from(ids);
}

export function parseTargetSocialAccountIds(
  qTargetSocialAccountIds: string | null,
  qTargetSocialAccountId: string | null
): string[] | null {
  const raw = typeof qTargetSocialAccountIds === 'string' ? qTargetSocialAccountIds.trim() : '';
  if (raw) {
    const ids = raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const unique = Array.from(new Set(ids));
    return unique.length > 0 ? unique : null;
  }

  const single =
    typeof qTargetSocialAccountId === 'string' && qTargetSocialAccountId.trim().length > 0
      ? qTargetSocialAccountId.trim()
      : null;
  return single ? [single] : null;
}

export function parsePrefillContentType(qContentType: string | null): InstagramContentType | null {
  return qContentType === 'post' || qContentType === 'reel' || qContentType === 'story'
    ? (qContentType as InstagramContentType)
    : null;
}
