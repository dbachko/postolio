import { useCallback, useRef, useState } from 'react';

import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';

import { createEmptyPostFormState } from '../utils';
import { usePostEditorFormInitialization } from './use-post-editor-form-state-initialization';
import { usePostEditorFormPrefill } from './use-post-editor-form-state-prefill';
import type { PostEditorFormStateParams } from './use-post-editor-form-state-types';

export function usePostEditorFormState(params: PostEditorFormStateParams) {
  const [formData, setFormData] = useState<PostEditorFormState>(() => createEmptyPostFormState());
  const [hasChanges, setHasChanges] = useState(false);
  const [firstCommentOpen, setFirstCommentOpen] = useState(false);

  const formInitializedRef = useRef(false);
  const scheduledAtTouchedRef = useRef(false);

  const handleScheduledAtChange = useCallback((value: string) => {
    scheduledAtTouchedRef.current = true;
    setFormData((state) => ({ ...state, scheduledAt: value }));
  }, []);

  usePostEditorFormInitialization({
    id: params.id,
    post: params.post,
    brandTimezone: params.brandTimezone,
    postAssetIds: params.postAssetIds,
    mediaAssetsById: params.mediaAssetsById,
    multiDestinationEnabled: params.multiDestinationEnabled,
    platformPickerOptions: params.platformPickerOptions,
    setSelectedPlatformAccountIds: params.setSelectedPlatformAccountIds,
    platformsInitializedRef: params.platformsInitializedRef,
    formData,
    hasChanges,
    firstCommentOpen,
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    contentGroupSchedule: params.contentGroupSchedule,
    selectedTargetSocialAccountId: params.selectedTargetSocialAccountId,
    setFormData,
    setHasChanges,
    setFirstCommentOpen,
    formInitializedRef,
  });

  usePostEditorFormPrefill({
    id: params.id,
    locationSearch: params.locationSearch,
    brandTimezone: params.brandTimezone,
    multiDestinationEnabled: params.multiDestinationEnabled,
    platformPickerOptions: params.platformPickerOptions,
    setFormData,
    setHasChanges,
    setFirstCommentOpen,
    setSelectedPlatformAccountIds: params.setSelectedPlatformAccountIds,
    platformsInitializedRef: params.platformsInitializedRef,
    formInitializedRef,
    scheduledAtTouchedRef,
  });

  return {
    formData,
    setFormData,
    hasChanges,
    setHasChanges,
    formInitializedRef,
    scheduledAtTouchedRef,
    hasScheduleTime: Boolean(formData.scheduledAt),
    firstCommentOpen,
    setFirstCommentOpen,
    handleScheduledAtChange,
  };
}
