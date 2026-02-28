import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';

import type { InstagramContentType } from '@postolio/content-validation';

import { content as contentApi } from '@/lib/api';
import { toUTCFromInput } from '@/lib/timezone';
import type { PostDetailData } from '@/hooks/usePostDetail';
import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';

import { formatScheduledInput } from '../utils';

type MutationPayload = {
  contentId: string;
  caption?: string;
  scheduledAt?: string | null;
  firstComment?: string;
  contentType?: InstagramContentType;
  shareToFeed?: boolean;
  targetSocialAccountId?: string | null;
};

type UsePostEditorSaveActionsParams = {
  id?: string;
  post: PostDetailData | undefined;
  brandTimezone: string;
  isMultiDestinationGroup: boolean;
  contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
  formData: PostEditorFormState;
  hasChanges: boolean;
  firstCommentOpen: boolean;
  selectedTargetSocialAccountId: string | null;
  scheduleBlocker: string | null;
  validation: { ok: boolean };
  validationError: string | null;
  mutateContentAsync: (payload: MutationPayload) => Promise<unknown>;
  scheduleContentGroup: (scheduledAt: string | null) => Promise<unknown>;
  addToQueueAsync: () => Promise<unknown>;
  isQueueing: boolean;
  queueSupportedForPost: boolean;
  queueBlockerForPost?: string | null;
  queryClient: { invalidateQueries: (opts: { queryKey: unknown[] }) => Promise<unknown> };
};

function buildSchedulePayload(params: {
  formData: PostEditorFormState;
  post: PostDetailData | undefined;
  isMultiDestinationGroup: boolean;
  contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
  brandTimezone: string;
  scheduleBlocker: string | null;
}): { ok: true; scheduledAtPayload: string | null | undefined } | { ok: false } {
  const {
    formData,
    post,
    isMultiDestinationGroup,
    contentGroupSchedule,
    brandTimezone,
    scheduleBlocker,
  } = params;
  const hadScheduled = isMultiDestinationGroup
    ? contentGroupSchedule.kind !== 'none'
    : Boolean(post?.scheduledAt);
  const hasScheduledInput = Boolean(formData.scheduledAt);
  const scheduledValue = formData.scheduledAt || '';
  let originalScheduled = formatScheduledInput(post?.scheduledAt, brandTimezone);
  if (isMultiDestinationGroup) {
    originalScheduled =
      contentGroupSchedule.kind === 'uniform'
        ? formatScheduledInput(contentGroupSchedule.scheduledAt, brandTimezone)
        : '';
  }
  const scheduleChanged = scheduledValue !== originalScheduled;

  if (scheduleChanged && !hadScheduled && hasScheduledInput && scheduleBlocker) {
    toast.error(scheduleBlocker);
    return { ok: false };
  }
  if (!scheduleChanged) {
    return { ok: true, scheduledAtPayload: undefined };
  }
  if (!hasScheduledInput) {
    return { ok: true, scheduledAtPayload: null };
  }

  const utcDate = toUTCFromInput(formData.scheduledAt, brandTimezone);
  if (utcDate.getTime() <= Date.now()) {
    toast.error('Scheduled time must be in the future');
    return { ok: false };
  }
  return { ok: true, scheduledAtPayload: utcDate.toISOString() };
}

function buildContentUpdatePayload(params: {
  id: string;
  formData: PostEditorFormState;
  firstCommentOpen: boolean;
  isMultiDestinationGroup: boolean;
  selectedTargetSocialAccountId: string | null;
  post: PostDetailData | undefined;
  scheduledAtPayload: string | null | undefined;
}): MutationPayload {
  const {
    id,
    formData,
    firstCommentOpen,
    isMultiDestinationGroup,
    selectedTargetSocialAccountId,
    post,
    scheduledAtPayload,
  } = params;
  let firstComment = '';
  if (formData.contentType !== 'story' && firstCommentOpen) {
    firstComment = (formData.firstComment || '').trim();
  }

  const payload: MutationPayload = {
    contentId: id,
    caption: formData.contentType === 'story' ? '' : (formData.caption || '').trim(),
    firstComment,
    contentType: formData.contentType,
  };

  if (!isMultiDestinationGroup && scheduledAtPayload !== undefined) {
    payload.scheduledAt = scheduledAtPayload;
  }
  if (formData.contentType === 'reel') {
    payload.shareToFeed = formData.shareToFeed;
  }

  const postTargetSocialAccountId =
    typeof post?.targetSocialAccountId === 'string' && post.targetSocialAccountId.trim()
      ? post.targetSocialAccountId
      : null;
  if (selectedTargetSocialAccountId !== postTargetSocialAccountId) {
    payload.targetSocialAccountId = selectedTargetSocialAccountId;
  }

  return payload;
}

async function persistPostMediaChanges(params: {
  id?: string;
  mediaChanged: boolean;
  formData: PostEditorFormState;
  queryClient: { invalidateQueries: (opts: { queryKey: unknown[] }) => Promise<unknown> };
}): Promise<void> {
  const { id, mediaChanged, formData, queryClient } = params;
  if (!id || !mediaChanged) {
    return;
  }

  const validAssetIds = formData.carouselAssets
    .map((asset) => asset.id)
    .filter((assetId) => typeof assetId === 'string' && !assetId.startsWith('http'));
  if (!validAssetIds.length) {
    toast.error('Media is missing asset IDs. Please re-select it from the Assets library.');
    throw new Error('Missing asset IDs for media update');
  }

  try {
    await contentApi.updateMedia(id, validAssetIds);
    await queryClient.invalidateQueries({ queryKey: ['post', id] });
  } catch (error) {
    console.error('Failed to update post media', error);
    toast.error('Failed to update post media. Please try again.');
    throw error;
  }
}

async function clearExistingScheduleBeforeQueue(params: {
  id?: string;
  post: PostDetailData | undefined;
  isMultiDestinationGroup: boolean;
  contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
  scheduleContentGroup: (scheduledAt: string | null) => Promise<unknown>;
  queryClient: { invalidateQueries: (opts: { queryKey: unknown[] }) => Promise<unknown> };
}): Promise<void> {
  const {
    id,
    post,
    isMultiDestinationGroup,
    contentGroupSchedule,
    scheduleContentGroup,
    queryClient,
  } = params;
  if (isMultiDestinationGroup) {
    if (contentGroupSchedule.kind !== 'none') {
      await scheduleContentGroup(null);
    }
    return;
  }

  if (!id || !post?.scheduledAt) {
    return;
  }

  await contentApi.updateContent({ contentId: id, scheduledAt: null });
  await queryClient.invalidateQueries({ queryKey: ['post', id] });
  const brandId = post?.brand?.id ?? null;
  if (!brandId) {
    return;
  }
  await queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
  await queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
}

function getQueueMoveErrorMessage(error: any): string {
  return (
    error?.response?.data?.error ||
    error?.message ||
    'Failed to move post to the next available slot. Please try again.'
  );
}

function useMediaChanged(formData: PostEditorFormState, post: PostDetailData | undefined): boolean {
  return useMemo(() => {
    if (!post) {
      return false;
    }
    const formCarouselIds = (formData.carouselAssets || []).map((asset) => asset.id);
    const postCarouselIds = (post.mediaAssets || []).map((asset) => asset.assetId);
    return JSON.stringify(formCarouselIds) !== JSON.stringify(postCarouselIds);
  }, [formData.carouselAssets, post]);
}

type UseHandleSaveChangesParams = UsePostEditorSaveActionsParams & { mediaChanged: boolean };

async function persistContentChanges(params: {
  id: string;
  formData: PostEditorFormState;
  firstCommentOpen: boolean;
  isMultiDestinationGroup: boolean;
  selectedTargetSocialAccountId: string | null;
  post: PostDetailData | undefined;
  scheduledAtPayload: string | null | undefined;
  mutateContentAsync: (payload: MutationPayload) => Promise<unknown>;
  scheduleContentGroup: (scheduledAt: string | null) => Promise<unknown>;
}): Promise<boolean> {
  const payload = buildContentUpdatePayload({
    id: params.id,
    formData: params.formData,
    firstCommentOpen: params.firstCommentOpen,
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    selectedTargetSocialAccountId: params.selectedTargetSocialAccountId,
    post: params.post,
    scheduledAtPayload: params.scheduledAtPayload,
  });

  try {
    await params.mutateContentAsync(payload);
    if (params.isMultiDestinationGroup && params.scheduledAtPayload !== undefined) {
      await params.scheduleContentGroup(params.scheduledAtPayload);
    }
    return true;
  } catch {
    return false;
  }
}

function useHandleSaveChanges(params: UseHandleSaveChangesParams) {
  const {
    id,
    post,
    brandTimezone,
    isMultiDestinationGroup,
    contentGroupSchedule,
    formData,
    hasChanges,
    firstCommentOpen,
    selectedTargetSocialAccountId,
    scheduleBlocker,
    validation,
    validationError,
    mutateContentAsync,
    scheduleContentGroup,
    queryClient,
    mediaChanged,
  } = params;
  const validationOk = validation.ok;

  return useCallback(async (): Promise<boolean> => {
    if (!id || !hasChanges) {
      return true;
    }
    if (!validationOk) {
      toast.error(validationError || 'Please fix validation errors before saving');
      return false;
    }

    try {
      await persistPostMediaChanges({ id, mediaChanged, formData, queryClient });
    } catch {
      return false;
    }

    const schedule = buildSchedulePayload({
      formData,
      post,
      isMultiDestinationGroup,
      contentGroupSchedule,
      brandTimezone,
      scheduleBlocker,
    });
    if (!schedule.ok) {
      return false;
    }

    return persistContentChanges({
      id,
      formData,
      firstCommentOpen,
      isMultiDestinationGroup,
      selectedTargetSocialAccountId,
      post,
      scheduledAtPayload: schedule.scheduledAtPayload,
      mutateContentAsync,
      scheduleContentGroup,
    });
  }, [
    brandTimezone,
    contentGroupSchedule,
    firstCommentOpen,
    formData,
    hasChanges,
    id,
    isMultiDestinationGroup,
    mediaChanged,
    mutateContentAsync,
    post,
    queryClient,
    scheduleBlocker,
    scheduleContentGroup,
    selectedTargetSocialAccountId,
    validationError,
    validationOk,
  ]);
}

function useMoveToQueue(params: UsePostEditorSaveActionsParams) {
  const {
    id,
    post,
    isMultiDestinationGroup,
    contentGroupSchedule,
    scheduleContentGroup,
    addToQueueAsync,
    isQueueing,
    queueSupportedForPost,
    queueBlockerForPost,
    validation,
    validationError,
    queryClient,
  } = params;
  const validationOk = validation.ok;

  return useCallback(async (): Promise<void> => {
    if (isQueueing) {
      return;
    }
    if (!queueSupportedForPost) {
      toast.error(queueBlockerForPost || 'Queue scheduling is not available for this post.');
      return;
    }
    if (!validationOk) {
      toast.error(validationError || 'Please fix validation errors before continuing.');
      return;
    }

    try {
      await clearExistingScheduleBeforeQueue({
        id,
        post,
        isMultiDestinationGroup,
        contentGroupSchedule,
        scheduleContentGroup,
        queryClient,
      });
      await addToQueueAsync();
    } catch (error: any) {
      toast.error(getQueueMoveErrorMessage(error));
    }
  }, [
    addToQueueAsync,
    contentGroupSchedule,
    id,
    isMultiDestinationGroup,
    isQueueing,
    post,
    queryClient,
    queueBlockerForPost,
    queueSupportedForPost,
    scheduleContentGroup,
    validationError,
    validationOk,
  ]);
}

export function usePostEditorSaveActions(params: UsePostEditorSaveActionsParams) {
  const mediaChanged = useMediaChanged(params.formData, params.post);
  const handleSaveChanges = useHandleSaveChanges({ ...params, mediaChanged });
  const moveToQueue = useMoveToQueue(params);

  return { handleSaveChanges, moveToQueue };
}
