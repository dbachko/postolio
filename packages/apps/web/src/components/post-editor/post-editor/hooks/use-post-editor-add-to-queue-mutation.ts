import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { PostDetailData } from '@/hooks/usePostDetail';
import { content as contentApi, publishingQueues as publishingQueuesApi } from '@/lib/api';

import { getQueueErrorMessage } from '../utils';
import {
  invalidateCalendarAndDrafts,
  invalidatePublishingQueues,
  resolveMutationBrandId,
} from './use-post-editor-mutations-utils';

type AddToQueueContext = {
  id?: string;
  contentGroupId: string | null;
  isMultiDestinationGroup: boolean;
  post: PostDetailData | undefined;
  selectedBrandId: string | null;
  queryClient: {
    invalidateQueries: (args: { queryKey: unknown[] }) => unknown;
  };
};

export function useAddToQueueMutation(ctx: AddToQueueContext) {
  const mutation = useMutation({
    mutationFn: async () => {
      if (ctx.isMultiDestinationGroup) {
        if (!ctx.contentGroupId) {
          throw new Error('Missing contentGroupId');
        }
        return contentApi.queueContentGroup(ctx.contentGroupId);
      }
      if (!ctx.id) {
        throw new Error('Missing contentId');
      }
      const targetSocialAccountId =
        typeof (ctx.post as any)?.targetSocialAccountId === 'string'
          ? String((ctx.post as any).targetSocialAccountId)
          : null;
      if (!targetSocialAccountId) {
        throw new Error('Missing target social account');
      }

      const queues = await publishingQueuesApi.listQueuesForSocialAccount(targetSocialAccountId);
      const list = Array.isArray((queues as any)?.data?.queues) ? (queues as any).data.queues : [];
      const defaultQueue = list.find((queue: any) => queue?.isDefault) || list[0] || null;
      if (!defaultQueue?.id) {
        throw new Error('Missing default queue');
      }
      return publishingQueuesApi.addQueueItem(String(defaultQueue.id), ctx.id);
    },
    onSuccess: () => {
      toast.success('Added to queue');
      invalidateCalendarAndDrafts(
        ctx.queryClient,
        resolveMutationBrandId(ctx.post, ctx.selectedBrandId)
      );
      if (ctx.id) {
        ctx.queryClient.invalidateQueries({ queryKey: ['post', ctx.id] });
      }
      if (ctx.contentGroupId) {
        ctx.queryClient.invalidateQueries({ queryKey: ['content-group', ctx.contentGroupId] });
      }
      invalidatePublishingQueues(ctx.queryClient);
    },
    onError: (error: any) => {
      toast.error(getQueueErrorMessage(error));
    },
  });

  return { addToQueueAsync: mutation.mutateAsync, isQueueing: mutation.isPending };
}
