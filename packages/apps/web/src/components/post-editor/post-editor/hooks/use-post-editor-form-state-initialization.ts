import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';
import type { PostDetailData } from '@/hooks/usePostDetail';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import type { InstagramContentType } from '@postolio/content-validation';

import { formatScheduledInput } from '../utils';
import {
  getInitialSelectedPlatformIds,
  hasPostEditorFormChanges,
  mapPostCarouselAssets,
} from './use-post-editor-form-state-helpers';

type CommonStateParams = {
  setFormData: Dispatch<SetStateAction<PostEditorFormState>>;
  setHasChanges: Dispatch<SetStateAction<boolean>>;
  setFirstCommentOpen: Dispatch<SetStateAction<boolean>>;
  formInitializedRef: MutableRefObject<boolean>;
};

function useInitializePostEditorFormFromPost(
  params: {
    post: PostDetailData | undefined;
    brandTimezone: string;
    postAssetIds: string[];
    mediaAssetsById: Record<string, any> | undefined;
    multiDestinationEnabled: boolean;
    platformPickerOptions: SocialAccountsPickerOption[];
    setSelectedPlatformAccountIds: (ids: string[]) => void;
    platformsInitializedRef: MutableRefObject<boolean>;
  } & CommonStateParams
) {
  const {
    post,
    brandTimezone,
    postAssetIds,
    mediaAssetsById,
    multiDestinationEnabled,
    platformPickerOptions,
    setSelectedPlatformAccountIds,
    platformsInitializedRef,
    setFormData,
    setHasChanges,
    setFirstCommentOpen,
    formInitializedRef,
  } = params;

  useEffect(() => {
    if (!post || !brandTimezone) {
      return;
    }
    if (postAssetIds.length > 0 && !mediaAssetsById) {
      return;
    }

    const normalizedContentType = (post.contentType as InstagramContentType) || 'post';
    const carouselAssets = mapPostCarouselAssets({
      post,
      mediaAssetsById,
    });

    setFormData({
      caption: post.caption || '',
      carouselAssets,
      contentType: normalizedContentType,
      scheduledAt: formatScheduledInput(post.scheduledAt, brandTimezone),
      shareToFeed: normalizedContentType === 'reel' ? (post.shareToFeed ?? true) : true,
      firstComment: (post as any).firstComment || '',
    });
    setFirstCommentOpen(Boolean((post as any).firstComment));
    setSelectedPlatformAccountIds(
      getInitialSelectedPlatformIds({
        post,
        multiDestinationEnabled,
        platformPickerOptions,
      })
    );
    platformsInitializedRef.current = true;
    setHasChanges(false);
    formInitializedRef.current = true;
  }, [
    brandTimezone,
    formInitializedRef,
    mediaAssetsById,
    multiDestinationEnabled,
    platformPickerOptions,
    platformsInitializedRef,
    post,
    postAssetIds.length,
    setFirstCommentOpen,
    setFormData,
    setHasChanges,
    setSelectedPlatformAccountIds,
  ]);
}

function useTrackPostEditorFormChanges(
  params: {
    id?: string;
    post: PostDetailData | undefined;
    brandTimezone: string;
    formData: PostEditorFormState;
    firstCommentOpen: boolean;
    isMultiDestinationGroup: boolean;
    contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
    selectedTargetSocialAccountId: string | null;
    multiDestinationEnabled: boolean;
  } & Pick<CommonStateParams, 'setHasChanges' | 'formInitializedRef'>
) {
  const {
    id,
    post,
    brandTimezone,
    formData,
    firstCommentOpen,
    isMultiDestinationGroup,
    contentGroupSchedule,
    selectedTargetSocialAccountId,
    multiDestinationEnabled,
    setHasChanges,
    formInitializedRef,
  } = params;

  useEffect(() => {
    if (!id || !post || !formInitializedRef.current) {
      if (!id) {
        setHasChanges(false);
      }
      return;
    }

    setHasChanges(
      hasPostEditorFormChanges({
        post,
        brandTimezone,
        formData,
        firstCommentOpen,
        isMultiDestinationGroup,
        contentGroupSchedule,
        selectedTargetSocialAccountId,
        multiDestinationEnabled,
      })
    );
  }, [
    brandTimezone,
    contentGroupSchedule,
    firstCommentOpen,
    formData,
    formInitializedRef,
    id,
    isMultiDestinationGroup,
    multiDestinationEnabled,
    post,
    selectedTargetSocialAccountId,
    setHasChanges,
  ]);
}

function useSyncGroupScheduledAt(
  params: {
    brandTimezone: string;
    isMultiDestinationGroup: boolean;
    hasChanges: boolean;
    contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
  } & Pick<CommonStateParams, 'formInitializedRef' | 'setFormData'>
) {
  const {
    brandTimezone,
    isMultiDestinationGroup,
    hasChanges,
    contentGroupSchedule,
    formInitializedRef,
    setFormData,
  } = params;

  useEffect(() => {
    if (!isMultiDestinationGroup || !brandTimezone || !formInitializedRef.current) {
      return;
    }
    if (hasChanges) {
      return;
    }

    const next =
      contentGroupSchedule.kind === 'uniform'
        ? formatScheduledInput(contentGroupSchedule.scheduledAt, brandTimezone)
        : '';
    setFormData((state) => ({ ...state, scheduledAt: next }));
  }, [
    brandTimezone,
    contentGroupSchedule.kind,
    contentGroupSchedule.scheduledAt,
    formInitializedRef,
    hasChanges,
    isMultiDestinationGroup,
    setFormData,
  ]);
}

export function usePostEditorFormInitialization(
  params: {
    id?: string;
    post: PostDetailData | undefined;
    brandTimezone: string;
    postAssetIds: string[];
    mediaAssetsById: Record<string, any> | undefined;
    multiDestinationEnabled: boolean;
    platformPickerOptions: SocialAccountsPickerOption[];
    setSelectedPlatformAccountIds: (ids: string[]) => void;
    platformsInitializedRef: MutableRefObject<boolean>;
    formData: PostEditorFormState;
    hasChanges: boolean;
    firstCommentOpen: boolean;
    isMultiDestinationGroup: boolean;
    contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
    selectedTargetSocialAccountId: string | null;
  } & CommonStateParams
) {
  useInitializePostEditorFormFromPost(params);
  useTrackPostEditorFormChanges(params);
  useSyncGroupScheduledAt(params);
}
