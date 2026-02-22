import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { publishingQueues as publishingQueuesApi } from '@/lib/api';
import type { QueueSlotDraft } from '@/components/social/queue-settings-utils/types';

type UseQueueSaveMutationsArgs = {
  accountId?: string;
  selectedQueueId?: string;
  draftSlots: QueueSlotDraft[];
  onSlotsSaved: () => void;
};

export function useQueueSaveMutations({
  accountId,
  selectedQueueId,
  draftSlots,
  onSlotsSaved,
}: UseQueueSaveMutationsArgs) {
  const queryClient = useQueryClient();

  const updateQueueMutation = useMutation({
    mutationFn: async (data: { name?: string; isDefault?: boolean }) => {
      if (!selectedQueueId) {
        throw new Error('Missing queue');
      }
      return await publishingQueuesApi.updateQueue(selectedQueueId, data);
    },
    onSuccess: async (res) => {
      if (!res.success) {
        toast.error('Failed to update queue');
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['publishing-queues', accountId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update queue');
    },
  });

  const saveSlotsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedQueueId) {
        throw new Error('Missing queue');
      }
      return await publishingQueuesApi.setQueueSlots(selectedQueueId, draftSlots);
    },
    onSuccess: async (res) => {
      if (!res.success) {
        toast.error(res.error || 'Failed to save schedule');
        return;
      }
      toast.success('Schedule saved');
      onSlotsSaved();
      await queryClient.invalidateQueries({
        queryKey: ['publishing-queue-slots', selectedQueueId],
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save schedule');
    },
  });

  return { updateQueueMutation, saveSlotsMutation };
}
