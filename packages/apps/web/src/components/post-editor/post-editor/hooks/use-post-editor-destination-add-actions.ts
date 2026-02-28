import { useCallback } from 'react';
import { toast } from 'sonner';

import {
  createdDestinationContentId,
  destinationErrorMessage,
  notifyDestinationSchedulingFailure,
} from './post-editor-destination-actions-utils';

type GroupActionParams = {
  multiDestinationEnabled: boolean;
  isMultiDestinationGroup: boolean;
  contentGroupId: string | null;
  groupDestinationSocialAccountIds: Set<string>;
  disabled: boolean;
  groupHasPublishedDestinations: boolean;
  isSaving: boolean;
  isAddingDestination: boolean;
  isResettingDestination: boolean;
  isTemplateTab: boolean;
  templateHasChanges: boolean;
  templateValidationOk: boolean;
  templateValidationError: string | null;
  hasChanges: boolean;
  addGroupDestinationsAsync: (payload: { targetSocialAccountId: string }) => Promise<unknown>;
  setIsTemplateTab: (value: boolean) => void;
  handleSaveTemplate: () => Promise<boolean>;
  handleSaveChanges: () => Promise<boolean>;
  handleDestinationSwitch: (nextContentId: string) => Promise<void>;
};

type SingleActionParams = {
  multiDestinationEnabled: boolean;
  id?: string;
  isMultiDestinationGroup: boolean;
  selectedTargetSocialAccountId: string | null;
  disabled: boolean;
  isSaving: boolean;
  isAddingContentDestination: boolean;
  hasChanges: boolean;
  handleSaveChanges: () => Promise<boolean>;
  addContentDestinationsAsync: (payload: { targetSocialAccountId: string }) => Promise<unknown>;
  handleDestinationSwitch: (nextContentId: string) => Promise<void>;
};

function shouldSkipGroupAdd(params: GroupActionParams, normalizedId: string): boolean {
  if (
    !params.multiDestinationEnabled ||
    !params.isMultiDestinationGroup ||
    !params.contentGroupId
  ) {
    return true;
  }
  if (!normalizedId || params.groupDestinationSocialAccountIds.has(normalizedId)) {
    return true;
  }
  return (
    params.disabled ||
    params.groupHasPublishedDestinations ||
    params.isSaving ||
    params.isAddingDestination ||
    params.isResettingDestination
  );
}

async function ensureGroupStateIsSaved(params: GroupActionParams): Promise<boolean> {
  if (params.isTemplateTab && params.templateHasChanges) {
    if (!params.templateValidationOk) {
      toast.error(
        params.templateValidationError ||
          'Complete required fields before adding a new destination.'
      );
      return false;
    }
    return params.handleSaveTemplate();
  }
  if (!params.isTemplateTab && params.hasChanges) {
    return params.handleSaveChanges();
  }
  return true;
}

export function useGroupDestinationAddAction(params: GroupActionParams) {
  return useCallback(
    async (targetSocialAccountId: string) => {
      const normalized = (targetSocialAccountId || '').trim();
      if (shouldSkipGroupAdd(params, normalized)) {
        return;
      }
      if (!(await ensureGroupStateIsSaved(params))) {
        return;
      }

      try {
        const response: any = await params.addGroupDestinationsAsync({
          targetSocialAccountId: normalized,
        });
        const createdContentId = createdDestinationContentId(response, normalized);
        toast.success('Destination added');
        notifyDestinationSchedulingFailure(response);
        if (createdContentId) {
          params.setIsTemplateTab(false);
          await params.handleDestinationSwitch(createdContentId);
        }
      } catch (error: any) {
        toast.error(destinationErrorMessage(error, 'Failed to add destination'));
      }
    },
    [params]
  );
}

function shouldSkipSingleAdd(params: SingleActionParams, normalizedId: string): boolean {
  if (!params.multiDestinationEnabled || !params.id || params.isMultiDestinationGroup) {
    return true;
  }
  if (!normalizedId || normalizedId === params.selectedTargetSocialAccountId) {
    return true;
  }
  return params.disabled || params.isSaving || params.isAddingContentDestination;
}

export function useSingleDestinationAddAction(params: SingleActionParams) {
  return useCallback(
    async (targetSocialAccountId: string) => {
      const normalized = (targetSocialAccountId || '').trim();
      if (shouldSkipSingleAdd(params, normalized)) {
        return;
      }
      if (params.hasChanges && !(await params.handleSaveChanges())) {
        return;
      }

      try {
        const response: any = await params.addContentDestinationsAsync({
          targetSocialAccountId: normalized,
        });
        const createdContentId = createdDestinationContentId(response, normalized);
        toast.success('Destination added');
        notifyDestinationSchedulingFailure(response);
        if (createdContentId) {
          await params.handleDestinationSwitch(createdContentId);
        }
      } catch (error: any) {
        toast.error(destinationErrorMessage(error, 'Failed to add destination'));
      }
    },
    [params]
  );
}
