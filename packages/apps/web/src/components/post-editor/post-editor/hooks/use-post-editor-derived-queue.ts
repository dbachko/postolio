import { useMemo } from 'react';

import type { PostEditorDerivedParams } from './use-post-editor-derived-types';
import type { Platform } from '@/lib/platform-config';
import { assessQueueSlotState, supportsScheduling } from './use-post-editor-derived-shared';

function isQueueSupportedForSelection(params: {
  selectedPlatformAccountIds: string[];
  platformPickerOptions: PostEditorDerivedParams['platformPickerOptions'];
}): boolean {
  if (params.selectedPlatformAccountIds.length === 0) {
    return false;
  }

  const optionById = new Map(params.platformPickerOptions.map((option) => [option.id, option]));
  return params.selectedPlatformAccountIds.every((accountId) => {
    const option = optionById.get(accountId);
    return option ? supportsScheduling(option.platform) : false;
  });
}

function getEffectiveSchedulingSupported(params: {
  isMultiDestinationGroup: boolean;
  schedulingSupported: boolean;
  groupDestinations: PostEditorDerivedParams['groupDestinations'];
}): boolean {
  if (!params.isMultiDestinationGroup) {
    return params.schedulingSupported;
  }
  if (params.groupDestinations.length === 0) {
    return false;
  }

  return params.groupDestinations.every(
    (destination) => !destination.disconnected && supportsScheduling(destination.platform)
  );
}

function getQueuePlatformSupportedForPost(params: {
  id?: string;
  isMultiDestinationGroup: boolean;
  groupPlatforms: PostEditorDerivedParams['groupPlatforms'];
  post: PostEditorDerivedParams['post'];
  platformPickerOptions: PostEditorDerivedParams['platformPickerOptions'];
  queueSupportedForSelection: boolean;
}): boolean {
  if (!params.id) {
    return params.queueSupportedForSelection;
  }

  if (params.isMultiDestinationGroup) {
    const platforms: Platform[] =
      params.groupPlatforms.length > 0 ? params.groupPlatforms : ['instagram'];
    return platforms.every((platform) => supportsScheduling(platform));
  }

  const targetId =
    typeof (params.post as any)?.targetSocialAccountId === 'string'
      ? String((params.post as any).targetSocialAccountId)
      : null;
  if (!targetId) {
    return false;
  }

  const option = params.platformPickerOptions.find((entry) => entry.id === targetId) || null;
  return option ? supportsScheduling(option.platform) : false;
}

function buildQueueState(
  params: Pick<
    PostEditorDerivedParams,
    | 'id'
    | 'isMultiDestinationGroup'
    | 'groupDestinations'
    | 'groupPlatforms'
    | 'post'
    | 'platformPickerOptions'
    | 'selectedPlatformAccountIds'
    | 'schedulingSupported'
    | 'queueActionAccountIds'
    | 'queueSlotsBySocialAccountId'
    | 'queueSlotsLoadingBySocialAccountId'
    | 'queueSlotsErrorBySocialAccountId'
  >
) {
  const hasSelectedPlatforms = params.selectedPlatformAccountIds.length > 0;
  const queueSupportedForSelection = isQueueSupportedForSelection({
    selectedPlatformAccountIds: params.selectedPlatformAccountIds,
    platformPickerOptions: params.platformPickerOptions,
  });

  const queueSlotStateForSelection = assessQueueSlotState({
    accountIds: params.selectedPlatformAccountIds,
    queueSlotsBySocialAccountId: params.queueSlotsBySocialAccountId,
    queueSlotsLoadingBySocialAccountId: params.queueSlotsLoadingBySocialAccountId,
    queueSlotsErrorBySocialAccountId: params.queueSlotsErrorBySocialAccountId,
  });

  const queueSlotStateForPost = assessQueueSlotState({
    accountIds: params.queueActionAccountIds,
    queueSlotsBySocialAccountId: params.queueSlotsBySocialAccountId,
    queueSlotsLoadingBySocialAccountId: params.queueSlotsLoadingBySocialAccountId,
    queueSlotsErrorBySocialAccountId: params.queueSlotsErrorBySocialAccountId,
  });

  const effectiveSchedulingSupported = getEffectiveSchedulingSupported({
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    schedulingSupported: params.schedulingSupported,
    groupDestinations: params.groupDestinations,
  });

  const queuePlatformSupportedForPost = getQueuePlatformSupportedForPost({
    id: params.id,
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    groupPlatforms: params.groupPlatforms,
    post: params.post,
    platformPickerOptions: params.platformPickerOptions,
    queueSupportedForSelection,
  });

  const queueSupportedForPost =
    queuePlatformSupportedForPost &&
    queueSlotStateForPost.allHaveSlots &&
    !queueSlotStateForPost.anyLoading &&
    !queueSlotStateForPost.anyError;

  return {
    hasSelectedPlatforms,
    queueSupportedForSelection,
    queueSupportedForPost,
    queuePlatformSupportedForPost,
    queueSlotStateForSelection,
    queueSlotStateForPost,
    effectiveSchedulingSupported,
    queueNeedsPublishingSchedule: queueSlotStateForSelection.anyMissing,
    queueNeedsPublishingScheduleForPost: queueSlotStateForPost.anyMissing,
    pickSlotNeedsPublishingSchedule:
      params.selectedPlatformAccountIds.length === 1 && queueSlotStateForSelection.anyMissing,
  };
}

export function usePostEditorQueueState(
  params: Pick<
    PostEditorDerivedParams,
    | 'id'
    | 'isMultiDestinationGroup'
    | 'groupDestinations'
    | 'groupPlatforms'
    | 'post'
    | 'platformPickerOptions'
    | 'selectedPlatformAccountIds'
    | 'schedulingSupported'
    | 'queueActionAccountIds'
    | 'queueSlotsBySocialAccountId'
    | 'queueSlotsLoadingBySocialAccountId'
    | 'queueSlotsErrorBySocialAccountId'
  >
) {
  const {
    id,
    isMultiDestinationGroup,
    groupDestinations,
    groupPlatforms,
    post,
    platformPickerOptions,
    selectedPlatformAccountIds,
    schedulingSupported,
    queueActionAccountIds,
    queueSlotsBySocialAccountId,
    queueSlotsLoadingBySocialAccountId,
    queueSlotsErrorBySocialAccountId,
  } = params;

  return useMemo(
    () =>
      buildQueueState({
        id,
        isMultiDestinationGroup,
        groupDestinations,
        groupPlatforms,
        post,
        platformPickerOptions,
        selectedPlatformAccountIds,
        schedulingSupported,
        queueActionAccountIds,
        queueSlotsBySocialAccountId,
        queueSlotsLoadingBySocialAccountId,
        queueSlotsErrorBySocialAccountId,
      }),
    [
      groupDestinations,
      groupPlatforms,
      id,
      isMultiDestinationGroup,
      platformPickerOptions,
      post,
      queueActionAccountIds,
      queueSlotsBySocialAccountId,
      queueSlotsErrorBySocialAccountId,
      queueSlotsLoadingBySocialAccountId,
      schedulingSupported,
      selectedPlatformAccountIds,
    ]
  );
}
