import { useMutation, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { publishingQueues as publishingQueuesApi } from '@/lib/api';
import type { QueueToDelete } from './types';

export function useCreateQueueMutation({
  queryClient,
  selectedAccountId,
  newQueueName,
  setNewQueueName,
  setCreateQueueOpen,
  setSelectedQueueIdsByAccount,
}: {
  queryClient: QueryClient;
  selectedAccountId?: string;
  newQueueName: string;
  setNewQueueName: (value: string) => void;
  setCreateQueueOpen: (open: boolean) => void;
  setSelectedQueueIdsByAccount: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
}) {
  return useMutation({
    mutationFn: async () => {
      if (!selectedAccountId) {
        throw new Error('Select a social account first');
      }
      const name = newQueueName.trim();
      if (!name) {
        throw new Error('Queue name is required');
      }
      return publishingQueuesApi.createQueue(selectedAccountId, name);
    },
    onSuccess: async (res) => {
      if (!selectedAccountId || !res.success || !res.data?.id) {
        toast.error('Failed to create queue');
        return;
      }
      toast.success('Queue created');
      setNewQueueName('');
      setCreateQueueOpen(false);
      setSelectedQueueIdsByAccount((prev) => ({ ...prev, [selectedAccountId]: res.data!.id }));
      await queryClient.invalidateQueries({ queryKey: ['publishing-queues', selectedAccountId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create queue');
    },
  });
}

export function useSetDefaultQueueMutation({
  queryClient,
  selectedAccountId,
  selectedQueueId,
}: {
  queryClient: QueryClient;
  selectedAccountId?: string;
  selectedQueueId?: string | null;
}) {
  return useMutation({
    mutationFn: async () => {
      if (!selectedAccountId || !selectedQueueId) {
        throw new Error('Select a queue first');
      }
      return publishingQueuesApi.updateQueue(selectedQueueId, { isDefault: true });
    },
    onSuccess: async (res) => {
      if (!selectedAccountId || !res.success) {
        toast.error('Failed to set default queue');
        return;
      }
      toast.success('Default queue updated');
      await queryClient.invalidateQueries({ queryKey: ['publishing-queues', selectedAccountId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to set default queue');
    },
  });
}

export function useDeleteQueueMutation({
  queryClient,
  setSelectedQueueIdsByAccount,
  setQueueToDelete,
}: {
  queryClient: QueryClient;
  setSelectedQueueIdsByAccount: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  setQueueToDelete: (queue: QueueToDelete | null) => void;
}) {
  return useMutation({
    mutationFn: async (payload: QueueToDelete) => {
      const res = await publishingQueuesApi.deleteQueue(payload.queueId);
      return { ...res, ...payload };
    },
    onSuccess: async (res) => {
      const { accountId, queueId, queueName } = res;
      if (!res.success) {
        toast.error('Failed to delete queue');
        return;
      }
      setSelectedQueueIdsByAccount((prev) => ({
        ...prev,
        [accountId]: prev[accountId] === queueId ? null : (prev[accountId] ?? null),
      }));
      setQueueToDelete(null);
      const movedItemsCount =
        typeof res?.data?.movedItemsCount === 'number' ? res.data.movedItemsCount : 0;
      toast.success(
        movedItemsCount > 0
          ? `Deleted "${queueName}". Moved ${movedItemsCount} queued post${movedItemsCount === 1 ? '' : 's'} to default queue.`
          : `Deleted "${queueName}".`
      );
      await queryClient.invalidateQueries({ queryKey: ['publishing-queues', accountId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete queue');
    },
  });
}

export function useSetPostingGoalMutation({
  queryClient,
  selectedAccountId,
  setPostingGoalOpen,
  setPostingGoalConfirmReplace,
}: {
  queryClient: QueryClient;
  selectedAccountId?: string;
  setPostingGoalOpen: (open: boolean) => void;
  setPostingGoalConfirmReplace: (value: boolean) => void;
}) {
  return useMutation({
    mutationFn: async (payload: { queueId: string; postsPerWeek: number }) => {
      return publishingQueuesApi.applyPostingGoal(payload.queueId, payload.postsPerWeek);
    },
    onSuccess: async (res, payload) => {
      if (!selectedAccountId) {
        return;
      }
      if (!res.success) {
        toast.error('Failed to apply cadence');
        return;
      }
      const createdSlots = typeof res.data?.createdSlots === 'number' ? res.data.createdSlots : 0;
      const conflicts =
        typeof res.data?.conflictingSlots === 'number' ? res.data.conflictingSlots : 0;
      toast.success(
        conflicts > 0
          ? `Cadence applied. Added ${createdSlots} slot${createdSlots === 1 ? '' : 's'} and skipped ${conflicts} conflicting time${conflicts === 1 ? '' : 's'}.`
          : `Cadence applied. Added ${createdSlots} weekly slot${createdSlots === 1 ? '' : 's'}.`
      );
      setPostingGoalOpen(false);
      setPostingGoalConfirmReplace(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['publishing-queue-slots', payload.queueId] }),
        queryClient.invalidateQueries({ queryKey: ['publishing-queues', selectedAccountId] }),
      ]);
    },
    onError: (error: unknown) => {
      const apiError = error as { data?: { error?: string } };
      const code = apiError?.data?.error;
      if (code === 'no_available_slots') {
        toast.error('No available times left for this account. Remove conflicting slots first.');
        return;
      }
      if (code === 'invalid_posts_per_week') {
        toast.error('Goal must be between 1 and 21 posts per week.');
        return;
      }
      if (code === 'slot_conflict') {
        toast.error('Schedule conflict detected. Try again.');
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Failed to apply cadence');
    },
  });
}
