import type { QueryClient } from '@tanstack/react-query';
import type { PublishingQueueSummary } from '@/lib/api/publishing-queues-client';
import type { PublishingScheduleContentProps } from './publishing-schedule-content';
import type { PublishingScheduleDialogsProps } from './publishing-schedule-dialogs';
import type { AccountOption, QueueToDelete } from './types';
import {
  useConnectedAccountsData,
  useCreateQueueMutation,
  useDeleteQueueMutation,
  useEnsureSelectedAccount,
  usePostingGoalState,
  usePublishingScheduleUiState,
  useResetTransientStateOnAccountChange,
  useSelectedAccount,
  useSelectedAccountQueues,
  useSelectedQueueState,
  useSetDefaultQueueMutation,
  useSetPostingGoalMutation,
} from './use-publishing-schedule-model';

interface PublishingSchedulePageModel {
  contentProps: PublishingScheduleContentProps;
  dialogProps: PublishingScheduleDialogsProps;
}

function usePublishingScheduleAccountSelection({
  ui,
  allAccountOptions,
}: {
  ui: ReturnType<typeof usePublishingScheduleUiState>;
  allAccountOptions: AccountOption[];
}) {
  const selectedAccount = useSelectedAccount(allAccountOptions, ui.selectedAccountId);
  const { selectedAccountQueuesQuery, selectedAccountQueues } = useSelectedAccountQueues(
    selectedAccount?.id
  );
  const { selectedQueueId, selectedQueue } = useSelectedQueueState({
    selectedAccount,
    selectedAccountQueues,
    selectedQueueIdsByAccount: ui.selectedQueueIdsByAccount,
    setSelectedQueueIdsByAccount: ui.setSelectedQueueIdsByAccount,
    selectedAccountQueuesLoading: selectedAccountQueuesQuery.isLoading,
  });
  const postingGoal = usePostingGoalState({
    postingGoalOpen: ui.postingGoalOpen,
    postingGoalValue: ui.postingGoalValue,
    postingGoalCustomValue: ui.postingGoalCustomValue,
    selectedQueue,
    setPostingGoalConfirmReplace: ui.setPostingGoalConfirmReplace,
  });
  return {
    selectedAccount,
    selectedAccountQueuesQuery,
    selectedAccountQueues,
    selectedQueueId,
    selectedQueue,
    postingGoal,
  };
}

function usePublishingScheduleMutations({
  ui,
  queryClient,
  selectedAccountId,
  selectedQueueId,
}: {
  ui: ReturnType<typeof usePublishingScheduleUiState>;
  queryClient: QueryClient;
  selectedAccountId?: string;
  selectedQueueId: string | null;
}) {
  const createQueueMutation = useCreateQueueMutation({
    queryClient,
    selectedAccountId,
    newQueueName: ui.newQueueName,
    setNewQueueName: ui.setNewQueueName,
    setCreateQueueOpen: ui.setCreateQueueOpen,
    setSelectedQueueIdsByAccount: ui.setSelectedQueueIdsByAccount,
  });
  const setDefaultQueueMutation = useSetDefaultQueueMutation({
    queryClient,
    selectedAccountId,
    selectedQueueId,
  });
  const deleteQueueMutation = useDeleteQueueMutation({
    queryClient,
    setSelectedQueueIdsByAccount: ui.setSelectedQueueIdsByAccount,
    setQueueToDelete: ui.setQueueToDelete,
  });
  const setPostingGoalMutation = useSetPostingGoalMutation({
    queryClient,
    selectedAccountId,
    setPostingGoalOpen: ui.setPostingGoalOpen,
    setPostingGoalConfirmReplace: ui.setPostingGoalConfirmReplace,
  });
  return {
    createQueueMutation,
    setDefaultQueueMutation,
    deleteQueueMutation,
    setPostingGoalMutation,
  };
}

function buildContentProps({
  accountsLoading,
  allAccountOptions,
  ui,
  selectedAccountQueues,
  selectedAccountQueuesLoading,
  createQueuePending,
  deleteQueuePending,
  selectedQueue,
  selectedQueueId,
  selectedAccount,
  setPostingGoalPending,
  setDefaultQueuePending,
  onCreateQueue,
  onSetDefaultQueue,
}: {
  accountsLoading: boolean;
  allAccountOptions: AccountOption[];
  ui: ReturnType<typeof usePublishingScheduleUiState>;
  selectedAccountQueues: PublishingQueueSummary[];
  selectedAccountQueuesLoading: boolean;
  createQueuePending: boolean;
  deleteQueuePending: boolean;
  selectedQueue: PublishingQueueSummary | null;
  selectedQueueId: string | null;
  selectedAccount: AccountOption | null;
  setPostingGoalPending: boolean;
  setDefaultQueuePending: boolean;
  onCreateQueue: () => void;
  onSetDefaultQueue: () => void;
}): PublishingScheduleContentProps {
  return {
    accountsLoading,
    allAccountOptions,
    selectedAccountId: ui.selectedAccountId,
    selectedQueueIdsByAccount: ui.selectedQueueIdsByAccount,
    selectedAccountQueues,
    selectedAccountQueuesLoading,
    createQueueOpen: ui.createQueueOpen,
    createQueuePending,
    newQueueName: ui.newQueueName,
    deleteQueuePending,
    selectedQueue,
    selectedQueueId,
    selectedAccount,
    setPostingGoalPending,
    setDefaultQueuePending,
    onSelectAccount: ui.setSelectedAccountId,
    onSelectQueueForAccount: (accountId, queueId) =>
      ui.setSelectedQueueIdsByAccount((prev) =>
        prev[accountId] === queueId ? prev : { ...prev, [accountId]: queueId }
      ),
    onCreateQueueOpenChange: ui.setCreateQueueOpen,
    onNewQueueNameChange: ui.setNewQueueName,
    onCreateQueue,
    onRequestDeleteQueue: ui.setQueueToDelete,
    onOpenPostingGoal: () => ui.setPostingGoalOpen(true),
    onSetDefaultQueue,
    onSelectedQueueIdChange: (queueId) => {
      if (!selectedAccount?.id) {
        return;
      }
      ui.setSelectedQueueIdsByAccount((prev) => {
        const prevValue = prev[selectedAccount.id] ?? null;
        if (prevValue === queueId) {
          return prev;
        }
        return { ...prev, [selectedAccount.id]: queueId };
      });
    },
  };
}

function buildDialogProps({
  ui,
  postingGoalCustomError,
  requiresPostingGoalReplaceConfirm,
  selectedQueueSlotCount,
  applyPostingGoalPending,
  canApplyPostingGoal,
  onApplyPostingGoal,
  onConfirmDeleteQueue,
  deleteQueuePending,
}: {
  ui: ReturnType<typeof usePublishingScheduleUiState>;
  postingGoalCustomError: string | null;
  requiresPostingGoalReplaceConfirm: boolean;
  selectedQueueSlotCount: number;
  applyPostingGoalPending: boolean;
  canApplyPostingGoal: boolean;
  onApplyPostingGoal: () => void;
  onConfirmDeleteQueue: (queue: QueueToDelete) => void;
  deleteQueuePending: boolean;
}): PublishingScheduleDialogsProps {
  return {
    queueToDelete: ui.queueToDelete,
    onQueueToDeleteChange: ui.setQueueToDelete,
    deleteQueuePending,
    onConfirmDeleteQueue,
    postingGoalOpen: ui.postingGoalOpen,
    onPostingGoalOpenChange: ui.setPostingGoalOpen,
    postingGoalValue: ui.postingGoalValue,
    onPostingGoalValueChange: ui.setPostingGoalValue,
    postingGoalCustomValue: ui.postingGoalCustomValue,
    onPostingGoalCustomValueChange: ui.setPostingGoalCustomValue,
    postingGoalCustomError,
    requiresPostingGoalReplaceConfirm,
    selectedQueueSlotCount,
    postingGoalConfirmReplace: ui.postingGoalConfirmReplace,
    onPostingGoalConfirmReplaceChange: ui.setPostingGoalConfirmReplace,
    applyPostingGoalPending,
    canApplyPostingGoal,
    onApplyPostingGoal,
  };
}

export function usePublishingSchedulePageModel({
  selectedBrandId,
  queryClient,
}: {
  selectedBrandId?: string;
  queryClient: QueryClient;
}): PublishingSchedulePageModel {
  const ui = usePublishingScheduleUiState();
  const { accountsQuery, connectedAccounts, allAccountOptions } =
    useConnectedAccountsData(selectedBrandId);

  useEnsureSelectedAccount({
    brandId: selectedBrandId,
    selectedAccountId: ui.selectedAccountId,
    connectedAccounts,
    setSelectedAccountId: ui.setSelectedAccountId,
  });
  useResetTransientStateOnAccountChange({
    selectedAccountId: ui.selectedAccountId,
    setCreateQueueOpen: ui.setCreateQueueOpen,
    setNewQueueName: ui.setNewQueueName,
    setPostingGoalOpen: ui.setPostingGoalOpen,
    setPostingGoalConfirmReplace: ui.setPostingGoalConfirmReplace,
    setQueueToDelete: ui.setQueueToDelete,
  });

  const selection = usePublishingScheduleAccountSelection({ ui, allAccountOptions });
  const mutations = usePublishingScheduleMutations({
    ui,
    queryClient,
    selectedAccountId: selection.selectedAccount?.id,
    selectedQueueId: selection.selectedQueueId,
  });

  const canApplyPostingGoal =
    Boolean(selection.selectedQueue?.id) &&
    selection.postingGoal.selectedPostingGoalPerWeek !== null &&
    (!selection.postingGoal.requiresPostingGoalReplaceConfirm || ui.postingGoalConfirmReplace);

  return {
    contentProps: buildContentProps({
      accountsLoading: accountsQuery.isLoading,
      allAccountOptions,
      ui,
      selectedAccountQueues: selection.selectedAccountQueues,
      selectedAccountQueuesLoading: selection.selectedAccountQueuesQuery.isLoading,
      createQueuePending: mutations.createQueueMutation.isPending,
      deleteQueuePending: mutations.deleteQueueMutation.isPending,
      selectedQueue: selection.selectedQueue,
      selectedQueueId: selection.selectedQueueId,
      selectedAccount: selection.selectedAccount,
      setPostingGoalPending: mutations.setPostingGoalMutation.isPending,
      setDefaultQueuePending: mutations.setDefaultQueueMutation.isPending,
      onCreateQueue: () => mutations.createQueueMutation.mutate(),
      onSetDefaultQueue: () => mutations.setDefaultQueueMutation.mutate(),
    }),
    dialogProps: buildDialogProps({
      ui,
      postingGoalCustomError: selection.postingGoal.postingGoalCustomError,
      requiresPostingGoalReplaceConfirm: selection.postingGoal.requiresPostingGoalReplaceConfirm,
      selectedQueueSlotCount: selection.postingGoal.selectedQueueSlotCount,
      applyPostingGoalPending: mutations.setPostingGoalMutation.isPending,
      canApplyPostingGoal,
      onApplyPostingGoal: () => {
        if (
          !selection.selectedQueue?.id ||
          selection.postingGoal.selectedPostingGoalPerWeek === null
        ) {
          return;
        }
        mutations.setPostingGoalMutation.mutate({
          queueId: selection.selectedQueue.id,
          postsPerWeek: selection.postingGoal.selectedPostingGoalPerWeek,
        });
      },
      onConfirmDeleteQueue: (queue) => mutations.deleteQueueMutation.mutate(queue),
      deleteQueuePending: mutations.deleteQueueMutation.isPending,
    }),
  };
}
