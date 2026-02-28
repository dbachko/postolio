import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/stores/authStore';
import { useBrandStore, type BrandState } from '@/stores/brandStore';
import { useTimezone } from '@/contexts/TimezoneContext';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { isMultiDestinationEnabled } from '@/lib/feature-flags';

import type { PostEditorProps } from '../types';

import { usePostEditorBrandTimezone } from './use-post-editor-brand-timezone';
import { usePostEditorCreatePost } from './use-post-editor-create-post';
import { usePostEditorData } from './use-post-editor-data';
import { usePostEditorDerived } from './use-post-editor-derived';
import { usePostEditorDestinationActions } from './use-post-editor-destination-actions';
import { usePostEditorDestinations } from './use-post-editor-destinations';
import { usePostEditorFormState } from './use-post-editor-form-state';
import { usePostEditorMutations } from './use-post-editor-mutations';
import { usePostEditorPreview } from './use-post-editor-preview';
import { usePostEditorQueueAvailability } from './use-post-editor-queue-availability';
import { usePostEditorSaveActions } from './use-post-editor-save-actions';
import { usePostEditorTemplateForm } from './use-post-editor-template-form';
import { usePostEditorUiState } from './use-post-editor-ui-state';

type PostEditorBase = {
  id?: string;
  layout: NonNullable<PostEditorProps['layout']>;
  showHeader: boolean;
  onRequestClose?: () => void;
  navigate: ReturnType<typeof useNavigate>;
  location: ReturnType<typeof useLocation>;
  openSidebar: ReturnType<typeof useRightSidebarRouter>['openSidebar'];
  selectedBrand: BrandState['selectedBrand'];
  selectedBrandId: string | null;
  multiDestinationEnabled: boolean;
  timezone: string;
  getBrandTimezone: ReturnType<typeof useTimezone>['getBrandTimezone'];
};

function usePostEditorBase(props: PostEditorProps): PostEditorBase {
  const { id, layout = 'sidebar', onRequestClose, showHeader = true } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const { openSidebar } = useRightSidebarRouter();
  const { timezone, getBrandTimezone } = useTimezone();
  const user = useAuthStore((state) => state.user);
  const { selectedBrand } = useBrandStore();

  return {
    id,
    layout,
    showHeader,
    onRequestClose,
    navigate,
    location,
    openSidebar,
    selectedBrand,
    selectedBrandId: selectedBrand?.id ?? null,
    multiDestinationEnabled: isMultiDestinationEnabled(user),
    timezone,
    getBrandTimezone,
  };
}

function usePostEditorCoreState(base: PostEditorBase) {
  const data = usePostEditorData({
    id: base.id,
    selectedBrandId: base.selectedBrandId,
    multiDestinationEnabled: base.multiDestinationEnabled,
  });
  const brandTimezone = usePostEditorBrandTimezone({
    postBrandId: data.post?.brand?.id ?? null,
    selectedBrandId: base.selectedBrandId,
    timezone: base.timezone,
    getBrandTimezone: base.getBrandTimezone,
  });
  const ui = usePostEditorUiState();
  const destinations = usePostEditorDestinations({
    id: base.id,
    layout: base.layout,
    multiDestinationEnabled: base.multiDestinationEnabled,
    isMultiDestinationGroup: data.isMultiDestinationGroup,
    platformPickerOptions: data.platformPickerOptions,
    socialAccountsData: data.socialAccountsQuery.data,
  });

  return { data, brandTimezone, ui, destinations };
}

function usePostEditorEditingState(
  base: PostEditorBase,
  core: ReturnType<typeof usePostEditorCoreState>
) {
  const form = usePostEditorFormState({
    id: base.id,
    post: core.data.post,
    brandTimezone: core.brandTimezone,
    selectedBrandId: base.selectedBrandId,
    isMultiDestinationGroup: core.data.isMultiDestinationGroup,
    contentGroupSchedule: core.data.contentGroupSchedule,
    postAssetIds: core.data.postAssetIds,
    mediaAssetsById: core.data.mediaAssetsById,
    selectedTargetSocialAccountId: core.destinations.selectedTargetSocialAccountId,
    platformPickerOptions: core.data.platformPickerOptions,
    multiDestinationEnabled: base.multiDestinationEnabled,
    setSelectedPlatformAccountIds: core.destinations.setSelectedPlatformAccountIds,
    platformsInitializedRef: core.destinations.platformsInitializedRef,
    locationSearch: base.location.search,
  });

  const template = usePostEditorTemplateForm({
    id: base.id,
    contentGroupId: core.data.contentGroupId,
    isMultiDestinationGroup: core.data.isMultiDestinationGroup,
    contentGroupTemplate: core.data.contentGroupTemplate,
    groupPlatforms: core.data.groupPlatforms,
    templateAssetIds: core.data.templateAssetIds,
    templateAssetsById: core.data.templateAssetsById as any,
    templateCarouselAssets: core.data.templateCarouselAssets,
  });

  return { form, template };
}

function usePostEditorMutationsAndCreate(
  base: PostEditorBase,
  core: ReturnType<typeof usePostEditorCoreState>,
  editing: ReturnType<typeof usePostEditorEditingState>
) {
  const mutations = usePostEditorMutations({
    id: base.id,
    contentGroupId: core.data.contentGroupId,
    isMultiDestinationGroup: core.data.isMultiDestinationGroup,
    groupDestinations: core.data.groupDestinations,
    post: core.data.post,
    selectedBrandId: base.selectedBrandId,
    onRequestClose: base.onRequestClose,
    setHasChanges: editing.form.setHasChanges,
    setTemplateHasChanges: editing.template.setTemplateHasChanges,
  });

  const createPostMutation = usePostEditorCreatePost({
    layout: base.layout,
    onRequestClose: base.onRequestClose,
    selectedBrand: base.selectedBrand ? { id: base.selectedBrand.id } : null,
    brandTimezone: core.brandTimezone,
    formData: editing.form.formData,
    firstCommentOpen: editing.form.firstCommentOpen,
    selectedPlatformAccountIds: core.destinations.selectedPlatformAccountIds,
    multiDestinationEnabled: base.multiDestinationEnabled,
    openSidebar: base.openSidebar,
    navigate: base.navigate,
  });

  return { mutations, createPostMutation };
}

function useQueueActionAccountIds(params: {
  id?: string;
  postTargetSocialAccountId?: string | null;
  selectedPlatformAccountIds: string[];
  isMultiDestinationGroup: boolean;
  groupDestinations: Array<{ socialAccountId: string }>;
}) {
  return useMemo(() => {
    if (!params.id) {
      return params.selectedPlatformAccountIds;
    }
    if (params.isMultiDestinationGroup) {
      return Array.from(
        new Set(
          params.groupDestinations
            .map((destination) =>
              typeof destination.socialAccountId === 'string'
                ? destination.socialAccountId.trim()
                : ''
            )
            .filter(Boolean)
        )
      );
    }
    const targetSocialAccountId =
      typeof params.postTargetSocialAccountId === 'string'
        ? params.postTargetSocialAccountId.trim()
        : '';
    return targetSocialAccountId ? [targetSocialAccountId] : params.selectedPlatformAccountIds;
  }, [
    params.groupDestinations,
    params.id,
    params.isMultiDestinationGroup,
    params.postTargetSocialAccountId,
    params.selectedPlatformAccountIds,
  ]);
}

function usePostEditorDerivedState(
  base: PostEditorBase,
  core: ReturnType<typeof usePostEditorCoreState>,
  editing: ReturnType<typeof usePostEditorEditingState>,
  mutationState: ReturnType<typeof usePostEditorMutationsAndCreate>
) {
  const queueActionAccountIds = useQueueActionAccountIds({
    id: base.id,
    postTargetSocialAccountId: core.data.post?.targetSocialAccountId,
    selectedPlatformAccountIds: core.destinations.selectedPlatformAccountIds,
    isMultiDestinationGroup: core.data.isMultiDestinationGroup,
    groupDestinations: core.data.groupDestinations,
  });

  const queueAvailability = usePostEditorQueueAvailability({
    socialAccountIds: Array.from(
      new Set([...core.destinations.selectedPlatformAccountIds, ...queueActionAccountIds])
    ),
  });

  return {
    queueActionAccountIds,
    queueAvailability,
    derived: usePostEditorDerived({
      id: base.id,
      layout: base.layout,
      isMultiDestinationGroup: core.data.isMultiDestinationGroup,
      groupDestinations: core.data.groupDestinations,
      groupPlatforms: core.data.groupPlatforms,
      contentGroupSchedule: core.data.contentGroupSchedule,
      post: core.data.post,
      brandTimezone: core.brandTimezone,
      atCapacity: core.data.atCapacity,
      limitMessage: core.data.limitMessage,
      formData: editing.form.formData,
      firstCommentOpen: editing.form.firstCommentOpen,
      selectedPlatformAccountIds: core.destinations.selectedPlatformAccountIds,
      platformPickerOptions: core.data.platformPickerOptions,
      selectedPlatforms: core.destinations.selectedPlatforms,
      schedulingSupported: core.destinations.schedulingSupported,
      publishingSupported: core.destinations.publishingSupported,
      queueActionAccountIds,
      queueSlotsBySocialAccountId: queueAvailability.hasQueueSlotsBySocialAccountId,
      queueSlotsLoadingBySocialAccountId: queueAvailability.queueSlotsLoadingBySocialAccountId,
      queueSlotsErrorBySocialAccountId: queueAvailability.queueSlotsErrorBySocialAccountId,
      isCreatingPost: mutationState.createPostMutation.isCreatingPost,
    }),
  };
}

function usePostEditorActions(
  base: PostEditorBase,
  core: ReturnType<typeof usePostEditorCoreState>,
  editing: ReturnType<typeof usePostEditorEditingState>,
  mutationState: ReturnType<typeof usePostEditorMutationsAndCreate>,
  derivedState: ReturnType<typeof usePostEditorDerivedState>
) {
  const saveActions = usePostEditorSaveActions({
    id: base.id,
    post: core.data.post,
    brandTimezone: core.brandTimezone,
    isMultiDestinationGroup: core.data.isMultiDestinationGroup,
    contentGroupSchedule: core.data.contentGroupSchedule,
    formData: editing.form.formData,
    hasChanges: editing.form.hasChanges,
    firstCommentOpen: editing.form.firstCommentOpen,
    selectedTargetSocialAccountId: core.destinations.selectedTargetSocialAccountId,
    scheduleBlocker: derivedState.derived.scheduleBlocker,
    validation: derivedState.derived.validation,
    validationError: derivedState.derived.validationError,
    mutateContentAsync: mutationState.mutations.mutateContentAsync,
    scheduleContentGroup: mutationState.mutations.scheduleContentGroup,
    addToQueueAsync: mutationState.mutations.addToQueueAsync,
    isQueueing: mutationState.mutations.isQueueing,
    queueSupportedForPost: derivedState.derived.queueSupportedForPost,
    queueBlockerForPost: derivedState.derived.queueBlockerForPost,
    queryClient: mutationState.mutations.queryClient,
  });

  const preview = usePostEditorPreview({
    id: base.id,
    layout: base.layout,
    showHeader: base.showHeader,
    disabled: derivedState.derived.disabled,
    isMultiDestinationGroup: core.data.isMultiDestinationGroup,
    isTemplateTab: editing.template.isTemplateTab,
    previewOpen: core.ui.previewOpen,
    hasChanges: editing.form.hasChanges,
    post: core.data.post,
    brandTimezone: core.brandTimezone,
    contentGroupSchedule: core.data.contentGroupSchedule,
    formData: editing.form.formData,
    firstCommentOpen: editing.form.firstCommentOpen,
    templateFormData: editing.template.templateFormData,
    templateFirstCommentOpen: editing.template.templateFirstCommentOpen,
    groupDestinationPreviewData: core.data.groupDestinationPreviewData,
    platformPickerOptions: core.data.platformPickerOptions,
    selectedPlatformAccountIds: core.destinations.selectedPlatformAccountIds,
  });

  const destinationActions = usePostEditorDestinationActionsState({
    base,
    core,
    editing,
    mutationState,
    derivedState,
    handleSaveChanges: saveActions.handleSaveChanges,
  });

  return { saveActions, preview, destinationActions };
}

function usePostEditorDestinationActionsState(params: {
  base: PostEditorBase;
  core: ReturnType<typeof usePostEditorCoreState>;
  editing: ReturnType<typeof usePostEditorEditingState>;
  mutationState: ReturnType<typeof usePostEditorMutationsAndCreate>;
  derivedState: ReturnType<typeof usePostEditorDerivedState>;
  handleSaveChanges: () => Promise<boolean>;
}) {
  const { base, core, editing, mutationState, derivedState, handleSaveChanges } = params;
  return usePostEditorDestinationActions({
    id: base.id,
    layout: base.layout,
    disabled: derivedState.derived.disabled,
    hasChanges: editing.form.hasChanges,
    isMultiDestinationGroup: core.data.isMultiDestinationGroup,
    contentGroupId: core.data.contentGroupId,
    groupDestinationSocialAccountIds: core.data.groupDestinationSocialAccountIds,
    groupHasPublishedDestinations: core.data.groupHasPublishedDestinations,
    isSaving: mutationState.mutations.isSaving,
    isAddingDestination: mutationState.mutations.isAddingDestination,
    isResettingDestination: mutationState.mutations.isResettingDestination,
    isTemplateTab: editing.template.isTemplateTab,
    setIsTemplateTab: editing.template.setIsTemplateTab,
    templateHasChanges: editing.template.templateHasChanges,
    templateValidationOk: editing.template.templateValidation.ok,
    templateValidationError: editing.template.templateValidationError,
    templateFormData: editing.template.templateFormData,
    templateFirstCommentOpen: editing.template.templateFirstCommentOpen,
    saveTemplateAsync: mutationState.mutations.saveTemplateAsync,
    applyTemplateAsync: mutationState.mutations.applyTemplateAsync,
    resetDestinationAsync: mutationState.mutations.resetDestinationAsync,
    addGroupDestinationsAsync: mutationState.mutations.addGroupDestinationsAsync,
    addContentDestinationsAsync: mutationState.mutations.addContentDestinationsAsync,
    isAddingContentDestination: mutationState.mutations.isAddingContentDestination,
    selectedTargetSocialAccountId: core.destinations.selectedTargetSocialAccountId,
    openSidebar: base.openSidebar,
    navigate: base.navigate,
    handleSaveChanges,
    multiDestinationEnabled: base.multiDestinationEnabled,
  });
}

export function usePostEditor(props: PostEditorProps) {
  const base = usePostEditorBase(props);
  const core = usePostEditorCoreState(base);
  const editing = usePostEditorEditingState(base, core);
  const mutationState = usePostEditorMutationsAndCreate(base, core, editing);
  const derivedState = usePostEditorDerivedState(base, core, editing, mutationState);
  const actions = usePostEditorActions(base, core, editing, mutationState, derivedState);
  const { layout, navigate, onRequestClose } = base;
  const hasChanges = editing.form.hasChanges;
  const isDisabled = derivedState.derived.disabled;

  const handleCloseSidebar = useCallback(() => {
    if (layout === 'sidebar') {
      if (!isDisabled && hasChanges) {
        void actions.saveActions.handleSaveChanges();
      }
      onRequestClose?.();
    }
  }, [actions.saveActions, hasChanges, isDisabled, layout, onRequestClose]);

  const handleOpenCreatePage = useCallback(() => {
    if (layout === 'sidebar') {
      onRequestClose?.();
    }
    navigate('/posts/create');
  }, [layout, navigate, onRequestClose]);

  return {
    id: base.id,
    layout: base.layout,
    showHeader: base.showHeader,
    onRequestClose: base.onRequestClose,
    selectedBrand: base.selectedBrand,
    navigate: base.navigate,
    location: base.location,
    openSidebar: base.openSidebar,
    brandTimezone: core.brandTimezone,
    flags: { multiDestinationEnabled: base.multiDestinationEnabled },
    data: core.data,
    ui: core.ui,
    destinations: core.destinations,
    form: editing.form,
    template: editing.template,
    mutations: mutationState.mutations,
    createPostMutation: mutationState.createPostMutation,
    derived: derivedState.derived,
    preview: actions.preview,
    saveActions: actions.saveActions,
    destinationActions: actions.destinationActions,
    handleCloseSidebar,
    handleOpenCreatePage,
  };
}

export type PostEditorState = ReturnType<typeof usePostEditor>;
