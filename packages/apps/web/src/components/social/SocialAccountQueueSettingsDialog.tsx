import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { publishingQueues as publishingQueuesApi } from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import type { Platform } from '@/lib/platform-config';
import { cn } from '@/lib/utils';

import { SocialAccountAvatar } from '@/components/social/SocialAccountAvatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LayoutGrid, Plus, X } from 'lucide-react';

import type {
  PublishingQueueLaneKey,
  PublishingQueueSlot,
  PublishingQueueSummary,
} from '@/lib/api/publishing-queues-client';
import {
  DEFAULT_NEW_SLOT_LANE_KEY,
  WEEK_DAYS,
  laneIcon,
  laneLabel,
  loadDefaultNewSlotLaneKey,
  normalizeSlots,
  persistDefaultNewSlotLaneKey,
  sortSlots,
  type PublishingQueueContentLaneKey,
  type QueueSlotDraft,
  type WeeklyCalendarLaneView,
} from '@/components/social/queue-settings-utils';

export type SocialAccountOption = {
  id: string;
  platform: string;
  username?: string | null;
  displayName?: string | null;
  externalAccountId?: string | null;
  profilePictureUrl?: string | null;
};

export function SocialAccountQueueSettingsPanel({
  account,
  allAccounts: _allAccounts,
  onClose,
}: {
  account: SocialAccountOption | null;
  allAccounts: SocialAccountOption[];
  onClose?: () => void;
}) {
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

  const queues = useMemo(() => {
    const raw = queuesQuery.data as any;
    const list = raw?.data?.queues;
    return Array.isArray(list) ? (list as PublishingQueueSummary[]) : [];
  }, [queuesQuery.data]);

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
    const raw = slotsQuery.data as any;
    const slots = Array.isArray(raw?.data?.slots) ? (raw.data.slots as PublishingQueueSlot[]) : [];
    setDraftSlots(normalizeSlots(slots));
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
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-1">
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Social account
                </div>
                <div className="flex items-center gap-2">
                  <SocialAccountAvatar
                    platform={account.platform as Platform}
                    name={accountTitle}
                    src={account.profilePictureUrl || null}
                    size="sm"
                    muted={false}
                  />
                  <div className="truncate text-sm font-medium">{accountTitle}</div>
                </div>
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
                <div className="w-full sm:w-[240px]">
                  <Label className="sr-only">Queue</Label>
                  <Select
                    value={selectedQueue?.id || ''}
                    onValueChange={(v) => {
                      setSelectedQueueId(v);
                      setSlotsDirty(false);
                      setDraftSlots([]);
                      setAddSlotDay(null);
                    }}
                    disabled={queuesQuery.isLoading}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={queuesQuery.isLoading ? 'Loading…' : 'Select a queue'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {queues.map((q) => (
                        <SelectItem key={q.id} value={q.id}>
                          {q.name}
                          {q.isDefault ? ' (Default)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Popover
                  open={createQueueOpen}
                  onOpenChange={(open) => {
                    setCreateQueueOpen(open);
                    if (open) setNewQueueName('');
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!account?.id || createQueueMutation.isPending}
                    >
                      Create queue
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72">
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <div className="text-sm font-medium">Create queue</div>
                        <div className="text-muted-foreground text-xs">
                          Starts with an empty publishing schedule.
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Queue name</Label>
                        <Input
                          value={newQueueName}
                          onChange={(e) => setNewQueueName(e.target.value)}
                          placeholder="e.g. Evergreen"
                          autoFocus
                        />
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setCreateQueueOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          disabled={createQueueMutation.isPending || !newQueueName.trim()}
                          onClick={() => createQueueMutation.mutate()}
                        >
                          Create
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="bg-muted/30 border-border space-y-4 rounded-lg border p-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2 lg:col-span-2">
                  <Label>Queue name</Label>
                  <div className="flex gap-2">
                    <Input
                      value={queueNameDraft}
                      onChange={(e) => setQueueNameDraft(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !selectedQueue?.id ||
                        !queueNameDraft.trim() ||
                        updateQueueMutation.isPending
                      }
                      onClick={() => updateQueueMutation.mutate({ name: queueNameDraft.trim() })}
                    >
                      Save
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Queue status</Label>
                  <div className="bg-background flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {selectedQueue?.paused ? 'Paused' : 'Active'}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {selectedQueue?.paused
                          ? 'Queue items won’t be scheduled.'
                          : 'Queue items can be scheduled into upcoming slots.'}
                      </div>
                    </div>
                    <Switch
                      checked={!selectedQueue?.paused}
                      disabled={!selectedQueue?.id || updateQueueMutation.isPending}
                      onCheckedChange={(checked) =>
                        updateQueueMutation.mutate({ paused: !checked })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Default new slot type</Label>
                  <Select
                    value={newSlotLaneKey}
                    onValueChange={(v) => setDefaultNewSlotLaneKey(v as PublishingQueueLaneKey)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">
                        <span className="flex items-center gap-2">
                          {laneIcon('any')}
                          Any post
                        </span>
                      </SelectItem>
                      <SelectItem value="post">
                        <span className="flex items-center gap-2">
                          {laneIcon('post')}
                          Posts
                        </span>
                      </SelectItem>
                      <SelectItem value="reel">
                        <span className="flex items-center gap-2">
                          {laneIcon('reel')}
                          Reels
                        </span>
                      </SelectItem>
                      <SelectItem value="story">
                        <span className="flex items-center gap-2">
                          {laneIcon('story')}
                          Stories
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="text-muted-foreground text-xs">
                    Used when adding slots from the All tab.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {queuesQuery.isLoading ? (
            <div className="bg-muted h-24 animate-pulse rounded-lg" />
          ) : !selectedQueue ? (
            <div className="text-muted-foreground text-sm">
              No queues found for this social account.
            </div>
          ) : slotsQuery.isLoading && draftSlots.length === 0 ? (
            <div className="bg-muted h-48 animate-pulse rounded-lg" />
          ) : (
            <>
              {selectedQueue.paused ? (
                <div className="bg-muted border-border rounded-lg border p-3">
                  <div className="text-sm font-medium">Queue paused</div>
                  <div className="text-muted-foreground text-xs">
                    Scheduling is paused for this queue. Turn it back on in Queue status to start
                    filling slots.
                  </div>
                </div>
              ) : null}

              <Tabs
                value={laneView}
                onValueChange={(v) => {
                  const next = v === 'all' ? 'all' : (v as PublishingQueueContentLaneKey);
                  setLaneView(next);
                  setAddSlotDay(null);
                }}
              >
                <TabsList>
                  <TabsTrigger value="all" className="gap-1 px-2 text-xs sm:px-3 sm:text-sm">
                    <LayoutGrid className="h-4 w-4" />
                    <span className="hidden sm:inline">All</span>
                  </TabsTrigger>
                  <TabsTrigger value="post" className="gap-1 px-2 text-xs sm:px-3 sm:text-sm">
                    {laneIcon('post', 'h-4 w-4')}
                    <span className="hidden sm:inline">Posts</span>
                  </TabsTrigger>
                  <TabsTrigger value="reel" className="gap-1 px-2 text-xs sm:px-3 sm:text-sm">
                    {laneIcon('reel', 'h-4 w-4')}
                    <span className="hidden sm:inline">Reels</span>
                  </TabsTrigger>
                  <TabsTrigger value="story" className="gap-1 px-2 text-xs sm:px-3 sm:text-sm">
                    {laneIcon('story', 'h-4 w-4')}
                    <span className="hidden sm:inline">Stories</span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value={laneView} className="space-y-3">
                  <div className="text-muted-foreground text-sm">
                    {laneView === 'all' ? (
                      <>
                        This shows all weekly slots for this queue. When you create a post, its type
                        decides which slots it uses.
                      </>
                    ) : (
                      <>
                        Click <span className="text-foreground font-medium">+</span> to add time
                        slots. Posts of this type will land in the next available slot.
                      </>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <div className="grid min-w-[880px] grid-cols-7 gap-2">
                      {WEEK_DAYS.map((day) => {
                        const daySlots = laneSlots
                          .filter((s) => s.dayOfWeek === day.value)
                          .sort(sortSlots);
                        const dayLabel = day.label.slice(0, 3);
                        const popoverOpen = addSlotDay === day.value;
                        const laneKeyForAdd =
                          laneView === 'all'
                            ? newSlotLaneKey
                            : (laneView as PublishingQueueLaneKey);

                        return (
                          <div
                            key={day.value}
                            className="bg-muted/20 border-border flex min-h-[160px] flex-col gap-1.5 rounded-lg border p-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-foreground text-xs font-semibold tracking-wide uppercase">
                                {dayLabel}
                              </div>
                              <Popover
                                open={popoverOpen}
                                onOpenChange={(open) => setAddSlotDay(open ? day.value : null)}
                              >
                                <PopoverTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Add slot for ${day.label}`}
                                    disabled={!selectedQueue?.id}
                                    className="size-7"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent align="end" className="w-64">
                                  <div className="space-y-3">
                                    <div>
                                      <div className="text-sm font-medium">Add slot</div>
                                      <div className="text-muted-foreground text-xs">
                                        {day.label}
                                      </div>
                                    </div>

                                    <div className="space-y-2">
                                      <Label>Time</Label>
                                      <Input
                                        type="time"
                                        value={newSlotTime}
                                        onChange={(e) => setNewSlotTime(e.target.value)}
                                      />
                                    </div>

                                    {laneView === 'all' ? (
                                      <div className="space-y-2">
                                        <Label>Type</Label>
                                        <Select
                                          value={newSlotLaneKey}
                                          onValueChange={(v) =>
                                            setDefaultNewSlotLaneKey(v as PublishingQueueLaneKey)
                                          }
                                        >
                                          <SelectTrigger>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="any">
                                              <span className="flex items-center gap-2">
                                                {laneIcon('any', 'h-4 w-4')}
                                                Any post
                                              </span>
                                            </SelectItem>
                                            <SelectItem value="post">
                                              <span className="flex items-center gap-2">
                                                {laneIcon('post', 'h-4 w-4')}
                                                Posts
                                              </span>
                                            </SelectItem>
                                            <SelectItem value="reel">
                                              <span className="flex items-center gap-2">
                                                {laneIcon('reel', 'h-4 w-4')}
                                                Reels
                                              </span>
                                            </SelectItem>
                                            <SelectItem value="story">
                                              <span className="flex items-center gap-2">
                                                {laneIcon('story', 'h-4 w-4')}
                                                Stories
                                              </span>
                                            </SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    ) : null}

                                    <div className="flex items-center justify-between gap-3">
                                      <div className="flex items-center gap-2">
                                        <Switch
                                          checked={newSlotEnabled}
                                          onCheckedChange={setNewSlotEnabled}
                                        />
                                        <div className="text-sm">Enabled</div>
                                      </div>
                                      <Button
                                        type="button"
                                        onClick={() => addSlot(day.value, laneKeyForAdd)}
                                      >
                                        Add
                                      </Button>
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            </div>

                            {daySlots.length === 0 ? (
                              <div className="text-muted-foreground text-xs">No slots</div>
                            ) : (
                              <div className="space-y-1.5">
                                {daySlots.map((slot) => (
                                  <div
                                    key={`${slot.dayOfWeek}-${slot.localTime}`}
                                    className={cn(
                                      'bg-background border-border group flex items-center justify-between gap-1.5 rounded-md border px-2 py-1',
                                      !slot.enabled && 'opacity-60'
                                    )}
                                  >
                                    <div className="min-w-0">
                                      <div className="font-mono text-xs">{slot.localTime}</div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                      <Switch
                                        checked={slot.enabled}
                                        onCheckedChange={(checked) =>
                                          updateSlot(slot, { enabled: checked })
                                        }
                                        className="origin-right scale-[0.7]"
                                      />

                                      {laneView === 'all' ? (
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon-sm"
                                              aria-label="Change slot type"
                                              className="text-muted-foreground hover:text-foreground size-6"
                                            >
                                              {laneIcon(slot.laneKey, 'h-3 w-3')}
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            <DropdownMenuItem
                                              onSelect={() => updateSlot(slot, { laneKey: 'any' })}
                                            >
                                              {laneIcon('any')}
                                              Any post
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onSelect={() => updateSlot(slot, { laneKey: 'post' })}
                                            >
                                              {laneIcon('post')}
                                              Posts
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onSelect={() => updateSlot(slot, { laneKey: 'reel' })}
                                            >
                                              {laneIcon('reel')}
                                              Reels
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onSelect={() =>
                                                updateSlot(slot, { laneKey: 'story' })
                                              }
                                            >
                                              {laneIcon('story')}
                                              Stories
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      ) : null}

                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Delete slot"
                                        onClick={() => deleteSlot(slot)}
                                        className="text-muted-foreground hover:text-foreground size-6 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              {slotsDirty ? (
                <div className="text-muted-foreground text-xs">Unsaved changes</div>
              ) : null}

              <DialogFooter className="gap-2 sm:gap-0">
                {onClose ? (
                  <Button type="button" variant="outline" onClick={onClose}>
                    Close
                  </Button>
                ) : null}
                <Button
                  type="button"
                  disabled={!selectedQueue?.id || saveSlotsMutation.isPending || !slotsDirty}
                  onClick={() => saveSlotsMutation.mutate()}
                >
                  Save publishing schedule
                </Button>
              </DialogFooter>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function SocialAccountQueueSettingsDialog({
  open,
  onOpenChange,
  account,
  allAccounts,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  account: SocialAccountOption | null;
  allAccounts: SocialAccountOption[];
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Publishing Schedule</DialogTitle>
          <DialogDescription>Configure weekly time slots per queue.</DialogDescription>
        </DialogHeader>
        <SocialAccountQueueSettingsPanel
          account={account}
          allAccounts={allAccounts}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
