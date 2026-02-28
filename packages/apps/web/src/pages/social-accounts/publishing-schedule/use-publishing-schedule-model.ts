import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { brand as brandApi, publishingQueues as publishingQueuesApi } from '@/lib/api';
import type { PublishingQueueSummary } from '@/lib/api/publishing-queues-client';
import {
  getQueueList,
  preferredQueueId,
  toAccountOption,
  type AccountOption,
  type ConnectedAccount,
  type PostingGoalValue,
  type QueueToDelete,
} from './types';

export function usePublishingScheduleUiState() {
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedQueueIdsByAccount, setSelectedQueueIdsByAccount] = useState<
    Record<string, string | null>
  >({});
  const [createQueueOpen, setCreateQueueOpen] = useState(false);
  const [newQueueName, setNewQueueName] = useState('');
  const [postingGoalOpen, setPostingGoalOpen] = useState(false);
  const [postingGoalValue, setPostingGoalValue] = useState<PostingGoalValue>('3');
  const [postingGoalCustomValue, setPostingGoalCustomValue] = useState('4');
  const [postingGoalConfirmReplace, setPostingGoalConfirmReplace] = useState(false);
  const [queueToDelete, setQueueToDelete] = useState<QueueToDelete | null>(null);

  return {
    selectedAccountId,
    setSelectedAccountId,
    selectedQueueIdsByAccount,
    setSelectedQueueIdsByAccount,
    createQueueOpen,
    setCreateQueueOpen,
    newQueueName,
    setNewQueueName,
    postingGoalOpen,
    setPostingGoalOpen,
    postingGoalValue,
    setPostingGoalValue,
    postingGoalCustomValue,
    setPostingGoalCustomValue,
    postingGoalConfirmReplace,
    setPostingGoalConfirmReplace,
    queueToDelete,
    setQueueToDelete,
  };
}

export function useConnectedAccountsData(selectedBrandId?: string) {
  const accountsQuery = useQuery({
    queryKey: ['brand-social-accounts', selectedBrandId],
    queryFn: () => brandApi.getConnectedAccounts(selectedBrandId!),
    enabled: Boolean(selectedBrandId),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const connectedAccounts = useMemo(() => {
    const data = accountsQuery.data as { socialAccounts?: ConnectedAccount[] } | undefined;
    const list = Array.isArray(data?.socialAccounts) ? data.socialAccounts : [];
    return list.filter((account) => !account.disconnected);
  }, [accountsQuery.data]);

  const allAccountOptions = useMemo(
    () => connectedAccounts.map((account) => toAccountOption(account)),
    [connectedAccounts]
  );

  return { accountsQuery, connectedAccounts, allAccountOptions };
}

export function useEnsureSelectedAccount({
  brandId,
  selectedAccountId,
  connectedAccounts,
  setSelectedAccountId,
}: {
  brandId?: string;
  selectedAccountId: string;
  connectedAccounts: ConnectedAccount[];
  setSelectedAccountId: (id: string) => void;
}) {
  useEffect(() => {
    if (!brandId || !connectedAccounts.length) {
      setSelectedAccountId('');
      return;
    }
    if (
      selectedAccountId &&
      connectedAccounts.some((account) => account.id === selectedAccountId)
    ) {
      return;
    }
    setSelectedAccountId(connectedAccounts[0]!.id);
  }, [brandId, connectedAccounts, selectedAccountId, setSelectedAccountId]);
}

export function useResetTransientStateOnAccountChange({
  selectedAccountId,
  setCreateQueueOpen,
  setNewQueueName,
  setPostingGoalOpen,
  setPostingGoalConfirmReplace,
  setQueueToDelete,
}: {
  selectedAccountId: string;
  setCreateQueueOpen: (open: boolean) => void;
  setNewQueueName: (value: string) => void;
  setPostingGoalOpen: (open: boolean) => void;
  setPostingGoalConfirmReplace: (value: boolean) => void;
  setQueueToDelete: (queue: QueueToDelete | null) => void;
}) {
  useEffect(() => {
    setCreateQueueOpen(false);
    setNewQueueName('');
    setPostingGoalOpen(false);
    setPostingGoalConfirmReplace(false);
    setQueueToDelete(null);
  }, [
    selectedAccountId,
    setCreateQueueOpen,
    setNewQueueName,
    setPostingGoalOpen,
    setPostingGoalConfirmReplace,
    setQueueToDelete,
  ]);
}

export function useSelectedAccount(allAccountOptions: AccountOption[], selectedAccountId: string) {
  return useMemo(() => {
    if (!selectedAccountId) {
      return null;
    }
    return allAccountOptions.find((account) => account.id === selectedAccountId) || null;
  }, [allAccountOptions, selectedAccountId]);
}

export function useSelectedAccountQueues(selectedAccountId?: string) {
  const selectedAccountQueuesQuery = useQuery({
    queryKey: ['publishing-queues', selectedAccountId],
    queryFn: () => publishingQueuesApi.listQueuesForSocialAccount(selectedAccountId!),
    enabled: Boolean(selectedAccountId),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const selectedAccountQueues = useMemo(
    () => getQueueList(selectedAccountQueuesQuery.data),
    [selectedAccountQueuesQuery.data]
  );

  return { selectedAccountQueuesQuery, selectedAccountQueues };
}

export function useSelectedQueueState({
  selectedAccount,
  selectedAccountQueues,
  selectedQueueIdsByAccount,
  setSelectedQueueIdsByAccount,
  selectedAccountQueuesLoading,
}: {
  selectedAccount: AccountOption | null;
  selectedAccountQueues: PublishingQueueSummary[];
  selectedQueueIdsByAccount: Record<string, string | null>;
  setSelectedQueueIdsByAccount: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  selectedAccountQueuesLoading: boolean;
}) {
  const selectedQueueId = selectedAccount
    ? selectedQueueIdsByAccount[selectedAccount.id] || null
    : null;
  const selectedQueue = useMemo(() => {
    if (!selectedAccountQueues.length) {
      return null;
    }
    const explicit = selectedQueueId
      ? selectedAccountQueues.find((queue) => queue.id === selectedQueueId) || null
      : null;
    return (
      explicit ||
      selectedAccountQueues.find((queue) => queue.isDefault) ||
      selectedAccountQueues[0] ||
      null
    );
  }, [selectedAccountQueues, selectedQueueId]);

  useEffect(() => {
    if (!selectedAccount?.id || selectedAccountQueuesLoading) {
      return;
    }
    const currentQueueId = selectedQueueIdsByAccount[selectedAccount.id] || null;
    const exists =
      typeof currentQueueId === 'string' &&
      selectedAccountQueues.some((q) => q.id === currentQueueId);
    if (exists) {
      return;
    }
    const fallback = preferredQueueId(selectedAccountQueues);
    if (currentQueueId === fallback) {
      return;
    }
    setSelectedQueueIdsByAccount((prev) => {
      const prevValue = prev[selectedAccount.id] ?? null;
      if (prevValue === fallback) {
        return prev;
      }
      return { ...prev, [selectedAccount.id]: fallback };
    });
  }, [
    selectedAccount?.id,
    selectedAccountQueues,
    selectedAccountQueuesLoading,
    selectedQueueIdsByAccount,
    setSelectedQueueIdsByAccount,
  ]);

  return { selectedQueueId, selectedQueue };
}

export function usePostingGoalState({
  postingGoalOpen,
  postingGoalValue,
  postingGoalCustomValue,
  selectedQueue,
  setPostingGoalConfirmReplace,
}: {
  postingGoalOpen: boolean;
  postingGoalValue: PostingGoalValue;
  postingGoalCustomValue: string;
  selectedQueue: PublishingQueueSummary | null;
  setPostingGoalConfirmReplace: (value: boolean) => void;
}) {
  useEffect(() => {
    if (!postingGoalOpen) {
      setPostingGoalConfirmReplace(false);
    }
  }, [postingGoalOpen, selectedQueue?.id, setPostingGoalConfirmReplace]);

  const selectedPostingGoalPerWeek = useMemo(() => {
    const raw =
      postingGoalValue === 'custom' ? postingGoalCustomValue.trim() : postingGoalValue.trim();
    if (!/^\\d+$/.test(raw)) {
      return null;
    }
    const parsed = Number(raw);
    if (parsed < 1 || parsed > 21) {
      return null;
    }
    return parsed;
  }, [postingGoalCustomValue, postingGoalValue]);

  const postingGoalCustomError = useMemo(() => {
    if (postingGoalValue !== 'custom') {
      return null;
    }
    const raw = postingGoalCustomValue.trim();
    if (!raw) {
      return 'Enter a value between 1 and 21.';
    }
    if (!/^\\d+$/.test(raw)) {
      return 'Use whole numbers only.';
    }
    const parsed = Number(raw);
    if (parsed < 1 || parsed > 21) {
      return 'Pick a value from 1 to 21.';
    }
    return null;
  }, [postingGoalCustomValue, postingGoalValue]);

  const selectedQueueSlotCount =
    selectedQueue && typeof selectedQueue.slotCount === 'number' ? selectedQueue.slotCount : 0;
  const requiresPostingGoalReplaceConfirm = selectedQueueSlotCount > 0;

  return {
    selectedPostingGoalPerWeek,
    postingGoalCustomError,
    selectedQueueSlotCount,
    requiresPostingGoalReplaceConfirm,
  };
}

export {
  useCreateQueueMutation,
  useDeleteQueueMutation,
  useSetDefaultQueueMutation,
  useSetPostingGoalMutation,
} from './use-publishing-schedule-mutations';
