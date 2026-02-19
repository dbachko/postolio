import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';

import { content as contentApi } from '@/lib/api';
import { toUTCFromInput } from '@/lib/timezone';
import type { PostDetailData } from '@/hooks/usePostDetail';
import type { InstagramContentType } from '@postolio/content-validation';

import { formatScheduledInput } from '../utils';
import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';

export function usePostEditorSaveActions(params: {
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
  mutateContentAsync: (payload: {
    contentId: string;
    caption?: string;
    scheduledAt?: string | null;
    firstComment?: string;
    contentType?: InstagramContentType;
    shareToFeed?: boolean;
    targetSocialAccountId?: string | null;
  }) => Promise<unknown>;
  scheduleContentGroup: (scheduledAt: string | null) => Promise<unknown>;
  addToQueueAsync: () => Promise<unknown>;
  isQueueing: boolean;
  queueSupportedForPost: boolean;
  queueBlockerForPost?: string | null;
  queryClient: { invalidateQueries: (opts: { queryKey: unknown[] }) => Promise<unknown> };
}) {
  const {
    addToQueueAsync,
    brandTimezone,
    contentGroupSchedule,
    firstCommentOpen,
    formData,
    hasChanges,
    id,
    isMultiDestinationGroup,
    isQueueing,
    mutateContentAsync,
    post,
    queryClient,
    queueBlockerForPost,
    queueSupportedForPost,
    scheduleBlocker,
    scheduleContentGroup,
    selectedTargetSocialAccountId,
    validation,
    validationError,
  } = params;

  const mediaChanged = useMemo(() => {
    if (!post) return false;
    const formCarouselIds = (formData.carouselAssets || []).map((a) => a.id);
    const postCarouselIds = (post.mediaAssets || []).map((asset) => asset.assetId);
    return JSON.stringify(formCarouselIds) !== JSON.stringify(postCarouselIds);
  }, [formData.carouselAssets, post]);

  const persistMediaChanges = useCallback(async () => {
    if (!id || !mediaChanged) return;
    const assetIds = formData.carouselAssets.map((a) => a.id).filter(Boolean);
    const validAssetIds = assetIds.filter(
      (assetId) => typeof assetId === 'string' && !assetId.startsWith('http')
    );
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
  }, [formData.carouselAssets, id, mediaChanged, queryClient]);

  const handleSaveChanges = useCallback(async (): Promise<boolean> => {
    if (!id || !hasChanges) return true;

    if (!validation.ok) {
      toast.error(validationError || 'Please fix validation errors before saving');
      return false;
    }

    try {
      await persistMediaChanges();
    } catch {
      return false;
    }

    const hadScheduled = isMultiDestinationGroup
      ? contentGroupSchedule.kind !== 'none'
      : Boolean(post?.scheduledAt);
    const hasScheduledInput = Boolean(formData.scheduledAt);
    const scheduledValue = formData.scheduledAt || '';
    const originalScheduled = isMultiDestinationGroup
      ? contentGroupSchedule.kind === 'uniform'
        ? formatScheduledInput(contentGroupSchedule.scheduledAt, brandTimezone)
        : ''
      : formatScheduledInput(post?.scheduledAt, brandTimezone);
    const scheduleChanged = scheduledValue !== originalScheduled;

    if (scheduleChanged && !hadScheduled && hasScheduledInput && scheduleBlocker) {
      toast.error(scheduleBlocker);
      return false;
    }

    let scheduledAtPayload: string | null | undefined;
    if (!scheduleChanged) {
      scheduledAtPayload = undefined;
    } else if (!hasScheduledInput) {
      scheduledAtPayload = null;
    } else {
      const utcDate = toUTCFromInput(formData.scheduledAt, brandTimezone);
      if (utcDate.getTime() <= Date.now()) {
        toast.error('Scheduled time must be in the future');
        return false;
      }
      scheduledAtPayload = utcDate.toISOString();
    }

    const payload: {
      contentId: string;
      caption?: string;
      scheduledAt?: string | null;
      firstComment?: string;
      contentType?: InstagramContentType;
      shareToFeed?: boolean;
      targetSocialAccountId?: string | null;
    } = {
      contentId: id,
      caption: formData.contentType === 'story' ? '' : (formData.caption || '').trim(),
      firstComment:
        formData.contentType === 'story'
          ? ''
          : firstCommentOpen
            ? (formData.firstComment || '').trim()
            : '',
    };

    if (!isMultiDestinationGroup && scheduledAtPayload !== undefined) {
      payload.scheduledAt = scheduledAtPayload;
    }

    payload.contentType = formData.contentType;

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

    try {
      await mutateContentAsync(payload);
      if (isMultiDestinationGroup && scheduledAtPayload !== undefined) {
        await scheduleContentGroup(scheduledAtPayload);
      }
      return true;
    } catch {
      return false;
    }
  }, [
    brandTimezone,
    contentGroupSchedule.kind,
    contentGroupSchedule.scheduledAt,
    firstCommentOpen,
    formData.caption,
    formData.contentType,
    formData.firstComment,
    formData.scheduledAt,
    formData.shareToFeed,
    hasChanges,
    id,
    isMultiDestinationGroup,
    mutateContentAsync,
    persistMediaChanges,
    post?.scheduledAt,
    post?.targetSocialAccountId,
    scheduleBlocker,
    scheduleContentGroup,
    selectedTargetSocialAccountId,
    validation.ok,
    validationError,
  ]);

  const moveToQueue = useCallback(async (): Promise<void> => {
    if (isQueueing) return;
    if (!queueSupportedForPost) {
      toast.error(queueBlockerForPost || 'Queue scheduling is not available for this post.');
      return;
    }
    if (!validation.ok) {
      toast.error(validationError || 'Please fix validation errors before continuing.');
      return;
    }

    try {
      if (isMultiDestinationGroup) {
        if (contentGroupSchedule.kind !== 'none') {
          await scheduleContentGroup(null);
        }
      } else if (id && post?.scheduledAt) {
        await contentApi.updateContent({
          contentId: id,
          scheduledAt: null,
        });
        await queryClient.invalidateQueries({ queryKey: ['post', id] });
        const brandId = post?.brand?.id ?? null;
        if (brandId) {
          await queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
          await queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
        }
      }

      await addToQueueAsync();
    } catch (error: any) {
      const message =
        error?.response?.data?.error ||
        error?.message ||
        'Failed to move post to the next available slot. Please try again.';
      toast.error(message);
    }
  }, [
    addToQueueAsync,
    contentGroupSchedule.kind,
    id,
    isMultiDestinationGroup,
    isQueueing,
    post?.brand?.id,
    post?.scheduledAt,
    queryClient,
    queueBlockerForPost,
    queueSupportedForPost,
    scheduleContentGroup,
    validation.ok,
    validationError,
  ]);

  return { handleSaveChanges, moveToQueue };
}
