import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { publishingQueues as publishingQueuesApi } from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import type {
  PublishingQueueLaneKey,
  PublishingQueueSummary,
} from '@/lib/api/publishing-queues-client';
import {
  DEFAULT_NEW_SLOT_LANE_KEY,
  laneLabel,
  loadDefaultNewSlotLaneKey,
  normalizeSlots,
  persistDefaultNewSlotLaneKey,
  sortSlots,
} from '@/components/social/queue-settings-utils';
import type {
  QueueSlotDraft,
  WeeklyCalendarLaneView,
} from '@/components/social/queue-settings-utils/types';
import { saveQueueChanges } from './queue-save-utils';
import type { SocialAccountOption, SocialAccountQueueSettingsPanelProps } from '../types';
import { getQueuesFromQueryData, getSlotsFromQueryData } from '../utils';

export function getAccountTitle(account: SocialAccountOption | null) {
  if (!account) {
    return 'Queue settings';
  }
  return account.displayName || account.username || account.externalAccountId || account.id;
}

export function useControlledQueueSelection({
  selectedQueueId: selectedQueueIdProp,
  onSelectedQueueIdChange,
}: Pick<SocialAccountQueueSettingsPanelProps, 'selectedQueueId' | 'onSelectedQueueIdChange'>) {
  const [internalSelectedQueueId, setInternalSelectedQueueId] = useState<string | null>(null);

  const setSelectedQueueId = useCallback(
    (queueId: string | null) => {
      onSelectedQueueIdChange?.(queueId);
      if (selectedQueueIdProp === undefined) {
        setInternalSelectedQueueId(queueId);
      }
    },
    [onSelectedQueueIdChange, selectedQueueIdProp]
  );

  const resetSelectionForAccountChange = useCallback(() => {
    if (selectedQueueIdProp === undefined) {
      setInternalSelectedQueueId(null);
      return;
    }
    onSelectedQueueIdChange?.(null);
  }, [onSelectedQueueIdChange, selectedQueueIdProp]);

  return {
    selectedQueueId: selectedQueueIdProp ?? internalSelectedQueueId,
    setSelectedQueueId,
    resetSelectionForAccountChange,
  };
}

export function useQueueEditorState(accountId: string | undefined) {
  const [laneView, setLaneView] = useState<WeeklyCalendarLaneView>('all');
  const [draftSlots, setDraftSlots] = useState<QueueSlotDraft[]>([]);
  const [slotsDirty, setSlotsDirty] = useState(false);
  const [newQueueName, setNewQueueName] = useState('');
  const [queueNameDraft, setQueueNameDraft] = useState('');
  const [createQueueOpen, setCreateQueueOpen] = useState(false);
  const [addSlotDay, setAddSlotDay] = useState<number | null>(null);
  const [newSlotTime, setNewSlotTime] = useState<string>('09:00');
  const [newSlotLaneKey, setNewSlotLaneKey] =
    useState<PublishingQueueLaneKey>(DEFAULT_NEW_SLOT_LANE_KEY);

  useEffect(() => {
    setLaneView('all');
    setDraftSlots([]);
    setSlotsDirty(false);
    setNewQueueName('');
    setQueueNameDraft('');
    setCreateQueueOpen(false);
    setAddSlotDay(null);
    setNewSlotTime('09:00');
    setNewSlotLaneKey(accountId ? loadDefaultNewSlotLaneKey(accountId) : DEFAULT_NEW_SLOT_LANE_KEY);
  }, [accountId]);

  const setDefaultNewSlotLaneKey = useCallback(
    (laneKey: PublishingQueueLaneKey) => {
      setNewSlotLaneKey(laneKey);
      if (!accountId) {
        return;
      }
      persistDefaultNewSlotLaneKey(accountId, laneKey);
    },
    [accountId]
  );

  const resetDraftForQueueSwitch = useCallback(() => {
    setSlotsDirty(false);
    setDraftSlots([]);
    setAddSlotDay(null);
  }, []);

  return {
    addSlotDay,
    createQueueOpen,
    draftSlots,
    laneView,
    newQueueName,
    newSlotLaneKey,
    newSlotTime,
    queueNameDraft,
    slotsDirty,
    resetDraftForQueueSwitch,
    setAddSlotDay,
    setCreateQueueOpen,
    setDefaultNewSlotLaneKey,
    setDraftSlots,
    setLaneView,
    setNewQueueName,
    setNewSlotTime,
    setQueueNameDraft,
    setSlotsDirty,
  };
}

export function useQueueList({
  accountId,
  selectedQueueId,
  setQueueNameDraft,
  setSelectedQueueId,
}: {
  accountId: string | undefined;
  selectedQueueId: string | null;
  setQueueNameDraft: (next: string) => void;
  setSelectedQueueId: (queueId: string | null) => void;
}) {
  const queuesQuery = useQuery({
    queryKey: ['publishing-queues', accountId],
    queryFn: () => publishingQueuesApi.listQueuesForSocialAccount(accountId!),
    enabled: Boolean(accountId),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });
  const queues = useMemo(() => getQueuesFromQueryData(queuesQuery.data), [queuesQuery.data]);
  const selectedQueue = useMemo(() => {
    if (!queues.length) {
      return null;
    }
    const queueFromSelection = selectedQueueId
      ? queues.find((queue) => queue.id === selectedQueueId)
      : null;
    return queueFromSelection || queues.find((queue) => queue.isDefault) || queues[0] || null;
  }, [queues, selectedQueueId]);

  useEffect(() => {
    if (!selectedQueue) {
      return;
    }
    if (selectedQueueId !== selectedQueue.id) {
      setSelectedQueueId(selectedQueue.id);
    }
    setQueueNameDraft(selectedQueue.name);
  }, [selectedQueue, selectedQueueId, setQueueNameDraft, setSelectedQueueId]);

  return { queues, queuesLoading: queuesQuery.isLoading, selectedQueue };
}

export function useQueueSlots({
  selectedQueueId,
  slotsDirty,
  setDraftSlots,
}: {
  selectedQueueId: string | undefined;
  slotsDirty: boolean;
  setDraftSlots: (
    next: QueueSlotDraft[] | ((previous: QueueSlotDraft[]) => QueueSlotDraft[])
  ) => void;
}) {
  const slotsQuery = useQuery({
    queryKey: ['publishing-queue-slots', selectedQueueId],
    queryFn: () => publishingQueuesApi.getQueueSlots(selectedQueueId!),
    enabled: Boolean(selectedQueueId),
    staleTime: CACHE_TIMES.FRESH,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!slotsQuery.data || slotsDirty) {
      return;
    }
    setDraftSlots(normalizeSlots(getSlotsFromQueryData(slotsQuery.data)));
  }, [slotsDirty, setDraftSlots, slotsQuery.data]);

  return { slotsLoading: slotsQuery.isLoading };
}

export function useCreateQueueMutation({
  accountId,
  newQueueName,
  onQueueCreated,
}: {
  accountId: string | undefined;
  newQueueName: string;
  onQueueCreated: (queueId: string) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!accountId) {
        throw new Error('Missing social account');
      }
      const name = newQueueName.trim();
      if (!name) {
        throw new Error('Queue name is required');
      }
      return await publishingQueuesApi.createQueue(accountId, name);
    },
    onSuccess: async (response) => {
      if (!response.success || !response.data?.id) {
        toast.error('Failed to create queue');
        return;
      }
      onQueueCreated(response.data.id);
      toast.success('Queue created');
      await queryClient.invalidateQueries({ queryKey: ['publishing-queues', accountId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create queue');
    },
  });
}

export function useQueueSlotActions({
  draftSlots,
  newSlotTime,
  setAddSlotDay,
  setDraftSlots,
  setSlotsDirty,
}: {
  draftSlots: QueueSlotDraft[];
  newSlotTime: string;
  setAddSlotDay: (dayOfWeek: number | null) => void;
  setDraftSlots: (
    next: QueueSlotDraft[] | ((previous: QueueSlotDraft[]) => QueueSlotDraft[])
  ) => void;
  setSlotsDirty: (next: boolean) => void;
}) {
  const addSlot = useCallback(
    (dayOfWeek: number, laneKey: PublishingQueueLaneKey) => {
      if (!/^\d{2}:\d{2}$/.test(newSlotTime)) {
        toast.error('Time must be HH:MM');
        return;
      }
      const existingSlot =
        draftSlots.find((slot) => slot.dayOfWeek === dayOfWeek && slot.localTime === newSlotTime) ||
        null;
      if (existingSlot) {
        toast.error(`A slot already exists at that day/time (${laneLabel(existingSlot.laneKey)})`);
        return;
      }
      setDraftSlots((previous) =>
        [...previous, { dayOfWeek, localTime: newSlotTime, laneKey }].sort(sortSlots)
      );
      setSlotsDirty(true);
      setAddSlotDay(null);
    },
    [draftSlots, newSlotTime, setAddSlotDay, setDraftSlots, setSlotsDirty]
  );

  const updateSlot = useCallback(
    (slot: QueueSlotDraft, patch: Partial<QueueSlotDraft>) => {
      setDraftSlots((previous) =>
        previous.map((item) =>
          item.dayOfWeek === slot.dayOfWeek && item.localTime === slot.localTime
            ? { ...item, ...patch }
            : item
        )
      );
      setSlotsDirty(true);
    },
    [setDraftSlots, setSlotsDirty]
  );

  const deleteSlot = useCallback(
    (slot: QueueSlotDraft) => {
      setDraftSlots((previous) =>
        previous.filter(
          (item) => !(item.dayOfWeek === slot.dayOfWeek && item.localTime === slot.localTime)
        )
      );
      setSlotsDirty(true);
    },
    [setDraftSlots, setSlotsDirty]
  );

  return { addSlot, deleteSlot, updateSlot };
}

export function useSaveAllChangesAction({
  queueNameDraft,
  selectedQueue,
  slotsDirty,
  updateQueue,
  saveSlots,
}: {
  queueNameDraft: string;
  selectedQueue: PublishingQueueSummary | null;
  slotsDirty: boolean;
  updateQueue: (data: { name?: string; isDefault?: boolean }) => Promise<{ success: boolean }>;
  saveSlots: () => Promise<{ success: boolean }>;
}) {
  return useCallback(async () => {
    if (!selectedQueue) {
      return;
    }
    try {
      await saveQueueChanges({
        selectedQueueName: selectedQueue.name,
        queueNameDraft,
        slotsDirty,
        updateQueue,
        saveSlots,
      });
    } catch {
      // Mutation handlers already report errors via toasts.
    }
  }, [queueNameDraft, saveSlots, selectedQueue, slotsDirty, updateQueue]);
}
