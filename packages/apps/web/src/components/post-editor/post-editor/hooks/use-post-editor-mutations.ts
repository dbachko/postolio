import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { InstagramContentType } from '@postolio/content-validation';
import type { PostDetailData } from '@/hooks/usePostDetail';
import { content as contentApi } from '@/lib/api';

import { getScheduleErrorMessage } from '../utils';
import { useAddToQueueMutation } from './use-post-editor-add-to-queue-mutation';
import {
  invalidateCalendarAndDrafts,
  invalidatePublishingQueues,
  resolveMutationBrandId,
} from './use-post-editor-mutations-utils';

type UsePostEditorMutationsParams = {
  id?: string;
  contentGroupId: string | null;
  isMultiDestinationGroup: boolean;
  groupDestinations: Array<{ contentId: string }>;
  post: PostDetailData | undefined;
  selectedBrandId: string | null;
  onRequestClose?: () => void;
  setHasChanges: (value: boolean) => void;
  setTemplateHasChanges: (value: boolean) => void;
};

type MutationContext = {
  id?: string;
  contentGroupId: string | null;
  isMultiDestinationGroup: boolean;
  groupDestinations: Array<{ contentId: string }>;
  post: PostDetailData | undefined;
  selectedBrandId: string | null;
  onRequestClose?: () => void;
  setHasChanges: (value: boolean) => void;
  setTemplateHasChanges: (value: boolean) => void;
  queryClient: ReturnType<typeof useQueryClient>;
};

function useMutateContentMutation(ctx: MutationContext) {
  const mutation = useMutation({
    mutationFn: async (data: {
      contentId: string;
      caption?: string;
      scheduledAt?: string | null;
      firstComment?: string;
      contentType?: InstagramContentType;
      shareToFeed?: boolean;
      targetSocialAccountId?: string | null;
    }) => contentApi.updateContent(data),
    onSuccess: (response) => {
      ctx.queryClient.setQueryData(['post', ctx.id], (oldData: PostDetailData | undefined) => {
        if (!oldData) {
          return oldData;
        }
        return {
          ...oldData,
          ...response.content,
          status: response.content?.status || oldData.status,
        } as PostDetailData;
      });
      ctx.setHasChanges(false);
    },
    onError: () => toast.error('Failed to save changes'),
  });

  return { mutateContentAsync: mutation.mutateAsync, isSaving: mutation.isPending };
}

function useSaveTemplateMutation(ctx: MutationContext) {
  const mutation = useMutation({
    mutationFn: async (payload: {
      caption: string;
      contentType: InstagramContentType;
      shareToFeed?: boolean | null;
      firstComment?: string | null;
      thumbOffset?: number | null;
      assetIds?: string[];
    }) => {
      if (!ctx.contentGroupId) {
        throw new Error('Missing contentGroupId');
      }
      return contentApi.updateContentGroupTemplate(ctx.contentGroupId, payload);
    },
    onSuccess: (response: any) => {
      if (!ctx.contentGroupId) {
        return;
      }
      ctx.queryClient.setQueryData(['content-group', ctx.contentGroupId], (oldData: any) => {
        if (!oldData || !response?.contentGroup?.template) {
          return oldData;
        }
        return {
          ...oldData,
          contentGroup: {
            ...oldData.contentGroup,
            ...response.contentGroup,
            template: response.contentGroup.template,
          },
        };
      });
      ctx.setTemplateHasChanges(false);
      toast.success('Template saved');
    },
    onError: (error: any) =>
      toast.error(getScheduleErrorMessage(error, 'Failed to save template. Please try again.')),
  });

  return { saveTemplateAsync: mutation.mutateAsync, isSavingTemplate: mutation.isPending };
}

function useApplyTemplateMutation(ctx: MutationContext) {
  const mutation = useMutation({
    mutationFn: async () => {
      if (!ctx.contentGroupId) {
        throw new Error('Missing contentGroupId');
      }
      return contentApi.applyContentGroupTemplate(ctx.contentGroupId);
    },
    onSuccess: () => {
      if (!ctx.contentGroupId) {
        return;
      }
      toast.success('Template applied to destinations');
      ctx.queryClient.invalidateQueries({ queryKey: ['content-group', ctx.contentGroupId] });
      for (const destination of ctx.groupDestinations) {
        ctx.queryClient.invalidateQueries({ queryKey: ['post', destination.contentId] });
      }
      invalidateCalendarAndDrafts(
        ctx.queryClient,
        resolveMutationBrandId(ctx.post, ctx.selectedBrandId)
      );
    },
    onError: (error: any) =>
      toast.error(getScheduleErrorMessage(error, 'Failed to apply template. Please try again.')),
  });

  return { applyTemplateAsync: mutation.mutateAsync, isApplyingTemplate: mutation.isPending };
}

function useResetDestinationMutation(ctx: MutationContext) {
  const mutation = useMutation({
    mutationFn: async () => {
      if (!ctx.contentGroupId) {
        throw new Error('Missing contentGroupId');
      }
      if (!ctx.id) {
        throw new Error('Missing contentId');
      }
      return contentApi.resetGroupDestinationToTemplate(ctx.contentGroupId, ctx.id);
    },
    onSuccess: () => {
      if (!ctx.contentGroupId || !ctx.id) {
        return;
      }
      toast.success('Destination reset to template');
      ctx.queryClient.invalidateQueries({ queryKey: ['content-group', ctx.contentGroupId] });
      ctx.queryClient.invalidateQueries({ queryKey: ['post', ctx.id] });
      invalidateCalendarAndDrafts(
        ctx.queryClient,
        resolveMutationBrandId(ctx.post, ctx.selectedBrandId)
      );
    },
    onError: (error: any) =>
      toast.error(getScheduleErrorMessage(error, 'Failed to reset destination. Please try again.')),
  });

  return {
    resetDestinationAsync: mutation.mutateAsync,
    isResettingDestination: mutation.isPending,
  };
}

function useAddGroupDestinationsMutation(ctx: MutationContext) {
  const mutation = useMutation({
    mutationFn: async (payload: { targetSocialAccountId: string }) => {
      if (!ctx.contentGroupId) {
        throw new Error('Missing contentGroupId');
      }
      return contentApi.addContentGroupDestinations(ctx.contentGroupId, [
        payload.targetSocialAccountId,
      ]);
    },
    onSuccess: () => {
      if (ctx.contentGroupId) {
        ctx.queryClient.invalidateQueries({ queryKey: ['content-group', ctx.contentGroupId] });
      }
    },
  });

  return {
    addGroupDestinationsAsync: mutation.mutateAsync,
    isAddingDestination: mutation.isPending,
  };
}

function useAddContentDestinationsMutation(ctx: MutationContext) {
  const mutation = useMutation({
    mutationFn: async (payload: { targetSocialAccountId: string }) => {
      if (!ctx.id) {
        throw new Error('Missing contentId');
      }
      return contentApi.addContentDestinations(ctx.id, [payload.targetSocialAccountId]);
    },
    onSuccess: (response: any) => {
      const groupId =
        typeof response?.contentGroupId === 'string' && response.contentGroupId.trim()
          ? response.contentGroupId.trim()
          : null;
      if (groupId) {
        ctx.queryClient.invalidateQueries({ queryKey: ['content-group', groupId] });
      }
      if (ctx.id) {
        ctx.queryClient.invalidateQueries({ queryKey: ['post', ctx.id] });
      }
      invalidateCalendarAndDrafts(
        ctx.queryClient,
        resolveMutationBrandId(ctx.post, ctx.selectedBrandId)
      );
    },
  });

  return {
    addContentDestinationsAsync: mutation.mutateAsync,
    isAddingContentDestination: mutation.isPending,
  };
}

function useUnscheduleMutation(ctx: MutationContext) {
  const mutation = useMutation({
    mutationFn: async (contentId: string) =>
      contentApi.updateContent({
        contentId,
        scheduledAt: null,
      }),
    onSuccess: (response, contentId) => {
      toast.success('Post unscheduled and moved to Drafts');
      ctx.queryClient.setQueryData(['post', contentId], (oldData: PostDetailData | undefined) => {
        if (!oldData) {
          return oldData;
        }
        return {
          ...oldData,
          ...response.content,
          status: response.content?.status || 'draft',
        } as PostDetailData;
      });
      invalidateCalendarAndDrafts(
        ctx.queryClient,
        response.content?.brandId || ctx.post?.brand?.id || null
      );
      invalidatePublishingQueues(ctx.queryClient);
      ctx.setHasChanges(false);
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          'Failed to unschedule post. Please try again.'
      );
    },
  });

  return { unschedulePost: mutation.mutate, isUnscheduling: mutation.isPending };
}

function useDeleteMutation(ctx: MutationContext) {
  const mutation = useMutation({
    mutationFn: async () => {
      if (!ctx.id) {
        throw new Error('Missing contentId');
      }
      return contentApi.deletePost(ctx.id);
    },
    onSuccess: () => {
      toast.success('Post deleted');
      const brandId = resolveMutationBrandId(ctx.post, ctx.selectedBrandId);
      if (brandId) {
        invalidateCalendarAndDrafts(ctx.queryClient, brandId);
      } else {
        ctx.queryClient.invalidateQueries({ queryKey: ['calendar'] });
        ctx.queryClient.invalidateQueries({ queryKey: ['drafts'] });
      }
      ctx.queryClient.invalidateQueries({ queryKey: ['content'] });
      ctx.queryClient.invalidateQueries({ queryKey: ['post', ctx.id] });
      invalidatePublishingQueues(ctx.queryClient);
      ctx.onRequestClose?.();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to delete post.');
    },
  });

  return { deletePostAsync: mutation.mutateAsync, isDeleting: mutation.isPending };
}

function usePublishNowMutation(ctx: MutationContext) {
  const mutation = useMutation({
    mutationFn: async () => {
      if (ctx.isMultiDestinationGroup) {
        if (!ctx.contentGroupId) {
          throw new Error('Missing contentGroupId');
        }
        return contentApi.publishContentGroupNow(ctx.contentGroupId);
      }
      if (!ctx.id) {
        throw new Error('Missing contentId');
      }
      return contentApi.publishNow(ctx.id);
    },
    onSuccess: () => {
      toast.success('Publishing started', { description: 'We’re publishing it now.' });
      const brandId = resolveMutationBrandId(ctx.post, ctx.selectedBrandId);
      if (brandId) {
        invalidateCalendarAndDrafts(ctx.queryClient, brandId);
      } else {
        ctx.queryClient.invalidateQueries({ queryKey: ['calendar'] });
        ctx.queryClient.invalidateQueries({ queryKey: ['drafts'] });
      }
      ctx.queryClient.invalidateQueries({ queryKey: ['content'] });
      if (ctx.id) {
        ctx.queryClient.invalidateQueries({ queryKey: ['post', ctx.id] });
      }
      if (ctx.contentGroupId) {
        ctx.queryClient.invalidateQueries({ queryKey: ['content-group', ctx.contentGroupId] });
      }
      invalidatePublishingQueues(ctx.queryClient);
    },
    onError: (error: any) => {
      toast.error(getScheduleErrorMessage(error, 'Failed to publish now. Please try again.'));
    },
  });

  return { publishNowAsync: mutation.mutateAsync, isPublishingNow: mutation.isPending };
}

function useScheduleGroupMutation(ctx: MutationContext) {
  const mutation = useMutation({
    mutationFn: async (scheduledAt: string | null) => {
      if (!ctx.contentGroupId) {
        throw new Error('Missing contentGroupId');
      }
      return contentApi.scheduleContentGroup(ctx.contentGroupId, scheduledAt);
    },
    onSuccess: (_response, scheduledAt) => {
      if (!ctx.contentGroupId) {
        return;
      }
      toast.success(scheduledAt ? 'Destinations scheduled' : 'Destinations unscheduled');
      ctx.queryClient.invalidateQueries({ queryKey: ['content-group', ctx.contentGroupId] });
      for (const destination of ctx.groupDestinations) {
        ctx.queryClient.invalidateQueries({ queryKey: ['post', destination.contentId] });
      }
      invalidateCalendarAndDrafts(
        ctx.queryClient,
        resolveMutationBrandId(ctx.post, ctx.selectedBrandId)
      );
    },
    onError: (error: any) =>
      toast.error(getScheduleErrorMessage(error, 'Failed to update destination schedules.')),
  });

  return {
    scheduleContentGroup: mutation.mutateAsync,
    isSchedulingContentGroup: mutation.isPending,
  };
}

export function usePostEditorMutations(params: UsePostEditorMutationsParams) {
  const queryClient = useQueryClient();
  const ctx: MutationContext = { ...params, queryClient };

  const contentMutation = useMutateContentMutation(ctx);
  const saveTemplateMutation = useSaveTemplateMutation(ctx);
  const applyTemplateMutation = useApplyTemplateMutation(ctx);
  const resetDestinationMutation = useResetDestinationMutation(ctx);
  const addGroupDestinationsMutation = useAddGroupDestinationsMutation(ctx);
  const addContentDestinationsMutation = useAddContentDestinationsMutation(ctx);
  const unscheduleMutation = useUnscheduleMutation(ctx);
  const deleteMutation = useDeleteMutation(ctx);
  const publishNowMutation = usePublishNowMutation(ctx);
  const scheduleGroupMutation = useScheduleGroupMutation(ctx);
  const addToQueueMutation = useAddToQueueMutation(ctx);

  return {
    ...contentMutation,
    ...saveTemplateMutation,
    ...applyTemplateMutation,
    ...resetDestinationMutation,
    ...addGroupDestinationsMutation,
    ...addContentDestinationsMutation,
    ...unscheduleMutation,
    ...deleteMutation,
    ...publishNowMutation,
    ...scheduleGroupMutation,
    ...addToQueueMutation,
    queryClient,
  };
}
