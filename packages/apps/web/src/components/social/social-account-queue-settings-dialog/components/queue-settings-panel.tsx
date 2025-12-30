import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { publishingQueues as publishingQueuesApi } from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';

import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';
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

import { QueueSettingsControls } from './queue-settings-controls';
import { QueueSettingsHeader } from './queue-settings-header';
import { QueueSlotsEditor } from './queue-slots-editor';
import type { SocialAccountQueueSettingsPanelProps } from '../types';
import { getQueuesFromQueryData, getSlotsFromQueryData } from '../utils';

export function SocialAccountQueueSettingsPanel({
  account,
  allAccounts: _allAccounts,
  onClose,
}: SocialAccountQueueSettingsPanelProps) {
  const queryClient = useQueryClient();
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [laneView, setLaneView] = useState<WeeklyCalendarLaneView>('all');
  const [draftSlots, setDraftSlots] = useState<QueueSlotDraft[]>([]);
  const [slotsDirty, setSlotsDirty] = useState(false);
  const [newQueueName, setNewQueueName] = useState('');
  const [queueNameDraft, setQueueNameDraft] = useState('');
  const [createQueueOpen, setCreateQueueOpen] = useState(false);
  const [addSlotDay, setAddSlotDay] = useState<number | null>(null);
  const [newSlotTime, setNewSlotTime] = useState<string>('09:00');
  const [newSlotEnabled, setNewSlotEnabled] = useState<boolean>(true);
  const [newSlotLaneKey, setNewSlotLaneKey] =
    useState<PublishingQueueLaneKey>(DEFAULT_NEW_SLOT_LANE_KEY);

  useEffect(() => {
    setSelectedQueueId(null);
    setLaneView('all');
    setDraftSlots([]);
    setSlotsDirty(false);
    setNewQueueName('');
    setQueueNameDraft('');
    setCreateQueueOpen(false);
    setAddSlotDay(null);
    setNewSlotTime('09:00');
    setNewSlotEnabled(true);
    setNewSlotLaneKey(
      account?.id ? loadDefaultNewSlotLaneKey(account.id) : DEFAULT_NEW_SLOT_LANE_KEY
    );
  }, [account?.id]);

  const setDefaultNewSlotLaneKey = (laneKey: PublishingQueueLaneKey) => {
    setNewSlotLaneKey(laneKey);
    if (!account?.id) return;
    persistDefaultNewSlotLaneKey(account.id, laneKey);
  };

  const queuesQuery = useQuery({
    queryKey: ['publishing-queues', account?.id],
    queryFn: () => publishingQueuesApi.listQueuesForSocialAccount(account!.id),
    enabled: Boolean(account?.id),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const queues = useMemo(() => getQueuesFromQueryData(queuesQuery.data), [queuesQuery.data]);

  const selectedQueue = useMemo(() => {
    if (!queues.length) return null;
    const found = selectedQueueId ? queues.find((q) => q.id === selectedQueueId) : null;
    return found || queues.find((q) => q.isDefault) || queues[0] || null;
  }, [queues, selectedQueueId]);

  useEffect(() => {
    if (!selectedQueue) return;
    setSelectedQueueId(selectedQueue.id);
    setQueueNameDraft(selectedQueue.name);
  }, [selectedQueue]);

  const slotsQuery = useQuery({
    queryKey: ['publishing-queue-slots', selectedQueue?.id],
    queryFn: () => publishingQueuesApi.getQueueSlots(selectedQueue!.id),
    enabled: Boolean(selectedQueue?.id),
    staleTime: CACHE_TIMES.FRESH,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!slotsQuery.data) return;
    if (slotsDirty) return;
    setDraftSlots(normalizeSlots(getSlotsFromQueryData(slotsQuery.data)));
  }, [slotsQuery.data, slotsDirty]);

  const createQueueMutation = useMutation({
    mutationFn: async () => {
      if (!account?.id) throw new Error('Missing social account');
      const name = newQueueName.trim();
      if (!name) throw new Error('Queue name is required');
      return await publishingQueuesApi.createQueue(account.id, name);
    },
    onSuccess: async (res) => {
      if (!res.success || !res.data?.id) {
        toast.error('Failed to create queue');
        return;
      }
      toast.success('Queue created');
      setNewQueueName('');
      setDraftSlots([]);
      setSlotsDirty(false);
      setAddSlotDay(null);
      setCreateQueueOpen(false);
      setSelectedQueueId(res.data.id);
      await queryClient.invalidateQueries({ queryKey: ['publishing-queues', account?.id] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create queue');
    },
  });

  const updateQueueMutation = useMutation({
    mutationFn: async (data: { name?: string; paused?: boolean }) => {
      if (!selectedQueue?.id) throw new Error('Missing queue');
      return await publishingQueuesApi.updateQueue(selectedQueue.id, data);
    },
    onSuccess: async (res) => {
      if (!res.success) {
        toast.error('Failed to update queue');
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['publishing-queues', account?.id] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update queue');
    },
  });

  const saveSlotsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedQueue?.id) throw new Error('Missing queue');
      return await publishingQueuesApi.setQueueSlots(selectedQueue.id, draftSlots);
    },
    onSuccess: async (res) => {
      if (!res.success) {
        toast.error(res.error || 'Failed to save schedule');
        return;
      }
      toast.success('Schedule saved');
      setSlotsDirty(false);
      await queryClient.invalidateQueries({
        queryKey: ['publishing-queue-slots', selectedQueue?.id],
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save schedule');
    },
  });

  const laneSlots = useMemo(() => {
    const filtered =
      laneView === 'all' ? draftSlots.slice() : draftSlots.filter((s) => s.laneKey === laneView);
    return filtered.sort(sortSlots);
  }, [draftSlots, laneView]);

  const addSlot = (dayOfWeek: number, laneKey: PublishingQueueLaneKey) => {
    if (!/^\d{2}:\d{2}$/.test(newSlotTime)) {
      toast.error('Time must be HH:MM');
      return;
    }
    const existing =
      draftSlots.find((s) => s.dayOfWeek === dayOfWeek && s.localTime === newSlotTime) || null;
    if (existing) {
      toast.error(`A slot already exists at that day/time (${laneLabel(existing.laneKey)})`);
      return;
    }
    setDraftSlots((prev) =>
      [...prev, { dayOfWeek, localTime: newSlotTime, laneKey, enabled: newSlotEnabled }].sort(
        sortSlots
      )
    );
    setSlotsDirty(true);
    setAddSlotDay(null);
  };

  const updateSlot = (slot: QueueSlotDraft, patch: Partial<QueueSlotDraft>) => {
    setDraftSlots((prev) =>
      prev.map((s) =>
        s.dayOfWeek === slot.dayOfWeek && s.localTime === slot.localTime ? { ...s, ...patch } : s
      )
    );
    setSlotsDirty(true);
  };

  const deleteSlot = (slot: QueueSlotDraft) => {
    setDraftSlots((prev) =>
      prev.filter((s) => !(s.dayOfWeek === slot.dayOfWeek && s.localTime === slot.localTime))
    );
    setSlotsDirty(true);
  };

  const accountTitle = account
    ? account.displayName || account.username || account.externalAccountId || account.id
    : 'Queue settings';

  return (
    <div className="space-y-6">
      {!account ? (
        <div className="text-muted-foreground text-sm">
          Select a social account to edit its publishing schedule.
        </div>
      ) : (
        <>
          <QueueSettingsHeader
            account={account}
            accountTitle={accountTitle}
            queues={queues}
            queuesLoading={queuesQuery.isLoading}
            selectedQueueId={selectedQueue?.id || ''}
            onSelectQueueId={(queueId) => {
              setSelectedQueueId(queueId);
              setSlotsDirty(false);
              setDraftSlots([]);
              setAddSlotDay(null);
            }}
            createQueueOpen={createQueueOpen}
            onCreateQueueOpenChange={(open) => {
              setCreateQueueOpen(open);
              if (open) setNewQueueName('');
            }}
            newQueueName={newQueueName}
            onNewQueueNameChange={setNewQueueName}
            createQueueDisabled={!account.id}
            creatingQueue={createQueueMutation.isPending}
            onCreateQueue={() => createQueueMutation.mutate()}
          />

          {queuesQuery.isLoading ? (
            <div className="bg-muted h-24 animate-pulse rounded-lg" />
          ) : !selectedQueue ? (
            <div className="text-muted-foreground text-sm">
              No queues found for this social account.
            </div>
          ) : (
            <>
              <QueueSettingsControls
                selectedQueue={selectedQueue}
                queueNameDraft={queueNameDraft}
                onQueueNameDraftChange={setQueueNameDraft}
                onSaveQueueName={() => updateQueueMutation.mutate({ name: queueNameDraft.trim() })}
                savingQueue={updateQueueMutation.isPending}
                newSlotLaneKey={newSlotLaneKey}
                onNewSlotLaneKeyChange={setDefaultNewSlotLaneKey}
                onToggleActive={(active) => updateQueueMutation.mutate({ paused: !active })}
              />

              {slotsQuery.isLoading && draftSlots.length === 0 ? (
                <div className="bg-muted h-48 animate-pulse rounded-lg" />
              ) : (
                <QueueSlotsEditor
                  selectedQueueId={selectedQueue.id}
                  queuePaused={Boolean(selectedQueue.paused)}
                  laneView={laneView}
                  onLaneViewChange={setLaneView}
                  laneSlots={laneSlots}
                  addSlotDay={addSlotDay}
                  onAddSlotDayChange={setAddSlotDay}
                  newSlotTime={newSlotTime}
                  onNewSlotTimeChange={setNewSlotTime}
                  newSlotEnabled={newSlotEnabled}
                  onNewSlotEnabledChange={setNewSlotEnabled}
                  newSlotLaneKey={newSlotLaneKey}
                  onNewSlotLaneKeyChange={setDefaultNewSlotLaneKey}
                  onAddSlot={addSlot}
                  onUpdateSlot={updateSlot}
                  onDeleteSlot={deleteSlot}
                  slotsDirty={slotsDirty}
                  saving={saveSlotsMutation.isPending}
                  onSave={() => saveSlotsMutation.mutate()}
                  onClose={onClose}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
