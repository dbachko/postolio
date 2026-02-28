import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { content as contentApi, publishingQueues as publishingQueuesApi } from '@/lib/api';
import { toUTCFromInput } from '@/lib/timezone';
import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';

import type { PostEditorLayout } from '../types';
import { getQueueErrorMessage, getScheduleErrorMessage } from '../utils';

type CreateMode = 'draft' | 'schedule' | 'queue' | 'now';

type CreatePostResult = {
  response: any;
  mode: CreateMode;
  queued: { success: boolean; error?: unknown } | null;
  publishedNow: { success: boolean; error?: unknown } | null;
};

type UsePostEditorCreatePostParams = {
  layout: PostEditorLayout;
  onRequestClose?: () => void;
  selectedBrand: { id: string } | null;
  brandTimezone: string;
  formData: PostEditorFormState;
  firstCommentOpen: boolean;
  selectedPlatformAccountIds: string[];
  multiDestinationEnabled: boolean;
  openSidebar: (type: string, params: Record<string, unknown>) => void;
  navigate: (to: string) => void;
};

function getScheduledUtc(
  mode: CreateMode,
  scheduledAt: string,
  brandTimezone: string
): Date | null {
  if (mode !== 'schedule' || !scheduledAt) {
    return null;
  }
  return toUTCFromInput(scheduledAt, brandTimezone);
}

function validateScheduledUtc(mode: CreateMode, scheduledUtc: Date | null): void {
  if (mode !== 'schedule') {
    return;
  }
  if (!scheduledUtc) {
    throw new Error('Scheduled time required');
  }
  if (scheduledUtc.getTime() <= Date.now()) {
    throw new Error('Scheduled time must be in the future');
  }
}

function resolveTargetSocialAccountIds(
  multiDestinationEnabled: boolean,
  selectedPlatformAccountIds: string[]
): string[] {
  return multiDestinationEnabled
    ? selectedPlatformAccountIds
    : selectedPlatformAccountIds.slice(0, 1);
}

function getResponseGroupId(response: any): string | null {
  const raw =
    typeof response?.contentGroupId === 'string' ? String(response.contentGroupId).trim() : '';
  return raw.length > 0 ? raw : null;
}

function getResponseContentId(response: any): string | null {
  if (typeof response?.content?.id === 'string') {
    return String(response.content.id);
  }
  if (Array.isArray(response?.contents) && typeof response.contents[0]?.id === 'string') {
    return String(response.contents[0].id);
  }
  return null;
}

function resolveQueueTarget(params: {
  response: any;
  selectedPlatformAccountIds: string[];
}): { contentId: string; targetSocialAccountId: string } | null {
  const contentId =
    typeof params.response?.content?.id === 'string' ? String(params.response.content.id) : null;
  const targetSocialAccountId =
    typeof params.response?.content?.targetSocialAccountId === 'string'
      ? String(params.response.content.targetSocialAccountId)
      : params.selectedPlatformAccountIds[0] || null;
  if (!contentId || !targetSocialAccountId) {
    return null;
  }
  return { contentId, targetSocialAccountId };
}

function resolveDefaultQueueId(queues: any): string | null {
  const queueList = Array.isArray((queues as any)?.data?.queues) ? (queues as any).data.queues : [];
  const defaultQueue = queueList.find((queue: any) => queue?.isDefault) || queueList[0] || null;
  return defaultQueue?.id ? String(defaultQueue.id) : null;
}

async function queueCreatedPost(params: {
  response: any;
  selectedPlatformAccountIds: string[];
}): Promise<{ success: boolean; error?: unknown }> {
  const { response, selectedPlatformAccountIds } = params;
  const groupId = getResponseGroupId(response);
  if (groupId) {
    await contentApi.queueContentGroup(groupId);
    return { success: true };
  }

  const target = resolveQueueTarget({ response, selectedPlatformAccountIds });
  if (!target) {
    return { success: false, error: 'missing_destination' };
  }

  const queues = await publishingQueuesApi.listQueuesForSocialAccount(target.targetSocialAccountId);
  const defaultQueueId = resolveDefaultQueueId(queues);
  if (!defaultQueueId) {
    return { success: false, error: 'missing_queue' };
  }

  await publishingQueuesApi.addQueueItem(defaultQueueId, target.contentId);
  return { success: true };
}

async function publishCreatedPostNow(
  response: any
): Promise<{ success: boolean; error?: unknown }> {
  const groupId = getResponseGroupId(response);
  if (groupId) {
    await contentApi.publishContentGroupNow(groupId);
    return { success: true };
  }

  const contentId = getResponseContentId(response);
  if (!contentId) {
    return { success: false, error: 'missing_content' };
  }

  await contentApi.publishNow(contentId);
  return { success: true };
}

function buildSuccessMessage(mode: CreateMode): string {
  if (mode === 'queue') {
    return 'Added to queue';
  }
  if (mode === 'now') {
    return 'Publishing started';
  }
  if (mode === 'schedule') {
    return 'Scheduling started';
  }
  return 'Post created successfully!';
}

function showSuccessToast(mode: CreateMode, result: CreatePostResult): void {
  const message = buildSuccessMessage(mode);
  if (mode === 'queue') {
    if (result.queued?.success) {
      toast.success(message, { description: 'We’ll auto-schedule it into upcoming slots.' });
      return;
    }
    toast.error(getQueueErrorMessage(result.queued?.error), {
      description: 'Your post was created as a draft (not queued).',
    });
    return;
  }

  if (mode === 'now') {
    if (result.publishedNow?.success) {
      toast.success(message, { description: 'We’re publishing it now.' });
      return;
    }
    toast.error(getScheduleErrorMessage(result.publishedNow?.error, 'Failed to publish now.'), {
      description: 'Your post was created as a draft (not published).',
    });
    return;
  }

  toast.success(message, {
    description:
      mode === 'schedule'
        ? 'Scheduling started. You can keep editing while we prepare it.'
        : 'Draft created. You can keep editing it here.',
  });
}

function handlePostCreateNavigation(params: {
  response: any;
  layout: PostEditorLayout;
  openSidebar: (type: string, params: Record<string, unknown>) => void;
  navigate: (to: string) => void;
  onRequestClose?: () => void;
}): void {
  const { response, layout, openSidebar, navigate, onRequestClose } = params;
  const createdContentId = getResponseContentId(response);
  if (createdContentId) {
    if (layout === 'sidebar') {
      openSidebar('post', { id: createdContentId });
      return;
    }
    navigate(`/posts/${createdContentId}`);
    return;
  }
  navigate('/content');
  onRequestClose?.();
}

async function executeCreatePostMutation(params: {
  mode: CreateMode;
  selectedBrand: { id: string } | null;
  formData: PostEditorFormState;
  brandTimezone: string;
  firstCommentOpen: boolean;
  multiDestinationEnabled: boolean;
  selectedPlatformAccountIds: string[];
}): Promise<CreatePostResult> {
  const {
    mode,
    selectedBrand,
    formData,
    brandTimezone,
    firstCommentOpen,
    multiDestinationEnabled,
    selectedPlatformAccountIds,
  } = params;
  if (!selectedBrand) {
    throw new Error('No brand selected');
  }

  const scheduledUtc = getScheduledUtc(mode, formData.scheduledAt, brandTimezone);
  validateScheduledUtc(mode, scheduledUtc);
  const isStory = formData.contentType === 'story';

  const response = await contentApi.createManualContent({
    brandId: selectedBrand.id,
    caption: isStory ? '' : formData.caption.trim(),
    assetIds: formData.carouselAssets.map((asset) => asset.id),
    contentType: formData.contentType,
    shareToFeed: formData.contentType === 'reel' ? formData.shareToFeed : undefined,
    firstComment: isStory || !firstCommentOpen ? undefined : (formData.firstComment || '').trim(),
    scheduledAt: scheduledUtc ? scheduledUtc.toISOString() : undefined,
    targetSocialAccountIds: resolveTargetSocialAccountIds(
      multiDestinationEnabled,
      selectedPlatformAccountIds
    ),
  });

  if (mode === 'queue') {
    try {
      return {
        response,
        mode,
        queued: await queueCreatedPost({ response, selectedPlatformAccountIds }),
        publishedNow: null,
      };
    } catch (error) {
      return { response, mode, queued: { success: false, error }, publishedNow: null };
    }
  }

  if (mode === 'now') {
    try {
      return { response, mode, queued: null, publishedNow: await publishCreatedPostNow(response) };
    } catch (error) {
      return { response, mode, queued: null, publishedNow: { success: false, error } };
    }
  }

  return { response, mode, queued: null, publishedNow: null };
}

export function usePostEditorCreatePost(params: UsePostEditorCreatePostParams) {
  const {
    layout,
    onRequestClose,
    selectedBrand,
    brandTimezone,
    formData,
    firstCommentOpen,
    selectedPlatformAccountIds,
    multiDestinationEnabled,
    openSidebar,
    navigate,
  } = params;
  const queryClient = useQueryClient();

  const { mutate: createPost, isPending: isCreatingPost } = useMutation({
    mutationFn: (mode: CreateMode) =>
      executeCreatePostMutation({
        mode,
        selectedBrand,
        formData,
        brandTimezone,
        firstCommentOpen,
        multiDestinationEnabled,
        selectedPlatformAccountIds,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['content'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      showSuccessToast(result.mode, result);
      handlePostCreateNavigation({
        response: result.response,
        layout,
        openSidebar,
        navigate,
        onRequestClose,
      });
    },
    onError: (error: any) => {
      console.error('Failed to create post:', error);
      toast.error(getScheduleErrorMessage(error, 'Failed to create post. Please try again.'));
    },
  });

  const createPostWithMode = useCallback((mode: CreateMode) => createPost(mode), [createPost]);
  return { createPost: createPostWithMode, isCreatingPost };
}
