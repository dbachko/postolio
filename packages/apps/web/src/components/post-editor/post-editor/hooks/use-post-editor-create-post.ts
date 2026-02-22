import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCallback } from 'react';

import { content as contentApi, publishingQueues as publishingQueuesApi } from '@/lib/api';
import { toUTCFromInput } from '@/lib/timezone';

import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';

import type { PostEditorLayout } from '../types';
import { getQueueErrorMessage, getScheduleErrorMessage } from '../utils';

export function usePostEditorCreatePost(params: {
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
}) {
  const {
    brandTimezone,
    firstCommentOpen,
    formData,
    layout,
    multiDestinationEnabled,
    navigate,
    onRequestClose,
    openSidebar,
    selectedBrand,
    selectedPlatformAccountIds,
  } = params;

  const queryClient = useQueryClient();

  const { mutate: createPost, isPending: isCreatingPost } = useMutation({
    mutationFn: async (mode: 'draft' | 'schedule' | 'queue' | 'now') => {
      if (!selectedBrand) {
        throw new Error('No brand selected');
      }

      const isStory = formData.contentType === 'story';
      const scheduledUtc =
        mode === 'schedule' && formData.scheduledAt
          ? toUTCFromInput(formData.scheduledAt, brandTimezone)
          : null;

      if (mode === 'schedule') {
        if (!scheduledUtc) {
          throw new Error('Scheduled time required');
        }
        if (scheduledUtc.getTime() <= Date.now()) {
          throw new Error('Scheduled time must be in the future');
        }
      }

      const response = await contentApi.createManualContent({
        brandId: selectedBrand.id,
        caption: isStory ? '' : formData.caption.trim(),
        assetIds: formData.carouselAssets.map((a) => a.id),
        contentType: formData.contentType,
        shareToFeed: formData.contentType === 'reel' ? formData.shareToFeed : undefined,
        firstComment:
          isStory || !firstCommentOpen ? undefined : (formData.firstComment || '').trim(),
        scheduledAt: scheduledUtc ? scheduledUtc.toISOString() : undefined,
        targetSocialAccountIds: multiDestinationEnabled
          ? selectedPlatformAccountIds
          : selectedPlatformAccountIds.slice(0, 1),
      });

      if (mode !== 'queue' && mode !== 'now') {
        return { response, mode, queued: null as any, publishedNow: null as any };
      }

      const groupId =
        typeof (response as any)?.contentGroupId === 'string' &&
        String((response as any).contentGroupId).trim().length > 0
          ? String((response as any).contentGroupId).trim()
          : null;

      if (mode === 'queue') {
        try {
          if (groupId) {
            await contentApi.queueContentGroup(groupId);
            return { response, mode, queued: { success: true }, publishedNow: null as any };
          }

          const contentId =
            typeof (response as any)?.content?.id === 'string'
              ? String((response as any).content.id)
              : null;
          const targetSocialAccountId =
            typeof (response as any)?.content?.targetSocialAccountId === 'string'
              ? String((response as any).content.targetSocialAccountId)
              : selectedPlatformAccountIds[0] || null;

          if (!contentId || !targetSocialAccountId) {
            return {
              response,
              mode,
              queued: { success: false, error: 'missing_destination' },
              publishedNow: null as any,
            };
          }

          const queues =
            await publishingQueuesApi.listQueuesForSocialAccount(targetSocialAccountId);
          const list = Array.isArray((queues as any)?.data?.queues)
            ? (queues as any).data.queues
            : [];
          const defaultQueue = list.find((q: any) => q?.isDefault) || list[0] || null;
          if (!defaultQueue?.id) {
            return {
              response,
              mode,
              queued: { success: false, error: 'missing_queue' },
              publishedNow: null as any,
            };
          }

          await publishingQueuesApi.addQueueItem(String(defaultQueue.id), contentId);
          return { response, mode, queued: { success: true }, publishedNow: null as any };
        } catch (error) {
          return { response, mode, queued: { success: false, error }, publishedNow: null as any };
        }
      }

      try {
        if (groupId) {
          await contentApi.publishContentGroupNow(groupId);
          return { response, mode, queued: null as any, publishedNow: { success: true } };
        }

        const contentId =
          typeof (response as any)?.content?.id === 'string'
            ? String((response as any).content.id)
            : Array.isArray((response as any)?.contents) &&
                typeof (response as any).contents[0]?.id === 'string'
              ? String((response as any).contents[0].id)
              : null;
        if (!contentId) {
          return {
            response,
            mode,
            queued: null as any,
            publishedNow: { success: false, error: 'missing_content' },
          };
        }

        await contentApi.publishNow(contentId);
        return { response, mode, queued: null as any, publishedNow: { success: true } };
      } catch (error) {
        return { response, mode, queued: null as any, publishedNow: { success: false, error } };
      }
    },
    onSuccess: (result: any) => {
      const response = result?.response;
      const mode = result?.mode as 'draft' | 'schedule' | 'queue' | 'now';
      queryClient.invalidateQueries({ queryKey: ['content'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['drafts'] });

      const isScheduled = mode === 'schedule';

      let message = 'Post created successfully!';
      if (mode === 'queue') {
        message = 'Added to queue';
      } else if (mode === 'now') {
        message = 'Publishing started';
      } else if (isScheduled) {
        message = 'Scheduling started';
      }

      if (mode === 'queue') {
        const queued = result?.queued;
        if (queued?.success) {
          toast.success(message, {
            description: 'We’ll auto-schedule it into upcoming slots.',
          });
        } else {
          toast.error(getQueueErrorMessage(queued?.error), {
            description: 'Your post was created as a draft (not queued).',
          });
        }
      } else if (mode === 'now') {
        const published = result?.publishedNow;
        if (published?.success) {
          toast.success(message, {
            description: 'We’re publishing it now.',
          });
        } else {
          toast.error(getScheduleErrorMessage(published?.error, 'Failed to publish now.'), {
            description: 'Your post was created as a draft (not published).',
          });
        }
      } else {
        toast.success(message, {
          description: isScheduled
            ? 'Scheduling started. You can keep editing while we prepare it.'
            : 'Draft created. You can keep editing it here.',
        });
      }

      const createdContentId =
        typeof response?.content?.id === 'string'
          ? response.content.id
          : Array.isArray(response?.contents) && typeof response.contents[0]?.id === 'string'
            ? response.contents[0].id
            : null;

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
    },
    onError: (error: any) => {
      console.error('Failed to create post:', error);
      toast.error(getScheduleErrorMessage(error, 'Failed to create post. Please try again.'));
    },
  });

  const createPostWithMode = useCallback(
    (mode: 'draft' | 'schedule' | 'queue' | 'now') => createPost(mode),
    [createPost]
  );

  return { createPost: createPostWithMode, isCreatingPost };
}
