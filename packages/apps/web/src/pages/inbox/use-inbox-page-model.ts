import { useCallback, useRef } from 'react';
import { toast } from 'sonner';

import { savedReplies } from '@/lib/api';
import { useBrandStore, type BrandState } from '@/stores/brandStore';

import {
  useAutoSyncInbox,
  useConnectedAccounts,
  useFilteredInboxItems,
  useInboxItems,
  useSavedReplies,
  useSelectedCommentPreview,
  useSelectedInboxItem,
  useSyncInboxMutation,
} from './use-inbox-data';
import { useCommentDetails, useDMDetails } from './use-inbox-details';
import { createInboxStateSetters, useInboxUiState } from './use-inbox-ui-state';
import { useInboxWebSocket } from './use-inbox-websocket';

function useSelectionIds(selectedItem: ReturnType<typeof useSelectedInboxItem>) {
  const selectedConversationId =
    selectedItem?.type === 'dm_conversation' ? selectedItem.conversationId : null;
  const selectedPublicationId =
    selectedItem?.type === 'comment_thread' ? selectedItem.publicationId : null;
  const selectedPostId = selectedItem?.type === 'comment_thread' ? selectedItem.postId : null;

  return { selectedConversationId, selectedPublicationId, selectedPostId };
}

function useSaveReply(brandId: string | undefined) {
  return useCallback(
    async (title: string, body: string) => {
      if (!brandId) {
        return;
      }

      try {
        await savedReplies.createSavedReply(brandId, { title, body });
        toast.success('Saved reply added');
      } catch (error: any) {
        toast.error(error?.message || 'Failed to save reply');
      }
    },
    [brandId]
  );
}

type InboxPageModelArgs = {
  brand: BrandState['selectedBrand'];
  brandId: string | undefined;
  state: ReturnType<typeof useInboxUiState>['state'];
  stateSetters: ReturnType<typeof createInboxStateSetters>;
  socialAccounts: ReturnType<typeof useConnectedAccounts>['socialAccounts'];
  socialAccountById: ReturnType<typeof useConnectedAccounts>['socialAccountById'];
  filteredItems: ReturnType<typeof useFilteredInboxItems>['filteredItems'];
  itemCountBySocialAccountId: ReturnType<
    typeof useFilteredInboxItems
  >['itemCountBySocialAccountId'];
  selectedItem: ReturnType<typeof useSelectedInboxItem>;
  selectedPreviewUrl: ReturnType<typeof useSelectedCommentPreview>['selectedPreviewUrl'];
  inboxLoading: ReturnType<typeof useInboxItems>['inboxLoading'];
  inboxIsError: ReturnType<typeof useInboxItems>['inboxIsError'];
  inboxError: ReturnType<typeof useInboxItems>['inboxError'];
  refetchInbox: ReturnType<typeof useInboxItems>['refetchInbox'];
  syncInboxMutation: ReturnType<typeof useSyncInboxMutation>;
  repliesData: ReturnType<typeof useSavedReplies>['data'];
  selectedPublicationId: string | null;
  dmDetails: ReturnType<typeof useDMDetails>;
  commentDetails: ReturnType<typeof useCommentDetails>;
  saveReply: ReturnType<typeof useSaveReply>;
};

function buildInboxPageModel({
  brand,
  brandId,
  state,
  stateSetters,
  socialAccounts,
  socialAccountById,
  filteredItems,
  itemCountBySocialAccountId,
  selectedItem,
  selectedPreviewUrl,
  inboxLoading,
  inboxIsError,
  inboxError,
  refetchInbox,
  syncInboxMutation,
  repliesData,
  selectedPublicationId,
  dmDetails,
  commentDetails,
  saveReply,
}: InboxPageModelArgs) {
  return {
    brand,
    brandId,
    socialAccounts,
    socialAccountById,
    selectedAccountId: state.selectedAccountId,
    channel: state.channel,
    platform: state.platform,
    itemQuery: state.itemQuery,
    selectedItemKey: state.selectedItemKey,
    activeReplyFor: state.activeReplyFor,
    replyText: state.replyText,
    filteredItems,
    itemCountBySocialAccountId,
    selectedItem,
    selectedPreviewUrl,
    inboxLoading,
    inboxIsError,
    inboxError,
    refetchInbox,
    syncInboxMutation,
    repliesData,
    selectedPublicationId,
    messages: dmDetails.messages,
    messagesLoading: dmDetails.messagesLoading,
    sendMessageMutation: dmDetails.sendMessageMutation,
    archiveConversationMutation: dmDetails.archiveConversationMutation,
    commentsData: commentDetails.commentsData,
    commentsFetching: commentDetails.commentsFetching,
    replyMutation: commentDetails.replyMutation,
    likeMutation: commentDetails.likeMutation,
    workflowMutation: commentDetails.workflowMutation,
    refreshCommentsMutation: commentDetails.refreshCommentsMutation,
    markAllRead: commentDetails.markAllRead,
    refreshSelectedThread: commentDetails.refreshSelectedThread,
    ...stateSetters,
    saveReply,
  };
}

export function useInboxPageModel() {
  const brand = useBrandStore((store) => store.selectedBrand);
  const brandId = brand?.id;
  const autoSyncedAccountsRef = useRef<Set<string>>(new Set());
  const { state, setState } = useInboxUiState(brandId);
  const stateSetters = createInboxStateSetters(setState);

  const { socialAccounts, socialAccountById } = useConnectedAccounts(
    brandId,
    state.selectedAccountId,
    setState
  );
  const { items, inboxLoading, inboxIsError, inboxError, refetchInbox } = useInboxItems(brandId);
  const syncInboxMutation = useSyncInboxMutation({
    brandId,
    refetchInbox,
    autoSyncedAccountsRef,
  });

  useAutoSyncInbox({
    brandId,
    selectedAccountId: state.selectedAccountId,
    syncInboxMutation,
    autoSyncedAccountsRef,
  });

  const { filteredItems, itemCountBySocialAccountId } = useFilteredInboxItems({
    items,
    channel: state.channel,
    platform: state.platform,
    selectedAccountId: state.selectedAccountId,
    itemQuery: state.itemQuery,
  });

  const selectedItem = useSelectedInboxItem(filteredItems, state.selectedItemKey, setState);
  const { selectedPreviewUrl } = useSelectedCommentPreview(selectedItem);
  const repliesQuery = useSavedReplies(brandId);
  const { selectedConversationId, selectedPublicationId, selectedPostId } =
    useSelectionIds(selectedItem);

  const dmDetails = useDMDetails({
    brandId,
    selectedConversationId,
    setState,
  });
  const commentDetails = useCommentDetails({
    selectedPublicationId,
    selectedPostId,
    refetchInbox,
    setState,
  });

  useInboxWebSocket(brandId);
  const saveReply = useSaveReply(brandId);

  return buildInboxPageModel({
    brand,
    brandId,
    state,
    stateSetters,
    socialAccounts,
    socialAccountById,
    filteredItems,
    itemCountBySocialAccountId,
    selectedItem,
    selectedPreviewUrl,
    inboxLoading,
    inboxIsError,
    inboxError,
    refetchInbox,
    syncInboxMutation,
    repliesData: repliesQuery.data,
    selectedPublicationId,
    dmDetails,
    commentDetails,
    saveReply,
  });
}
