import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { assetsApi } from '@/features/assets/api/client';

import type { AssetReference } from '@/components/multi-image-uploader/types';
import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import { formatScheduledInput, createEmptyPostFormState } from '../utils';
import type { InstagramContentType } from '@postolio/content-validation';

import type { PostDetailData } from '@/hooks/usePostDetail';

export function usePostEditorFormState(params: {
  id?: string;
  post: PostDetailData | undefined;
  brandTimezone: string;
  selectedBrandId: string | null;
  isMultiDestinationGroup: boolean;
  contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
  postAssetIds: string[];
  mediaAssetsById: Record<string, any> | undefined;
  selectedTargetSocialAccountId: string | null;
  platformPickerOptions: SocialAccountsPickerOption[];
  setSelectedPlatformAccountIds: (ids: string[]) => void;
  platformsInitializedRef: MutableRefObject<boolean>;
  locationSearch: string;
}) {
  const {
    brandTimezone,
    contentGroupSchedule,
    id,
    isMultiDestinationGroup,
    locationSearch,
    mediaAssetsById,
    platformPickerOptions,
    platformsInitializedRef,
    post,
    postAssetIds,
    selectedTargetSocialAccountId,
    setSelectedPlatformAccountIds,
  } = params;

  const isCreating = !id;

  const [formData, setFormData] = useState<PostEditorFormState>(() => createEmptyPostFormState());
  const [hasChanges, setHasChanges] = useState(false);
  const formInitializedRef = useRef(false);
  const scheduledAtTouchedRef = useRef(false);

  const [firstCommentOpen, setFirstCommentOpen] = useState(false);

  const handleScheduledAtChange = useCallback((value: string) => {
    scheduledAtTouchedRef.current = true;
    setFormData((state) => ({ ...state, scheduledAt: value }));
  }, []);

  useEffect(() => {
    if (!post || !brandTimezone) return;
    if (postAssetIds.length > 0 && !mediaAssetsById) return;

    const normalizedContentType = (post.contentType as InstagramContentType) || 'post';
    const carouselAssetsFromPost: AssetReference[] = (post.mediaAssets || []).map((entry) => {
      const asset = mediaAssetsById?.[entry.assetId] ?? null;
      const type = asset?.fileType === 'video' ? ('video' as const) : ('image' as const);
      return {
        id: entry.assetId,
        url: asset?.url || '',
        type,
      };
    });

    setFormData({
      caption: post.caption || '',
      carouselAssets: carouselAssetsFromPost,
      contentType: normalizedContentType,
      scheduledAt: formatScheduledInput(post.scheduledAt, brandTimezone),
      shareToFeed: normalizedContentType === 'reel' ? (post.shareToFeed ?? true) : true,
      firstComment: (post as any).firstComment || '',
    });
    setFirstCommentOpen(Boolean((post as any).firstComment));

    const candidate =
      typeof post.targetSocialAccountId === 'string' ? post.targetSocialAccountId.trim() : '';
    setSelectedPlatformAccountIds(candidate ? [candidate] : []);
    platformsInitializedRef.current = true;

    setHasChanges(false);
    formInitializedRef.current = true;
  }, [
    brandTimezone,
    mediaAssetsById,
    post,
    postAssetIds.length,
    platformsInitializedRef,
    setSelectedPlatformAccountIds,
  ]);

  useEffect(() => {
    if (!id || !post || !formInitializedRef.current) {
      if (!id) {
        setHasChanges(false);
      }
      return;
    }

    const trimmedCaption = (formData.caption || '').trim();
    const originalCaption = (post.caption || '').trim();

    const scheduledValue = formData.scheduledAt || '';
    const originalScheduled = isMultiDestinationGroup
      ? contentGroupSchedule.kind === 'uniform'
        ? formatScheduledInput(contentGroupSchedule.scheduledAt, brandTimezone)
        : ''
      : formatScheduledInput(post.scheduledAt, brandTimezone);

    const formCarouselIds = (formData.carouselAssets || []).map((a) => a.id);
    const postCarouselIds = (post.mediaAssets || []).map((asset) => asset.assetId);
    const postContentType = (post.contentType as InstagramContentType) || 'post';
    const formShareToFeed = formData.shareToFeed ?? true;
    const postShareToFeed =
      (postContentType as InstagramContentType | undefined) === 'reel'
        ? (post.shareToFeed ?? true)
        : true;

    const formFirstComment = firstCommentOpen ? (formData.firstComment || '').trim() : '';
    const postFirstComment = ((post as any).firstComment || '').trim();

    const postTargetSocialAccountId =
      typeof post.targetSocialAccountId === 'string' && post.targetSocialAccountId.trim()
        ? post.targetSocialAccountId
        : null;

    const changed =
      trimmedCaption !== originalCaption ||
      scheduledValue !== originalScheduled ||
      JSON.stringify(formCarouselIds) !== JSON.stringify(postCarouselIds) ||
      formData.contentType !== postContentType ||
      formShareToFeed !== postShareToFeed ||
      formFirstComment !== postFirstComment ||
      selectedTargetSocialAccountId !== postTargetSocialAccountId;

    setHasChanges(changed);
  }, [
    brandTimezone,
    contentGroupSchedule.kind,
    contentGroupSchedule.scheduledAt,
    firstCommentOpen,
    formData,
    id,
    isMultiDestinationGroup,
    post,
    selectedTargetSocialAccountId,
  ]);

  useEffect(() => {
    if (!isMultiDestinationGroup || !brandTimezone || !formInitializedRef.current) return;
    if (hasChanges) return;
    const next =
      contentGroupSchedule.kind === 'uniform'
        ? formatScheduledInput(contentGroupSchedule.scheduledAt, brandTimezone)
        : '';
    setFormData((state) => ({ ...state, scheduledAt: next }));
  }, [
    brandTimezone,
    contentGroupSchedule.kind,
    contentGroupSchedule.scheduledAt,
    hasChanges,
    isMultiDestinationGroup,
  ]);

  const searchParams = useMemo(() => new URLSearchParams(locationSearch), [locationSearch]);
  const qCaption = searchParams.get('caption');
  const qScheduledAt = searchParams.get('scheduledAt');
  const qContentType = searchParams.get('contentType');
  const qTargetSocialAccountId = searchParams.get('targetSocialAccountId');
  const qTargetSocialAccountIds = searchParams.get('targetSocialAccountIds');
  const qAssetId = searchParams.get('assetId');
  const qAssetIdsParam = searchParams.get('assetIds');
  const prefillAssetIds = useMemo(() => {
    const ids = new Set<string>();
    if (qAssetId) ids.add(qAssetId);
    if (qAssetIdsParam) {
      qAssetIdsParam
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .forEach((value) => ids.add(value));
    }
    return Array.from(ids);
  }, [qAssetId, qAssetIdsParam]);

  const { data: prefillAssets, isLoading: isPrefillAssetsLoading } = useQuery({
    queryKey: ['prefill-assets', prefillAssetIds.join(',')],
    enabled: isCreating && prefillAssetIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        prefillAssetIds.map(async (assetId) => {
          try {
            const { asset } = await assetsApi.getAsset(assetId);
            return asset;
          } catch {
            return null;
          }
        })
      );
      return results.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
    },
    retry: 0,
  });

  const prefillAppliedRef = useRef<{ basic: boolean; assets: boolean; platforms: boolean }>({
    basic: false,
    assets: false,
    platforms: false,
  });
  const wasCreatingRef = useRef<boolean>(isCreating);

  useEffect(() => {
    const wasCreating = wasCreatingRef.current;
    wasCreatingRef.current = isCreating;
    if (!isCreating) return;
    if (wasCreating) return;
    setFormData(createEmptyPostFormState());
    setHasChanges(false);
    setFirstCommentOpen(false);
    setSelectedPlatformAccountIds([]);
    platformsInitializedRef.current = false;
    formInitializedRef.current = false;
    prefillAppliedRef.current = { basic: false, assets: false, platforms: false };
    scheduledAtTouchedRef.current = false;
  }, [isCreating, platformsInitializedRef, setSelectedPlatformAccountIds]);

  useEffect(() => {
    if (!isCreating) return;
    const normalizedTargetSocialAccountIds = (() => {
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
    })();
    const normalizedContentType =
      qContentType === 'post' || qContentType === 'reel' || qContentType === 'story'
        ? (qContentType as InstagramContentType)
        : null;
    const hasPrefillInput =
      Boolean(qCaption) ||
      Boolean(qScheduledAt) ||
      Boolean(normalizedTargetSocialAccountIds?.length) ||
      Boolean(normalizedContentType) ||
      prefillAssetIds.length > 0;
    if (!hasPrefillInput) {
      return;
    }

    const hasBasicPrefill =
      Boolean(qCaption) || Boolean(qScheduledAt) || Boolean(normalizedContentType);
    const hasAssetPrefill = prefillAssetIds.length > 0;
    const hasPlatformPrefill = Boolean(normalizedTargetSocialAccountIds?.length);

    const prefillState = prefillAppliedRef.current;
    const shouldApplyBasic = hasBasicPrefill && prefillState.basic === false;
    const shouldApplyAssets = hasAssetPrefill && prefillState.assets === false;
    const shouldApplyPlatforms = hasPlatformPrefill && prefillState.platforms === false;

    if (shouldApplyBasic) {
      setFormData((prev) => {
        return {
          ...prev,
          caption: qCaption ?? prev.caption,
          scheduledAt: qScheduledAt
            ? formatScheduledInput(qScheduledAt, brandTimezone)
            : prev.scheduledAt,
          contentType: normalizedContentType ?? prev.contentType,
        };
      });
      prefillAppliedRef.current = { ...prefillAppliedRef.current, basic: true };
    }

    if (shouldApplyAssets) {
      if (isPrefillAssetsLoading) return;
      const normalizedAssets: AssetReference[] =
        prefillAssets?.map((asset) => ({
          id: asset.id,
          url: asset.url,
          type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
        })) ?? [];
      const nextAssets = normalizedAssets.slice(0, 10) as AssetReference[];
      if (nextAssets.length > 0) {
        setFormData((prev) => ({ ...prev, carouselAssets: nextAssets }));
      }
      prefillAppliedRef.current = { ...prefillAppliedRef.current, assets: true };
    }

    if (shouldApplyPlatforms) {
      if (platformPickerOptions.length === 0) return;
      const allowed = new Set(platformPickerOptions.map((opt) => opt.id));
      const next = (normalizedTargetSocialAccountIds ?? []).filter((value) => allowed.has(value));
      if (next.length > 0) {
        setSelectedPlatformAccountIds(next);
        platformsInitializedRef.current = true;
      }
      prefillAppliedRef.current = { ...prefillAppliedRef.current, platforms: true };
    }
  }, [
    brandTimezone,
    isCreating,
    isPrefillAssetsLoading,
    platformPickerOptions,
    prefillAssetIds,
    prefillAssets,
    qCaption,
    qContentType,
    qScheduledAt,
    qTargetSocialAccountId,
    qTargetSocialAccountIds,
    platformsInitializedRef,
    setSelectedPlatformAccountIds,
  ]);

  useEffect(() => {
    if (!isCreating) return;
    if (scheduledAtTouchedRef.current) return;
    const raw = typeof qScheduledAt === 'string' ? qScheduledAt.trim() : '';
    if (!raw) return;
    const next = formatScheduledInput(raw, brandTimezone);
    setFormData((prev) => (prev.scheduledAt === next ? prev : { ...prev, scheduledAt: next }));
  }, [brandTimezone, isCreating, qScheduledAt]);

  const hasScheduleTime = Boolean(formData.scheduledAt);

  return {
    formData,
    setFormData,
    hasChanges,
    setHasChanges,
    formInitializedRef,
    scheduledAtTouchedRef,
    hasScheduleTime,
    firstCommentOpen,
    setFirstCommentOpen,
    handleScheduledAtChange,
  };
}
