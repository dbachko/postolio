import { useCallback, useEffect } from 'react';

import type { InstagramContentType } from '@postolio/content-validation';
import type { ContentGroupTemplateFormState } from '@/components/post-editor/content-group-template-editor/types';

import type { PostEditorLayout } from '../types';
import { buildDestinationTemplatePayload } from './post-editor-destination-actions-utils';
import {
  useGroupDestinationAddAction,
  useSingleDestinationAddAction,
} from './use-post-editor-destination-add-actions';

type UsePostEditorDestinationActionsParams = {
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
};

function useDestinationSwitchAction(params: UsePostEditorDestinationActionsParams) {
  const { disabled, handleSaveChanges, hasChanges, id, layout, navigate, openSidebar } = params;

  return useCallback(
    async (nextContentId: string) => {
      if (!nextContentId || nextContentId === id) {
        return;
      }
      if (!disabled && hasChanges && !(await handleSaveChanges())) {
        return;
      }
      if (layout === 'sidebar') {
        openSidebar('post', { id: nextContentId });
        return;
      }
      navigate(`/posts/${nextContentId}`);
    },
    [disabled, handleSaveChanges, hasChanges, id, layout, navigate, openSidebar]
  );
}

function useTemplateActions(params: UsePostEditorDestinationActionsParams) {
  const {
    applyTemplateAsync,
    contentGroupId,
    disabled,
    hasChanges,
    id,
    resetDestinationAsync,
    saveTemplateAsync,
    templateFirstCommentOpen,
    templateFormData,
    templateHasChanges,
  } = params;

  const handleSaveTemplate = useCallback(async (): Promise<boolean> => {
    if (!contentGroupId) {
      return false;
    }
    try {
      await saveTemplateAsync(
        buildDestinationTemplatePayload(templateFormData, templateFirstCommentOpen)
      );
      return true;
    } catch {
      return false;
    }
  }, [contentGroupId, saveTemplateAsync, templateFirstCommentOpen, templateFormData]);

  const handleApplyTemplate = useCallback(async () => {
    if (!contentGroupId) {
      return;
    }
    if (templateHasChanges && !(await handleSaveTemplate())) {
      return;
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

  return { handleSaveTemplate, handleApplyTemplate, handleResetDestinationToTemplate };
}

function useGroupTabChangeAction(
  params: UsePostEditorDestinationActionsParams,
  handleDestinationSwitch: (nextContentId: string) => Promise<void>
) {
  const { disabled, handleSaveChanges, hasChanges, id, isMultiDestinationGroup, setIsTemplateTab } =
    params;

  return useCallback(
    async (value: string) => {
      if (!isMultiDestinationGroup || !id) {
        return;
      }
      if (value === 'template') {
        if (!disabled && hasChanges && !(await handleSaveChanges())) {
          return;
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
}

function useDestinationAddActions(
  params: UsePostEditorDestinationActionsParams,
  handleDestinationSwitch: (nextContentId: string) => Promise<void>,
  handleSaveTemplate: () => Promise<boolean>
) {
  const handleAddDestinationToGroup = useGroupDestinationAddAction({
    multiDestinationEnabled: params.multiDestinationEnabled,
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    contentGroupId: params.contentGroupId,
    groupDestinationSocialAccountIds: params.groupDestinationSocialAccountIds,
    disabled: params.disabled,
    groupHasPublishedDestinations: params.groupHasPublishedDestinations,
    isSaving: params.isSaving,
    isAddingDestination: params.isAddingDestination,
    isResettingDestination: params.isResettingDestination,
    isTemplateTab: params.isTemplateTab,
    templateHasChanges: params.templateHasChanges,
    templateValidationOk: params.templateValidationOk,
    templateValidationError: params.templateValidationError,
    hasChanges: params.hasChanges,
    addGroupDestinationsAsync: params.addGroupDestinationsAsync,
    setIsTemplateTab: params.setIsTemplateTab,
    handleSaveTemplate,
    handleSaveChanges: params.handleSaveChanges,
    handleDestinationSwitch,
  });

  const handleAddDestinationToSingle = useSingleDestinationAddAction({
    multiDestinationEnabled: params.multiDestinationEnabled,
    id: params.id,
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    selectedTargetSocialAccountId: params.selectedTargetSocialAccountId,
    disabled: params.disabled,
    isSaving: params.isSaving,
    isAddingContentDestination: params.isAddingContentDestination,
    hasChanges: params.hasChanges,
    handleSaveChanges: params.handleSaveChanges,
    addContentDestinationsAsync: params.addContentDestinationsAsync,
    handleDestinationSwitch,
  });

  return { handleAddDestinationToGroup, handleAddDestinationToSingle };
}

export function usePostEditorDestinationActions(params: UsePostEditorDestinationActionsParams) {
  const { isMultiDestinationGroup, setIsTemplateTab } = params;
  const handleDestinationSwitch = useDestinationSwitchAction(params);
  const handleGroupTabChange = useGroupTabChangeAction(params, handleDestinationSwitch);
  const templateActions = useTemplateActions(params);
  const destinationAddActions = useDestinationAddActions(
    params,
    handleDestinationSwitch,
    templateActions.handleSaveTemplate
  );

  useEffect(() => {
    if (!isMultiDestinationGroup) {
      setIsTemplateTab(false);
    }
  }, [isMultiDestinationGroup, setIsTemplateTab]);

  return {
    handleDestinationSwitch,
    handleGroupTabChange,
    handleSaveTemplate: templateActions.handleSaveTemplate,
    handleApplyTemplate: templateActions.handleApplyTemplate,
    handleResetDestinationToTemplate: templateActions.handleResetDestinationToTemplate,
    handleAddDestinationToGroup: destinationAddActions.handleAddDestinationToGroup,
    handleAddDestinationToSingle: destinationAddActions.handleAddDestinationToSingle,
  };
}
