import { useMemo } from 'react';

import { getScheduleBlockerMessage } from '../utils';
import type { PostEditorDerivedParams } from './use-post-editor-derived-types';
import type { QueueSlotState } from './use-post-editor-derived-shared';

function getPublishNowBlocker(params: {
  hasSelectedPlatforms: boolean;
  publishingSupported: boolean;
  validationOk: boolean;
  validationError: string | null;
}): string | null {
  if (!params.hasSelectedPlatforms) {
    return 'Select at least one destination in Destinations.';
  }
  if (!params.publishingSupported) {
    return 'Publishing is not available for this destination.';
  }
  if (!params.validationOk) {
    return params.validationError || 'Please fix validation errors before continuing.';
  }
  return null;
}

function getQueueOptionBlocker(params: {
  hasSelectedPlatforms: boolean;
  queueSupportedForSelection: boolean;
  queueSlotStateForSelection: QueueSlotState;
}): string | null {
  if (!params.hasSelectedPlatforms) {
    return 'Select at least one destination in Destinations.';
  }
  if (!params.queueSupportedForSelection) {
    return 'Queue scheduling is not available for this destination.';
  }
  if (params.queueSlotStateForSelection.anyLoading) {
    return 'Checking publishing schedule...';
  }
  if (params.queueSlotStateForSelection.anyMissing) {
    return 'Add at least one slot in Publishing Schedule for each selected destination.';
  }
  if (params.queueSlotStateForSelection.anyError || params.queueSlotStateForSelection.anyUnknown) {
    return 'Could not verify Publishing Schedule right now. Please try again.';
  }
  return null;
}

function getQueueBlocker(params: {
  queueOptionBlocker: string | null;
  validationOk: boolean;
  validationError: string | null;
}): string | null {
  if (params.queueOptionBlocker) {
    return params.queueOptionBlocker;
  }
  if (!params.validationOk) {
    return params.validationError || 'Please fix validation errors before continuing.';
  }
  return null;
}

function getPickSlotBlocker(params: {
  hasSelectedPlatforms: boolean;
  queueSupportedForSelection: boolean;
  selectedPlatformAccountIds: string[];
  queueSlotStateForSelection: QueueSlotState;
}): string | null {
  if (!params.hasSelectedPlatforms) {
    return 'Select at least one destination in Destinations.';
  }
  if (!params.queueSupportedForSelection) {
    return 'Slot schedules are not available for this destination.';
  }
  if (params.selectedPlatformAccountIds.length !== 1) {
    return 'Select exactly one destination to pick a slot.';
  }
  if (params.queueSlotStateForSelection.anyLoading) {
    return 'Checking publishing schedule...';
  }
  if (params.queueSlotStateForSelection.anyMissing) {
    return 'Add at least one slot in Publishing Schedule for this destination.';
  }
  if (params.queueSlotStateForSelection.anyError || params.queueSlotStateForSelection.anyUnknown) {
    return 'Could not verify Publishing Schedule right now. Please try again.';
  }
  return null;
}

function getQueueBlockerForPost(params: {
  queuePlatformSupportedForPost: boolean;
  queueSlotStateForPost: QueueSlotState;
  isMultiDestinationGroup: boolean;
}): string | null {
  if (!params.queuePlatformSupportedForPost) {
    return 'Queue scheduling is not available for this destination.';
  }
  if (params.queueSlotStateForPost.anyLoading) {
    return 'Checking publishing schedule...';
  }
  if (params.queueSlotStateForPost.anyMissing) {
    return params.isMultiDestinationGroup
      ? 'Add at least one slot in Publishing Schedule for each destination in this post group.'
      : 'Add at least one slot in Publishing Schedule for this destination.';
  }
  if (params.queueSlotStateForPost.anyError || params.queueSlotStateForPost.anyUnknown) {
    return 'Could not verify Publishing Schedule right now. Please try again.';
  }
  return null;
}

function buildQueueActionState(params: {
  hasSelectedPlatforms: boolean;
  queueSupportedForSelection: boolean;
  queueSlotStateForSelection: QueueSlotState;
  selectedPlatformAccountIds: string[];
  validation: { ok: boolean };
  validationError: string | null;
  queuePlatformSupportedForPost: boolean;
  queueSlotStateForPost: QueueSlotState;
  isMultiDestinationGroup: boolean;
}) {
  const queueOptionBlocker = getQueueOptionBlocker({
    hasSelectedPlatforms: params.hasSelectedPlatforms,
    queueSupportedForSelection: params.queueSupportedForSelection,
    queueSlotStateForSelection: params.queueSlotStateForSelection,
  });

  return {
    queueOptionDisabled:
      !params.hasSelectedPlatforms ||
      !params.queueSupportedForSelection ||
      params.queueSlotStateForSelection.anyLoading ||
      !params.queueSlotStateForSelection.allHaveSlots,
    queueOptionBlocker,
    queueDisabled: !params.validation.ok || Boolean(queueOptionBlocker),
    queueBlocker: getQueueBlocker({
      queueOptionBlocker,
      validationOk: params.validation.ok,
      validationError: params.validationError,
    }),
    pickSlotDisabled:
      params.selectedPlatformAccountIds.length !== 1 ||
      !params.queueSupportedForSelection ||
      params.queueSlotStateForSelection.anyLoading ||
      !params.queueSlotStateForSelection.allHaveSlots,
    pickSlotBlocker: getPickSlotBlocker({
      hasSelectedPlatforms: params.hasSelectedPlatforms,
      queueSupportedForSelection: params.queueSupportedForSelection,
      selectedPlatformAccountIds: params.selectedPlatformAccountIds,
      queueSlotStateForSelection: params.queueSlotStateForSelection,
    }),
    queueBlockerForPost: getQueueBlockerForPost({
      queuePlatformSupportedForPost: params.queuePlatformSupportedForPost,
      queueSlotStateForPost: params.queueSlotStateForPost,
      isMultiDestinationGroup: params.isMultiDestinationGroup,
    }),
  };
}

function buildActionState(
  params: Pick<
    PostEditorDerivedParams,
    | 'atCapacity'
    | 'limitMessage'
    | 'formData'
    | 'firstCommentOpen'
    | 'publishingSupported'
    | 'selectedPlatformAccountIds'
    | 'isCreatingPost'
    | 'isMultiDestinationGroup'
  > & {
    validation: { ok: boolean };
    validationError: string | null;
    hasSelectedPlatforms: boolean;
    effectiveSchedulingSupported: boolean;
    queueSupportedForSelection: boolean;
    queuePlatformSupportedForPost: boolean;
    queueSlotStateForSelection: QueueSlotState;
    queueSlotStateForPost: QueueSlotState;
  }
) {
  const scheduleBlocker = getScheduleBlockerMessage({
    atCapacity: params.atCapacity,
    limitMessage: params.limitMessage,
    validationOk: params.validation.ok,
    validationError: params.validationError,
    hasScheduleTime: Boolean(params.formData.scheduledAt),
    hasSelectedPlatforms: params.hasSelectedPlatforms,
    schedulingSupported: params.effectiveSchedulingSupported,
  });

  const hasDraftInputs =
    Boolean((params.formData.caption || '').trim()) ||
    (params.firstCommentOpen && Boolean((params.formData.firstComment || '').trim())) ||
    (params.formData.carouselAssets?.length ?? 0) > 0;
  const saveDraftDisabled = !hasDraftInputs;

  const queueState = buildQueueActionState({
    hasSelectedPlatforms: params.hasSelectedPlatforms,
    queueSupportedForSelection: params.queueSupportedForSelection,
    queueSlotStateForSelection: params.queueSlotStateForSelection,
    selectedPlatformAccountIds: params.selectedPlatformAccountIds,
    validation: params.validation,
    validationError: params.validationError,
    queuePlatformSupportedForPost: params.queuePlatformSupportedForPost,
    queueSlotStateForPost: params.queueSlotStateForPost,
    isMultiDestinationGroup: params.isMultiDestinationGroup,
  });

  return {
    scheduleBlocker,
    createScheduleDisabled: params.isCreatingPost || Boolean(scheduleBlocker),
    saveDraftDisabled,
    saveDraftBlocker: saveDraftDisabled
      ? 'Add a caption, media, or first comment before saving a draft.'
      : null,
    publishNowDisabled:
      !params.validation.ok || !params.hasSelectedPlatforms || !params.publishingSupported,
    publishNowBlocker: getPublishNowBlocker({
      hasSelectedPlatforms: params.hasSelectedPlatforms,
      publishingSupported: params.publishingSupported,
      validationOk: params.validation.ok,
      validationError: params.validationError,
    }),
    ...queueState,
  };
}

export function usePostEditorActionState(
  params: Pick<
    PostEditorDerivedParams,
    | 'atCapacity'
    | 'limitMessage'
    | 'formData'
    | 'firstCommentOpen'
    | 'publishingSupported'
    | 'selectedPlatformAccountIds'
    | 'isCreatingPost'
    | 'isMultiDestinationGroup'
  > & {
    validation: { ok: boolean };
    validationError: string | null;
    hasSelectedPlatforms: boolean;
    effectiveSchedulingSupported: boolean;
    queueSupportedForSelection: boolean;
    queuePlatformSupportedForPost: boolean;
    queueSlotStateForSelection: QueueSlotState;
    queueSlotStateForPost: QueueSlotState;
  }
) {
  const {
    atCapacity,
    limitMessage,
    formData,
    firstCommentOpen,
    publishingSupported,
    selectedPlatformAccountIds,
    isCreatingPost,
    isMultiDestinationGroup,
    validation,
    validationError,
    hasSelectedPlatforms,
    effectiveSchedulingSupported,
    queueSupportedForSelection,
    queuePlatformSupportedForPost,
    queueSlotStateForSelection,
    queueSlotStateForPost,
  } = params;

  return useMemo(
    () =>
      buildActionState({
        atCapacity,
        limitMessage,
        formData,
        firstCommentOpen,
        publishingSupported,
        selectedPlatformAccountIds,
        isCreatingPost,
        isMultiDestinationGroup,
        validation,
        validationError,
        hasSelectedPlatforms,
        effectiveSchedulingSupported,
        queueSupportedForSelection,
        queuePlatformSupportedForPost,
        queueSlotStateForSelection,
        queueSlotStateForPost,
      }),
    [
      atCapacity,
      effectiveSchedulingSupported,
      firstCommentOpen,
      formData,
      hasSelectedPlatforms,
      isCreatingPost,
      isMultiDestinationGroup,
      limitMessage,
      publishingSupported,
      queuePlatformSupportedForPost,
      queueSlotStateForPost,
      queueSlotStateForSelection,
      queueSupportedForSelection,
      selectedPlatformAccountIds,
      validation,
      validationError,
    ]
  );
}
