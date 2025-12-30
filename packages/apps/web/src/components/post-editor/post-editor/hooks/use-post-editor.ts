import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useBrandStore } from '@/stores/brandStore';
import { useTimezone } from '@/contexts/TimezoneContext';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';

import type { PostEditorProps } from '../types';

import { usePostEditorBrandTimezone } from './use-post-editor-brand-timezone';
import { usePostEditorCreatePost } from './use-post-editor-create-post';
import { usePostEditorData } from './use-post-editor-data';
import { usePostEditorDerived } from './use-post-editor-derived';
import { usePostEditorDestinations } from './use-post-editor-destinations';
import { usePostEditorDestinationActions } from './use-post-editor-destination-actions';
import { usePostEditorFormState } from './use-post-editor-form-state';
import { usePostEditorMutations } from './use-post-editor-mutations';
import { usePostEditorPreview } from './use-post-editor-preview';
import { usePostEditorSaveActions } from './use-post-editor-save-actions';
import { usePostEditorTemplateForm } from './use-post-editor-template-form';
import { usePostEditorUiState } from './use-post-editor-ui-state';

export function usePostEditor(props: PostEditorProps) {
  const { id, layout = 'sidebar', onRequestClose, showHeader = true } = props;

  const navigate = useNavigate();
  const location = useLocation();
  const { openSidebar } = useRightSidebarRouter();

  const { timezone, getBrandTimezone } = useTimezone();
  const { selectedBrand } = useBrandStore();
  const selectedBrandId = selectedBrand?.id ?? null;

  const data = usePostEditorData({ id, selectedBrandId });

  const brandTimezone = usePostEditorBrandTimezone({
    postBrandId: data.post?.brand?.id ?? null,
    selectedBrandId,
    timezone,
    getBrandTimezone,
  });

  const ui = usePostEditorUiState();

  const destinations = usePostEditorDestinations({
    id,
    layout,
    isMultiDestinationGroup: data.isMultiDestinationGroup,
    platformPickerOptions: data.platformPickerOptions,
    socialAccountsData: data.socialAccountsQuery.data,
  });

  const form = usePostEditorFormState({
    id,
    post: data.post,
    brandTimezone,
    selectedBrandId,
    isMultiDestinationGroup: data.isMultiDestinationGroup,
    contentGroupSchedule: data.contentGroupSchedule,
    postAssetIds: data.postAssetIds,
    mediaAssetsById: data.mediaAssetsById,
    selectedTargetSocialAccountId: destinations.selectedTargetSocialAccountId,
    platformPickerOptions: data.platformPickerOptions,
    setSelectedPlatformAccountIds: destinations.setSelectedPlatformAccountIds,
    platformsInitializedRef: destinations.platformsInitializedRef,
    locationSearch: location.search,
  });

  const template = usePostEditorTemplateForm({
    id,
    contentGroupId: data.contentGroupId,
    isMultiDestinationGroup: data.isMultiDestinationGroup,
    contentGroupTemplate: data.contentGroupTemplate,
    groupPlatforms: data.groupPlatforms,
    templateAssetIds: data.templateAssetIds,
    templateAssetsById: data.templateAssetsById as any,
    templateCarouselAssets: data.templateCarouselAssets,
  });

  const mutations = usePostEditorMutations({
    id,
    contentGroupId: data.contentGroupId,
    isMultiDestinationGroup: data.isMultiDestinationGroup,
    groupDestinations: data.groupDestinations,
    post: data.post,
    selectedBrandId,
    onRequestClose,
    setHasChanges: form.setHasChanges,
    setTemplateHasChanges: template.setTemplateHasChanges,
  });

  const createPostMutation = usePostEditorCreatePost({
    layout,
    onRequestClose,
    selectedBrand: selectedBrand ? { id: selectedBrand.id } : null,
    brandTimezone,
    formData: form.formData,
    firstCommentOpen: form.firstCommentOpen,
    selectedCampaign: form.selectedCampaign,
    selectedPlatformAccountIds: destinations.selectedPlatformAccountIds,
    openSidebar,
    navigate,
  });

  const derived = usePostEditorDerived({
    id,
    layout,
    isMultiDestinationGroup: data.isMultiDestinationGroup,
    groupDestinations: data.groupDestinations,
    groupPlatforms: data.groupPlatforms,
    contentGroupSchedule: data.contentGroupSchedule,
    post: data.post,
    brandTimezone,
    atCapacity: data.atCapacity,
    limitMessage: data.limitMessage,
    formData: form.formData,
    firstCommentOpen: form.firstCommentOpen,
    selectedCampaign: form.selectedCampaign,
    selectedCampaignPaused: form.selectedCampaignPaused,
    selectedPlatformAccountIds: destinations.selectedPlatformAccountIds,
    platformPickerOptions: data.platformPickerOptions,
    selectedPlatforms: destinations.selectedPlatforms,
    schedulingSupported: destinations.schedulingSupported,
    publishingSupported: destinations.publishingSupported,
    isCreatingPost: createPostMutation.isCreatingPost,
  });

  const preview = usePostEditorPreview({
    id,
    layout,
    showHeader,
    disabled: derived.disabled,
    isMultiDestinationGroup: data.isMultiDestinationGroup,
    isTemplateTab: template.isTemplateTab,
    previewOpen: ui.previewOpen,
    hasChanges: form.hasChanges,
    post: data.post,
    brandTimezone,
    contentGroupSchedule: data.contentGroupSchedule,
    formData: form.formData,
    firstCommentOpen: form.firstCommentOpen,
    templateFormData: template.templateFormData,
    templateFirstCommentOpen: template.templateFirstCommentOpen,
    groupDestinationPreviewData: data.groupDestinationPreviewData,
    platformPickerOptions: data.platformPickerOptions,
    selectedPlatformAccountIds: destinations.selectedPlatformAccountIds,
  });

  const saveActions = usePostEditorSaveActions({
    id,
    post: data.post,
    brandTimezone,
    isMultiDestinationGroup: data.isMultiDestinationGroup,
    contentGroupSchedule: data.contentGroupSchedule,
    formData: form.formData,
    hasChanges: form.hasChanges,
    firstCommentOpen: form.firstCommentOpen,
    selectedCampaign: form.selectedCampaign,
    selectedTargetSocialAccountId: destinations.selectedTargetSocialAccountId,
    scheduleBlocker: derived.scheduleBlocker,
    validation: derived.validation,
    validationError: derived.validationError,
    mutateContentAsync: mutations.mutateContentAsync,
    scheduleContentGroup: mutations.scheduleContentGroup,
    addToQueueAsync: mutations.addToQueueAsync,
    isQueueing: mutations.isQueueing,
    queueSupportedForPost: derived.queueSupportedForPost,
    queryClient: mutations.queryClient,
  });

  const destinationActions = usePostEditorDestinationActions({
    id,
    layout,
    disabled: derived.disabled,
    hasChanges: form.hasChanges,
    isMultiDestinationGroup: data.isMultiDestinationGroup,
    contentGroupId: data.contentGroupId,
    groupDestinationSocialAccountIds: data.groupDestinationSocialAccountIds,
    groupHasPublishedDestinations: data.groupHasPublishedDestinations,
    isSaving: mutations.isSaving,
    isAddingDestination: mutations.isAddingDestination,
    isResettingDestination: mutations.isResettingDestination,
    isTemplateTab: template.isTemplateTab,
    setIsTemplateTab: template.setIsTemplateTab,
    templateHasChanges: template.templateHasChanges,
    templateValidationOk: template.templateValidation.ok,
    templateValidationError: template.templateValidationError,
    templateFormData: template.templateFormData,
    templateFirstCommentOpen: template.templateFirstCommentOpen,
    saveTemplateAsync: mutations.saveTemplateAsync,
    applyTemplateAsync: mutations.applyTemplateAsync,
    resetDestinationAsync: mutations.resetDestinationAsync,
    addGroupDestinationsAsync: mutations.addGroupDestinationsAsync,
    addContentDestinationsAsync: mutations.addContentDestinationsAsync,
    isAddingContentDestination: mutations.isAddingContentDestination,
    selectedTargetSocialAccountId: destinations.selectedTargetSocialAccountId,
    openSidebar,
    navigate,
    handleSaveChanges: saveActions.handleSaveChanges,
  });

  const handleCloseSidebar = useCallback(() => {
    if (layout === 'sidebar') {
      if (!derived.disabled && form.hasChanges) {
        void saveActions.handleSaveChanges();
      }
      onRequestClose?.();
    }
  }, [derived.disabled, form.hasChanges, layout, onRequestClose, saveActions]);

  const handleOpenCreatePage = useCallback(() => {
    if (layout === 'sidebar') {
      onRequestClose?.();
    }
    navigate('/posts/create');
  }, [layout, navigate, onRequestClose]);

  return {
    id,
    layout,
    showHeader,
    onRequestClose,
    selectedBrand,
    navigate,
    location,
    openSidebar,
    brandTimezone,
    data,
    ui,
    destinations,
    form,
    template,
    mutations,
    createPostMutation,
    derived,
    preview,
    saveActions,
    destinationActions,
    handleCloseSidebar,
    handleOpenCreatePage,
  };
}

export type PostEditorState = ReturnType<typeof usePostEditor>;
