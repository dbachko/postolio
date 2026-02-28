import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { content as contentApi, dmAutomation } from '@/lib/api';

import type { InboxUiState } from './use-inbox-ui-state';
import type { CommentItem } from './types';

export function useDMDetails({
  brandId,
  selectedConversationId,
  setState,
}: {
  brandId: string | undefined;
  selectedConversationId: string | null;
  setState: Dispatch<SetStateAction<InboxUiState>>;
}) {
  const queryClient = useQueryClient();
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['dm-messages', brandId, selectedConversationId],
    queryFn: () => dmAutomation.getConversationMessages(brandId!, selectedConversationId!),
    enabled: Boolean(brandId && selectedConversationId),
  });

  const messages = (messagesData as any)?.messages || [];

  const sendMessageMutation = useMutation({
    mutationFn: (messageText: string) =>
      dmAutomation.sendMessage(brandId!, selectedConversationId!, messageText),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dm-messages', brandId, selectedConversationId] });
      queryClient.invalidateQueries({ queryKey: ['inbox-items', brandId] });
      toast.success('Message sent');
    },
    onError: () => toast.error('Failed to send message'),
  });

  const archiveConversationMutation = useMutation({
    mutationFn: (conversationId: string) =>
      dmAutomation.updateConversationState(brandId!, conversationId, 'archived'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-items', brandId] });
      toast.success('Conversation archived');
      setState((prev) => ({ ...prev, selectedItemKey: null }));
    },
    onError: () => toast.error('Failed to archive conversation'),
  });

  return { messages, messagesLoading, sendMessageMutation, archiveConversationMutation };
}

function useCommentsThreadQuery(
  selectedPublicationId: string | null,
  selectedPostId: string | null
) {
  return useQuery<{
    data: CommentItem[];
    page: number;
    pageSize: number;
    total: number;
  }>({
    queryKey: ['post-comments', selectedPublicationId],
    queryFn: async () => {
      if (!selectedPostId || !selectedPublicationId) {
        throw new Error('No thread selected');
      }
      return (await contentApi.getPostComments(selectedPostId, 1, 50, {
        publicationId: selectedPublicationId,
      })) as any;
    },
    enabled: Boolean(selectedPostId && selectedPublicationId),
  });
}

function useReplyMutation({
  selectedPostId,
  selectedPublicationId,
  refetchComments,
  refetchInbox,
  setState,
}: {
  selectedPostId: string | null;
  selectedPublicationId: string | null;
  refetchComments: () => Promise<unknown>;
  refetchInbox: () => Promise<unknown>;
  setState: Dispatch<SetStateAction<InboxUiState>>;
}) {
  return useMutation({
    mutationFn: async (vars: { commentId: string; message: string }) => {
      if (!selectedPostId || !selectedPublicationId) {
        throw new Error('No thread selected');
      }
      return contentApi.replyToComment(selectedPostId, vars.commentId, vars.message, {
        publicationId: selectedPublicationId,
      });
    },
    onSuccess: () => {
      toast.success('Replied');
      setState((prev) => ({ ...prev, replyText: '', activeReplyFor: null }));
      refetchComments();
      refetchInbox();
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to reply'),
  });
}

function useLikeMutation({
  selectedPostId,
  selectedPublicationId,
}: {
  selectedPostId: string | null;
  selectedPublicationId: string | null;
}) {
  return useMutation({
    mutationFn: async (vars: { commentId: string }) => {
      if (!selectedPostId || !selectedPublicationId) {
        throw new Error('No thread selected');
      }
      return contentApi.likeComment(selectedPostId, vars.commentId, {
        publicationId: selectedPublicationId,
      });
    },
    onSuccess: () => toast.success('Liked'),
    onError: (error: any) => toast.info(error?.message || 'Like not available'),
  });
}

function useWorkflowMutation({
  selectedPostId,
  selectedPublicationId,
  refetchComments,
  refetchInbox,
}: {
  selectedPostId: string | null;
  selectedPublicationId: string | null;
  refetchComments: () => Promise<unknown>;
  refetchInbox: () => Promise<unknown>;
}) {
  return useMutation({
    mutationFn: async (vars: { commentId: string; status?: 'open' | 'resolved' | 'archived' }) => {
      if (!selectedPostId || !selectedPublicationId) {
        throw new Error('No thread selected');
      }
      return contentApi.setCommentWorkflow(selectedPostId, vars.commentId, vars, {
        publicationId: selectedPublicationId,
      });
    },
    onSuccess: async () => {
      await Promise.all([refetchComments(), refetchInbox()]);
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update'),
  });
}

function useRefreshCommentsMutation(refetchInbox: () => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { postId: string; publicationId: string }) => {
      return (await contentApi.getPostComments(vars.postId, 1, 50, {
        publicationId: vars.publicationId,
        refresh: true,
      })) as any;
    },
    onSuccess: async (data, vars) => {
      queryClient.setQueryData(['post-comments', vars.publicationId], data);
      toast.success('Refreshed');
      await refetchInbox();
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to refresh'),
  });
}

function useMarkAllRead({
  comments,
  selectedPostId,
  selectedPublicationId,
  refetchComments,
  refetchInbox,
}: {
  comments: CommentItem[] | undefined;
  selectedPostId: string | null;
  selectedPublicationId: string | null;
  refetchComments: () => Promise<unknown>;
  refetchInbox: () => Promise<unknown>;
}) {
  return useCallback(async () => {
    const commentList = comments || [];
    if (!selectedPostId || !selectedPublicationId || !commentList.length) {
      return;
    }

    try {
      const ids = commentList.map((comment) => String(comment.id || '')).filter(Boolean);
      await contentApi.markAllCommentsRead(selectedPostId, ids, {
        publicationId: selectedPublicationId,
      });
      toast.success('Marked all as read');
      await Promise.all([refetchComments(), refetchInbox()]);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to mark all as read');
    }
  }, [comments, refetchComments, refetchInbox, selectedPostId, selectedPublicationId]);
}

function useRefreshSelectedThread({
  refreshCommentsMutation,
  selectedPostId,
  selectedPublicationId,
}: {
  refreshCommentsMutation: ReturnType<typeof useRefreshCommentsMutation>;
  selectedPostId: string | null;
  selectedPublicationId: string | null;
}) {
  return useCallback(() => {
    if (!selectedPostId || !selectedPublicationId) {
      return;
    }
    refreshCommentsMutation.mutate({
      postId: selectedPostId,
      publicationId: selectedPublicationId,
    });
  }, [refreshCommentsMutation, selectedPostId, selectedPublicationId]);
}

export function useCommentDetails({
  selectedPublicationId,
  selectedPostId,
  refetchInbox,
  setState,
}: {
  selectedPublicationId: string | null;
  selectedPostId: string | null;
  refetchInbox: () => Promise<unknown>;
  setState: Dispatch<SetStateAction<InboxUiState>>;
}) {
  const {
    data: commentsData,
    refetch: refetchComments,
    isFetching: commentsFetching,
  } = useCommentsThreadQuery(selectedPublicationId, selectedPostId);
  const replyMutation = useReplyMutation({
    selectedPostId,
    selectedPublicationId,
    refetchComments,
    refetchInbox,
    setState,
  });
  const likeMutation = useLikeMutation({ selectedPostId, selectedPublicationId });
  const workflowMutation = useWorkflowMutation({
    selectedPostId,
    selectedPublicationId,
    refetchComments,
    refetchInbox,
  });
  const refreshCommentsMutation = useRefreshCommentsMutation(refetchInbox);
  const markAllRead = useMarkAllRead({
    comments: commentsData?.data,
    selectedPostId,
    selectedPublicationId,
    refetchComments,
    refetchInbox,
  });
  const refreshSelectedThread = useRefreshSelectedThread({
    refreshCommentsMutation,
    selectedPostId,
    selectedPublicationId,
  });

  return {
    commentsData,
    commentsFetching,
    replyMutation,
    likeMutation,
    workflowMutation,
    refreshCommentsMutation,
    markAllRead,
    refreshSelectedThread,
  };
}
