import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { content as contentApi, publishingQueues as publishingQueuesApi } from '@/lib/api';
import type { PostDetailData } from '@/hooks/usePostDetail';
import type { InstagramContentType } from '@postolio/content-validation';

import { getQueueErrorMessage, getScheduleErrorMessage } from '../utils';

export function usePostEditorMutations(params: {
  id?: string;
  contentGroupId: string | null;
  isMultiDestinationGroup: boolean;
  groupDestinations: Array<{ contentId: string }>;
  post: PostDetailData | undefined;
  selectedBrandId: string | null;
  onRequestClose?: () => void;
  setHasChanges: (value: boolean) => void;
  setTemplateHasChanges: (value: boolean) => void;
}) {
  const {
    contentGroupId,
    groupDestinations,
    id,
    isMultiDestinationGroup,
    onRequestClose,
    post,
    selectedBrandId,
    setHasChanges,
    setTemplateHasChanges,
  } = params;

  const queryClient = useQueryClient();

  const { mutateAsync: mutateContentAsync, isPending: isSaving } = useMutation({
    mutationFn: async (data: {
      contentId: string;
      caption?: string;
      scheduledAt?: string | null;
      campaignId?: string | null;
      firstComment?: string;
      contentType?: InstagramContentType;
      shareToFeed?: boolean;
      targetSocialAccountId?: string | null;
    }) => contentApi.updateContent(data),
    onSuccess: (response) => {
      queryClient.setQueryData(['post', id], (oldData: PostDetailData | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          ...response.content,
          status: response.content?.status || oldData.status,
        } as PostDetailData;
      });
      setHasChanges(false);
    },
    onError: () => toast.error('Failed to save changes'),
  });

  const { mutateAsync: saveTemplateAsync, isPending: isSavingTemplate } = useMutation({
    mutationFn: async (payload: {
      caption: string;
      contentType: InstagramContentType;
      shareToFeed?: boolean | null;
      firstComment?: string | null;
      thumbOffset?: number | null;
      assetIds?: string[];
    }) => {
      if (!contentGroupId) throw new Error('Missing contentGroupId');
      return contentApi.updateContentGroupTemplate(contentGroupId, payload);
    },
    onSuccess: (response: any) => {
      if (!contentGroupId) return;
      queryClient.setQueryData(['content-group', contentGroupId], (oldData: any) => {
        if (!oldData) return oldData;
        const nextTemplate = response?.contentGroup?.template;
        if (!nextTemplate) return oldData;
        return {
          ...oldData,
          contentGroup: {
            ...oldData.contentGroup,
            ...response.contentGroup,
            template: nextTemplate,
          },
        };
      });
      setTemplateHasChanges(false);
      toast.success('Template saved');
    },
    onError: (error: any) =>
      toast.error(getScheduleErrorMessage(error, 'Failed to save template. Please try again.')),
  });

  const { mutateAsync: applyTemplateAsync, isPending: isApplyingTemplate } = useMutation({
    mutationFn: async () => {
      if (!contentGroupId) throw new Error('Missing contentGroupId');
      return contentApi.applyContentGroupTemplate(contentGroupId);
    },
    onSuccess: () => {
      if (!contentGroupId) return;
      toast.success('Template applied to destinations');
      queryClient.invalidateQueries({ queryKey: ['content-group', contentGroupId] });
      for (const dest of groupDestinations) {
        queryClient.invalidateQueries({ queryKey: ['post', dest.contentId] });
      }
      const brandId = post?.brand?.id ?? selectedBrandId ?? null;
      if (brandId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
      }
    },
    onError: (error: any) =>
      toast.error(getScheduleErrorMessage(error, 'Failed to apply template. Please try again.')),
  });

  const { mutateAsync: resetDestinationAsync, isPending: isResettingDestination } = useMutation({
    mutationFn: async () => {
      if (!contentGroupId) throw new Error('Missing contentGroupId');
      if (!id) throw new Error('Missing contentId');
      return contentApi.resetGroupDestinationToTemplate(contentGroupId, id);
    },
    onSuccess: () => {
      if (!contentGroupId || !id) return;
      toast.success('Destination reset to template');
      queryClient.invalidateQueries({ queryKey: ['content-group', contentGroupId] });
      queryClient.invalidateQueries({ queryKey: ['post', id] });
      const brandId = post?.brand?.id ?? selectedBrandId ?? null;
      if (brandId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
      }
    },
    onError: (error: any) =>
      toast.error(getScheduleErrorMessage(error, 'Failed to reset destination. Please try again.')),
  });

  const { mutateAsync: addGroupDestinationsAsync, isPending: isAddingDestination } = useMutation({
    mutationFn: async (payload: { targetSocialAccountId: string }) => {
      if (!contentGroupId) throw new Error('Missing contentGroupId');
      return contentApi.addContentGroupDestinations(contentGroupId, [
        payload.targetSocialAccountId,
      ]);
    },
    onSuccess: () => {
      if (!contentGroupId) return;
      queryClient.invalidateQueries({ queryKey: ['content-group', contentGroupId] });
    },
  });

  const { mutateAsync: addContentDestinationsAsync, isPending: isAddingContentDestination } =
    useMutation({
      mutationFn: async (payload: { targetSocialAccountId: string }) => {
        if (!id) throw new Error('Missing contentId');
        return contentApi.addContentDestinations(id, [payload.targetSocialAccountId]);
      },
      onSuccess: (response: any) => {
        const groupId =
          typeof response?.contentGroupId === 'string' && response.contentGroupId.trim()
            ? response.contentGroupId.trim()
            : null;
        if (groupId) {
          queryClient.invalidateQueries({ queryKey: ['content-group', groupId] });
        }
        if (id) {
          queryClient.invalidateQueries({ queryKey: ['post', id] });
        }
        const brandId = post?.brand?.id ?? selectedBrandId ?? null;
        if (brandId) {
          queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
          queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
        }
      },
    });

  const { mutate: unschedulePost, isPending: isUnscheduling } = useMutation({
    mutationFn: async (contentId: string) => {
      return contentApi.updateContent({
        contentId,
        scheduledAt: null,
      });
    },
    onSuccess: (response, contentId) => {
      toast.success('Post unscheduled and moved to Drafts');
      queryClient.setQueryData(['post', contentId], (oldData: PostDetailData | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          ...response.content,
          status: response.content?.status || 'draft',
        } as PostDetailData;
      });

      const brandId = response.content?.brandId || post?.brand?.id;
      if (brandId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
      }
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-items-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-items'] });
      setHasChanges(false);
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error ||
        error?.message ||
        'Failed to unschedule post. Please try again.';
      toast.error(message);
    },
  });

  const { mutateAsync: deletePostAsync, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Missing contentId');
      return contentApi.deletePost(id);
    },
    onSuccess: async () => {
      toast.success('Post deleted');
      const brandId = post?.brand?.id ?? selectedBrandId ?? null;
      if (brandId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['calendar'] });
        queryClient.invalidateQueries({ queryKey: ['drafts'] });
      }
      queryClient.invalidateQueries({ queryKey: ['content'] });
      queryClient.invalidateQueries({ queryKey: ['post', id] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-items-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-items'] });
      onRequestClose?.();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to delete post.';
      toast.error(message);
    },
  });

  const { mutateAsync: publishNowAsync, isPending: isPublishingNow } = useMutation({
    mutationFn: async () => {
      if (isMultiDestinationGroup) {
        if (!contentGroupId) throw new Error('Missing contentGroupId');
        return contentApi.publishContentGroupNow(contentGroupId);
      }
      if (!id) throw new Error('Missing contentId');
      return contentApi.publishNow(id);
    },
    onSuccess: () => {
      toast.success('Publishing started', { description: 'We’re publishing it now.' });
      const brandId = post?.brand?.id ?? selectedBrandId ?? null;
      if (brandId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['calendar'] });
        queryClient.invalidateQueries({ queryKey: ['drafts'] });
      }
      queryClient.invalidateQueries({ queryKey: ['content'] });
      if (id) queryClient.invalidateQueries({ queryKey: ['post', id] });
      if (contentGroupId) {
        queryClient.invalidateQueries({ queryKey: ['content-group', contentGroupId] });
      }
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-items-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-items'] });
    },
    onError: (error: any) => {
      toast.error(getScheduleErrorMessage(error, 'Failed to publish now. Please try again.'));
    },
  });

  const { mutateAsync: scheduleContentGroup, isPending: isSchedulingContentGroup } = useMutation({
    mutationFn: async (scheduledAt: string | null) => {
      if (!contentGroupId) throw new Error('Missing contentGroupId');
      return contentApi.scheduleContentGroup(contentGroupId, scheduledAt);
    },
    onSuccess: (_response, scheduledAt) => {
      if (!contentGroupId) return;
      toast.success(scheduledAt ? 'Destinations scheduled' : 'Destinations unscheduled');
      queryClient.invalidateQueries({ queryKey: ['content-group', contentGroupId] });
      for (const dest of groupDestinations) {
        queryClient.invalidateQueries({ queryKey: ['post', dest.contentId] });
      }
      const brandId = post?.brand?.id ?? selectedBrandId ?? null;
      if (brandId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
      }
    },
    onError: (error: any) =>
      toast.error(getScheduleErrorMessage(error, 'Failed to update destination schedules.')),
  });

  const { mutateAsync: addToQueueAsync, isPending: isQueueing } = useMutation({
    mutationFn: async () => {
      if (isMultiDestinationGroup) {
        if (!contentGroupId) throw new Error('Missing contentGroupId');
        return contentApi.queueContentGroup(contentGroupId);
      }

      if (!id) throw new Error('Missing contentId');
      const targetSocialAccountId =
        typeof (post as any)?.targetSocialAccountId === 'string'
          ? String((post as any).targetSocialAccountId)
          : null;
      if (!targetSocialAccountId) throw new Error('Missing target social account');

      const queues = await publishingQueuesApi.listQueuesForSocialAccount(targetSocialAccountId);
      const list = Array.isArray((queues as any)?.data?.queues) ? (queues as any).data.queues : [];
      const defaultQueue = list.find((q: any) => q?.isDefault) || list[0] || null;
      if (!defaultQueue?.id) throw new Error('Missing default queue');

      return publishingQueuesApi.addQueueItem(String(defaultQueue.id), id);
    },
    onSuccess: () => {
      toast.success('Added to queue');
      const brandId = post?.brand?.id ?? selectedBrandId ?? null;
      if (brandId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
      }
      if (id) queryClient.invalidateQueries({ queryKey: ['post', id] });
      if (contentGroupId) {
        queryClient.invalidateQueries({ queryKey: ['content-group', contentGroupId] });
      }
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-items-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-items'] });
    },
    onError: (error: any) => {
      toast.error(getQueueErrorMessage(error));
    },
  });

  return {
    mutateContentAsync,
    isSaving,
    saveTemplateAsync,
    isSavingTemplate,
    applyTemplateAsync,
    isApplyingTemplate,
    resetDestinationAsync,
    isResettingDestination,
    addGroupDestinationsAsync,
    isAddingDestination,
    addContentDestinationsAsync,
    isAddingContentDestination,
    unschedulePost,
    isUnscheduling,
    deletePostAsync,
    isDeleting,
    publishNowAsync,
    isPublishingNow,
    scheduleContentGroup,
    isSchedulingContentGroup,
    addToQueueAsync,
    isQueueing,
    queryClient,
  };
}
