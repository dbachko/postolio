import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';

import type { PostEditorLayout } from '../types';
import type { InstagramContentType } from '@postolio/content-validation';
import type { ContentGroupTemplateFormState } from '@/components/post-editor/content-group-template-editor/types';

export function usePostEditorDestinationActions(params: {
  id?: string;
  layout: PostEditorLayout;
  disabled: boolean;
  hasChanges: boolean;
  isMultiDestinationGroup: boolean;
  contentGroupId: string | null;
  groupDestinationSocialAccountIds: Set<string>;
  groupHasPublishedDestinations: boolean;
  isSaving: boolean;
  isAddingDestination: boolean;
  isResettingDestination: boolean;
  isTemplateTab: boolean;
  setIsTemplateTab: (value: boolean) => void;
  templateHasChanges: boolean;
  templateValidationOk: boolean;
  templateValidationError: string | null;
  templateFormData: ContentGroupTemplateFormState;
  templateFirstCommentOpen: boolean;
  saveTemplateAsync: (payload: {
    caption: string;
    contentType: InstagramContentType;
    shareToFeed?: boolean | null;
    firstComment?: string | null;
    thumbOffset?: number | null;
    assetIds?: string[];
  }) => Promise<unknown>;
  applyTemplateAsync: () => Promise<unknown>;
  resetDestinationAsync: () => Promise<unknown>;
  addGroupDestinationsAsync: (payload: { targetSocialAccountId: string }) => Promise<unknown>;
  addContentDestinationsAsync: (payload: { targetSocialAccountId: string }) => Promise<unknown>;
  isAddingContentDestination: boolean;
  selectedTargetSocialAccountId: string | null;
  openSidebar: (type: string, params: Record<string, unknown>) => void;
  navigate: (to: string) => void;
  handleSaveChanges: () => Promise<boolean>;
  multiDestinationEnabled: boolean;
}) {
  const {
    addContentDestinationsAsync,
    addGroupDestinationsAsync,
    applyTemplateAsync,
    contentGroupId,
    disabled,
    groupDestinationSocialAccountIds,
    groupHasPublishedDestinations,
    handleSaveChanges,
    hasChanges,
    id,
    isAddingContentDestination,
    isAddingDestination,
    isMultiDestinationGroup,
    isResettingDestination,
    isSaving,
    isTemplateTab,
    layout,
    navigate,
    openSidebar,
    resetDestinationAsync,
    saveTemplateAsync,
    selectedTargetSocialAccountId,
    setIsTemplateTab,
    templateFirstCommentOpen,
    templateFormData,
    templateHasChanges,
    templateValidationError,
    templateValidationOk,
    multiDestinationEnabled,
  } = params;

  const handleDestinationSwitch = useCallback(
    async (nextContentId: string) => {
      if (!nextContentId || nextContentId === id) {
        return;
      }

      if (!disabled && hasChanges) {
        const ok = await handleSaveChanges();
        if (!ok) {
          return;
        }
      }

      if (layout === 'sidebar') {
        openSidebar('post', { id: nextContentId });
        return;
      }

      navigate(`/posts/${nextContentId}`);
    },
    [disabled, handleSaveChanges, hasChanges, id, layout, navigate, openSidebar]
  );

  const handleGroupTabChange = useCallback(
    async (value: string) => {
      if (!isMultiDestinationGroup || !id) {
        return;
      }

      if (value === 'template') {
        if (!disabled && hasChanges) {
          const ok = await handleSaveChanges();
          if (!ok) {
            return;
          }
        }
        setIsTemplateTab(true);
        return;
      }

      setIsTemplateTab(false);
      await handleDestinationSwitch(value);
    },
    [
      disabled,
      handleDestinationSwitch,
      handleSaveChanges,
      hasChanges,
      id,
      isMultiDestinationGroup,
      setIsTemplateTab,
    ]
  );

  const buildTemplatePayload = useCallback(() => {
    const isStory = templateFormData.contentType === 'story';
    const caption = isStory ? '' : (templateFormData.caption || '').trim();
    const firstComment =
      isStory || !templateFirstCommentOpen || !templateFormData.firstComment?.trim()
        ? null
        : templateFormData.firstComment.trim();
    const shareToFeed =
      templateFormData.contentType === 'reel' ? templateFormData.shareToFeed : null;
    const assetIds = (templateFormData.carouselAssets || [])
      .map((asset) => asset.id)
      .filter(
        (assetId): assetId is string => typeof assetId === 'string' && assetId.trim().length > 0
      )
      .map((assetId) => assetId.trim());

    return {
      caption,
      contentType: templateFormData.contentType,
      shareToFeed,
      firstComment,
      assetIds,
    };
  }, [templateFirstCommentOpen, templateFormData]);

  const handleSaveTemplate = useCallback(async (): Promise<boolean> => {
    if (!contentGroupId) {
      return false;
    }
    try {
      await saveTemplateAsync(buildTemplatePayload());
      return true;
    } catch {
      return false;
    }
  }, [buildTemplatePayload, contentGroupId, saveTemplateAsync]);

  const handleApplyTemplate = useCallback(async () => {
    if (!contentGroupId) {
      return;
    }
    if (templateHasChanges) {
      const ok = await handleSaveTemplate();
      if (!ok) {
        return;
      }
    }
    await applyTemplateAsync();
  }, [applyTemplateAsync, contentGroupId, handleSaveTemplate, templateHasChanges]);

  const handleResetDestinationToTemplate = useCallback(async () => {
    if (!contentGroupId || !id) {
      return;
    }
    if (!disabled && hasChanges) {
      const ok = window.confirm(
        'You have unsaved changes for this destination. Resetting will discard them. Continue?'
      );
      if (!ok) {
        return;
      }
    }
    await resetDestinationAsync();
  }, [contentGroupId, disabled, hasChanges, id, resetDestinationAsync]);

  const handleAddDestinationToGroup = useCallback(
    async (targetSocialAccountId: string) => {
      if (!multiDestinationEnabled) {
        return;
      }
      if (!isMultiDestinationGroup || !contentGroupId) {
        return;
      }
      const normalized = (targetSocialAccountId || '').trim();
      if (!normalized || groupDestinationSocialAccountIds.has(normalized)) {
        return;
      }
      if (
        disabled ||
        groupHasPublishedDestinations ||
        isSaving ||
        isAddingDestination ||
        isResettingDestination
      ) {
        return;
      }

      if (isTemplateTab && templateHasChanges) {
        if (!templateValidationOk) {
          toast.error(
            templateValidationError || 'Complete required fields before adding a new destination.'
          );
          return;
        }
        const ok = await handleSaveTemplate();
        if (!ok) {
          return;
        }
      }

      if (!isTemplateTab && hasChanges) {
        const ok = await handleSaveChanges();
        if (!ok) {
          return;
        }
      }

      try {
        const response: any = await addGroupDestinationsAsync({
          targetSocialAccountId: normalized,
        });
        const added = Array.isArray(response?.added) ? response.added : [];
        const createdContentId =
          added.find((entry: any) => entry?.targetSocialAccountId === normalized)?.contentId ||
          added[0]?.contentId ||
          null;

        toast.success('Destination added');

        const scheduling = response?.scheduling;
        const results = Array.isArray(scheduling?.results) ? scheduling.results : [];
        const failed = results.find((r: any) => r?.ok === false);
        if (failed) {
          const errorMessage =
            typeof failed?.error?.message === 'string'
              ? failed.error.message
              : typeof failed?.error?.error === 'string'
                ? failed.error.error
                : 'Scheduling failed for the new destination.';
          toast.error(errorMessage);
        }

        if (createdContentId) {
          setIsTemplateTab(false);
          await handleDestinationSwitch(createdContentId);
        }
      } catch (error: any) {
        const message =
          typeof error?.data?.message === 'string'
            ? error.data.message
            : typeof error?.data?.error === 'string'
              ? error.data.error
              : typeof error?.message === 'string'
                ? error.message
                : 'Failed to add destination';
        toast.error(message);
      }
    },
    [
      addGroupDestinationsAsync,
      contentGroupId,
      disabled,
      groupHasPublishedDestinations,
      groupDestinationSocialAccountIds,
      handleDestinationSwitch,
      handleSaveChanges,
      handleSaveTemplate,
      hasChanges,
      isAddingDestination,
      isMultiDestinationGroup,
      isResettingDestination,
      isSaving,
      isTemplateTab,
      setIsTemplateTab,
      templateHasChanges,
      templateValidationError,
      templateValidationOk,
      multiDestinationEnabled,
    ]
  );

  const handleAddDestinationToSingle = useCallback(
    async (targetSocialAccountId: string) => {
      if (!multiDestinationEnabled) {
        return;
      }
      if (!id || isMultiDestinationGroup) {
        return;
      }
      const normalized = (targetSocialAccountId || '').trim();
      if (!normalized) {
        return;
      }
      if (normalized === selectedTargetSocialAccountId) {
        return;
      }
      if (disabled || isSaving || isAddingContentDestination) {
        return;
      }

      if (hasChanges) {
        const ok = await handleSaveChanges();
        if (!ok) {
          return;
        }
      }

      try {
        const response: any = await addContentDestinationsAsync({
          targetSocialAccountId: normalized,
        });
        const added = Array.isArray(response?.added) ? response.added : [];
        const createdContentId =
          added.find((entry: any) => entry?.targetSocialAccountId === normalized)?.contentId ||
          added[0]?.contentId ||
          null;

        toast.success('Destination added');

        const scheduling = response?.scheduling;
        const results = Array.isArray(scheduling?.results) ? scheduling.results : [];
        const failed = results.find((r: any) => r?.ok === false);
        if (failed) {
          const errorMessage =
            typeof failed?.error?.message === 'string'
              ? failed.error.message
              : typeof failed?.error?.error === 'string'
                ? failed.error.error
                : 'Scheduling failed for the new destination.';
          toast.error(errorMessage);
        }

        if (createdContentId) {
          await handleDestinationSwitch(createdContentId);
        }
      } catch (error: any) {
        const message =
          typeof error?.data?.message === 'string'
            ? error.data.message
            : typeof error?.data?.error === 'string'
              ? error.data.error
              : typeof error?.message === 'string'
                ? error.message
                : 'Failed to add destination';
        toast.error(message);
      }
    },
    [
      addContentDestinationsAsync,
      disabled,
      handleDestinationSwitch,
      handleSaveChanges,
      hasChanges,
      id,
      isAddingContentDestination,
      isMultiDestinationGroup,
      isSaving,
      multiDestinationEnabled,
      selectedTargetSocialAccountId,
    ]
  );

  useEffect(() => {
    if (isMultiDestinationGroup) {
      return;
    }
    setIsTemplateTab(false);
  }, [isMultiDestinationGroup, setIsTemplateTab]);

  return {
    handleDestinationSwitch,
    handleGroupTabChange,
    handleSaveTemplate,
    handleApplyTemplate,
    handleResetDestinationToTemplate,
    handleAddDestinationToGroup,
    handleAddDestinationToSingle,
  };
}
