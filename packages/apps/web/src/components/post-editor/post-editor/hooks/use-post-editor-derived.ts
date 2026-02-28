import { usePostEditorActionState } from './use-post-editor-derived-actions';
import { usePostEditorLayoutState } from './use-post-editor-derived-layout';
import { usePostEditorQueueState } from './use-post-editor-derived-queue';
import { usePostEditorValidationState } from './use-post-editor-derived-validation';
import type { PostEditorDerivedParams } from './use-post-editor-derived-types';

function combineDerivedState(params: {
  validationState: ReturnType<typeof usePostEditorValidationState>;
  actionState: ReturnType<typeof usePostEditorActionState>;
  queueState: ReturnType<typeof usePostEditorQueueState>;
  layoutState: ReturnType<typeof usePostEditorLayoutState>;
}) {
  return {
    validation: params.validationState.validation,
    validationError: params.validationState.validationError,
    scheduleBlocker: params.actionState.scheduleBlocker,
    createScheduleDisabled: params.actionState.createScheduleDisabled,
    saveDraftDisabled: params.actionState.saveDraftDisabled,
    saveDraftBlocker: params.actionState.saveDraftBlocker,
    publishNowDisabled: params.actionState.publishNowDisabled,
    publishNowBlocker: params.actionState.publishNowBlocker,
    queueOptionDisabled: params.actionState.queueOptionDisabled,
    queueOptionBlocker: params.actionState.queueOptionBlocker,
    queueDisabled: params.actionState.queueDisabled,
    queueBlocker: params.actionState.queueBlocker,
    queueBlockerForPost: params.actionState.queueBlockerForPost,
    queueNeedsPublishingSchedule: params.queueState.queueNeedsPublishingSchedule,
    queueNeedsPublishingScheduleForPost: params.queueState.queueNeedsPublishingScheduleForPost,
    pickSlotDisabled: params.actionState.pickSlotDisabled,
    pickSlotBlocker: params.actionState.pickSlotBlocker,
    pickSlotNeedsPublishingSchedule: params.queueState.pickSlotNeedsPublishingSchedule,
    queueSupportedForSelection: params.queueState.queueSupportedForSelection,
    queueSupportedForPost: params.queueState.queueSupportedForPost,
    isScheduled: params.layoutState.isScheduled,
    disabled: params.layoutState.disabled,
    minScheduleInput: params.layoutState.minScheduleInput,
    containerClass: params.layoutState.containerClass,
    headerClass: params.layoutState.headerClass,
    bodyClass: params.layoutState.bodyClass,
    groupBodyClass: params.layoutState.groupBodyClass,
    activeDestinationLabel: params.layoutState.activeDestinationLabel,
    allowMixedMedia: params.layoutState.allowMixedMedia,
    hasSelectedPlatforms: params.queueState.hasSelectedPlatforms,
    effectiveSchedulingSupported: params.queueState.effectiveSchedulingSupported,
  };
}

export function usePostEditorDerived(params: PostEditorDerivedParams) {
  const validationState = usePostEditorValidationState({
    formData: params.formData,
    selectedPlatforms: params.selectedPlatforms,
  });

  const queueState = usePostEditorQueueState({
    id: params.id,
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    groupDestinations: params.groupDestinations,
    groupPlatforms: params.groupPlatforms,
    post: params.post,
    platformPickerOptions: params.platformPickerOptions,
    selectedPlatformAccountIds: params.selectedPlatformAccountIds,
    schedulingSupported: params.schedulingSupported,
    queueActionAccountIds: params.queueActionAccountIds,
    queueSlotsBySocialAccountId: params.queueSlotsBySocialAccountId,
    queueSlotsLoadingBySocialAccountId: params.queueSlotsLoadingBySocialAccountId,
    queueSlotsErrorBySocialAccountId: params.queueSlotsErrorBySocialAccountId,
  });

  const actionState = usePostEditorActionState({
    atCapacity: params.atCapacity,
    limitMessage: params.limitMessage,
    formData: params.formData,
    firstCommentOpen: params.firstCommentOpen,
    publishingSupported: params.publishingSupported,
    selectedPlatformAccountIds: params.selectedPlatformAccountIds,
    isCreatingPost: params.isCreatingPost,
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    validation: validationState.validation,
    validationError: validationState.validationError,
    hasSelectedPlatforms: queueState.hasSelectedPlatforms,
    effectiveSchedulingSupported: queueState.effectiveSchedulingSupported,
    queueSupportedForSelection: queueState.queueSupportedForSelection,
    queuePlatformSupportedForPost: queueState.queuePlatformSupportedForPost,
    queueSlotStateForSelection: queueState.queueSlotStateForSelection,
    queueSlotStateForPost: queueState.queueSlotStateForPost,
  });

  const layoutState = usePostEditorLayoutState({
    layout: params.layout,
    id: params.id,
    post: params.post,
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    contentGroupSchedule: params.contentGroupSchedule,
    groupDestinations: params.groupDestinations,
    formData: params.formData,
    selectedPlatforms: params.selectedPlatforms,
    brandTimezone: params.brandTimezone,
  });

  return combineDerivedState({ validationState, actionState, queueState, layoutState });
}
