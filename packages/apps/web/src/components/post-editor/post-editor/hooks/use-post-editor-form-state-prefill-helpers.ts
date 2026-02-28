import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { AssetReference } from '@/components/multi-image-uploader/types';
import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import type { InstagramContentType } from '@postolio/content-validation';

import { formatScheduledInput } from '../utils';

export function hasPrefillInput(params: {
  qCaption: string | null;
  qScheduledAt: string | null;
  normalizedTargetSocialAccountIds: string[] | null;
  normalizedContentType: InstagramContentType | null;
  prefillAssetIds: string[];
}): boolean {
  return (
    Boolean(params.qCaption) ||
    Boolean(params.qScheduledAt) ||
    Boolean(params.normalizedTargetSocialAccountIds?.length) ||
    Boolean(params.normalizedContentType) ||
    params.prefillAssetIds.length > 0
  );
}

export function applyBasicPrefill(params: {
  shouldApplyBasic: boolean;
  qCaption: string | null;
  qScheduledAt: string | null;
  normalizedContentType: InstagramContentType | null;
  brandTimezone: string;
  setFormData: Dispatch<SetStateAction<PostEditorFormState>>;
  prefillAppliedRef: MutableRefObject<{ basic: boolean; assets: boolean; platforms: boolean }>;
}) {
  if (!params.shouldApplyBasic) {
    return;
  }

  params.setFormData((prev) => ({
    ...prev,
    caption: params.qCaption ?? prev.caption,
    scheduledAt: params.qScheduledAt
      ? formatScheduledInput(params.qScheduledAt, params.brandTimezone)
      : prev.scheduledAt,
    contentType: params.normalizedContentType ?? prev.contentType,
  }));
  params.prefillAppliedRef.current = { ...params.prefillAppliedRef.current, basic: true };
}

export function applyAssetsPrefill(params: {
  shouldApplyAssets: boolean;
  isPrefillAssetsLoading: boolean;
  prefillAssets: any[] | undefined;
  setFormData: Dispatch<SetStateAction<PostEditorFormState>>;
  prefillAppliedRef: MutableRefObject<{ basic: boolean; assets: boolean; platforms: boolean }>;
}) {
  if (!params.shouldApplyAssets) {
    return true;
  }
  if (params.isPrefillAssetsLoading) {
    return false;
  }

  const nextAssets: AssetReference[] =
    params.prefillAssets
      ?.map((asset) => ({
        id: asset.id,
        url: asset.url,
        type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
      }))
      ?.slice(0, 10) ?? [];

  if (nextAssets.length > 0) {
    params.setFormData((prev) => ({ ...prev, carouselAssets: nextAssets }));
  }
  params.prefillAppliedRef.current = { ...params.prefillAppliedRef.current, assets: true };
  return true;
}

export function applyPlatformsPrefill(params: {
  shouldApplyPlatforms: boolean;
  normalizedTargetSocialAccountIds: string[] | null;
  platformPickerOptions: SocialAccountsPickerOption[];
  multiDestinationEnabled: boolean;
  setSelectedPlatformAccountIds: (ids: string[]) => void;
  platformsInitializedRef: MutableRefObject<boolean>;
  prefillAppliedRef: MutableRefObject<{ basic: boolean; assets: boolean; platforms: boolean }>;
}) {
  if (!params.shouldApplyPlatforms) {
    return;
  }
  if (params.platformPickerOptions.length === 0) {
    return;
  }

  const allowed = new Set(params.platformPickerOptions.map((option) => option.id));
  const next = (params.normalizedTargetSocialAccountIds ?? []).filter((value) =>
    allowed.has(value)
  );
  const normalized = !params.multiDestinationEnabled && next.length > 1 ? [next[0]!] : next;
  if (normalized.length > 0) {
    params.setSelectedPlatformAccountIds(normalized);
    params.platformsInitializedRef.current = true;
  }
  params.prefillAppliedRef.current = { ...params.prefillAppliedRef.current, platforms: true };
}
