import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  campaign as campaignApi,
  publishingQueues as publishingQueuesApi,
  type Content,
} from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';

import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { CircleFadingPlus, Film, Image as ImageIcon, LayoutGrid } from 'lucide-react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { TouchBackend } from 'react-dnd-touch-backend';
import { isTouchDevice } from '@/components/calendar/FullCalendar/utils/device';

import type {
  PublishingQueueItem,
  PublishingQueueLaneKey,
  PublishingQueueSlotInstance,
  PublishingQueueSummary,
} from '@/lib/api/publishing-queues-client';
import { getDefaultQueueId } from '@/components/publishing-queues/queue-utils';
import {
  getBrandRangeEndUtcMs,
  getBrandRangeStartUtcIso,
  normalizeLaneKey,
} from '@/components/calendar/QueueSchedules/queue-schedules-utils';
import { QueueScheduleLane } from '@/components/calendar/QueueSchedules/QueueScheduleLane';

export function QueueSchedulesView({
  brandId,
  brandTimezone,
  date,
  calendarContent,
  selectedSocialAccountIds,
}: {
  brandId: string;
  brandTimezone: string;
  date: Date;
  calendarContent: Content[];
  selectedSocialAccountIds: string[] | null;
}) {
  const { openSidebar } = useRightSidebarRouter();

  const [selectedLane, setSelectedLane] = useState<'all' | Exclude<PublishingQueueLaneKey, 'any'>>(
    'all'
  );
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);

  const effectiveSocialAccountId = useMemo(() => {
    if (!Array.isArray(selectedSocialAccountIds) || selectedSocialAccountIds.length !== 1)
      return null;
    return selectedSocialAccountIds[0];
  }, [selectedSocialAccountIds]);

  const queuesQuery = useQuery({
    queryKey: ['publishing-queues', effectiveSocialAccountId],
    queryFn: () => publishingQueuesApi.listQueuesForSocialAccount(effectiveSocialAccountId!),
    enabled: Boolean(effectiveSocialAccountId),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const queueId = useMemo(() => {
    if (selectedQueueId) return selectedQueueId;
    const fallback = getDefaultQueueId(queuesQuery.data as any);
    return fallback;
  }, [queuesQuery.data, selectedQueueId]);

  useEffect(() => {
    if (!queueId) return;
    setSelectedQueueId(queueId);
  }, [queueId]);

  useEffect(() => {
    setSelectedQueueId(null);
  }, [effectiveSocialAccountId]);

  const rangeStartUtcIso = useMemo(
    () => getBrandRangeStartUtcIso(date, brandTimezone),
    [brandTimezone, date]
  );
  const rangeEndUtcMs = useMemo(
    () => getBrandRangeEndUtcMs(date, brandTimezone, 7),
    [brandTimezone, date]
  );

  const instancesQuery = useQuery({
    queryKey: ['publishing-queue-slot-instances', queueId, selectedLane, rangeStartUtcIso],
    queryFn: () =>
      publishingQueuesApi.listSlotInstances({
        queueId: queueId!,
        laneKey: selectedLane === 'all' ? undefined : selectedLane,
        limit: 100,
        after: rangeStartUtcIso,
      }),
    enabled: Boolean(queueId),
    staleTime: 0,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const itemsQuery = useQuery({
    queryKey: ['publishing-queue-items', queueId, selectedLane, rangeStartUtcIso],
    queryFn: () =>
      publishingQueuesApi.listQueueItems({
        queueId: queueId!,
        laneKey: selectedLane === 'all' ? undefined : selectedLane,
        limit: 200,
        after: rangeStartUtcIso,
      }),
    enabled: Boolean(queueId),
    staleTime: 0,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const instances = useMemo(() => {
    const raw = instancesQuery.data as any;
    const list = raw?.data?.instances;
    const parsed = Array.isArray(list) ? (list as PublishingQueueSlotInstance[]) : [];
    return parsed
      .slice()
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
      .filter((i) => new Date(i.scheduledAt).getTime() < rangeEndUtcMs);
  }, [instancesQuery.data, rangeEndUtcMs]);

  const queueItems = useMemo(() => {
    const raw = itemsQuery.data as any;
    const lanes = raw?.data?.lanes;
    if (!Array.isArray(lanes)) return [] as PublishingQueueItem[];
    if (selectedLane === 'all') {
      const collected: PublishingQueueItem[] = [];
      for (const lane of lanes) {
        const items = lane?.items;
        if (Array.isArray(items)) collected.push(...(items as PublishingQueueItem[]));
      }
      return collected;
    }
    const lane = lanes.find((l: any) => l?.laneKey === selectedLane) || lanes[0] || null;
    const items = lane?.items;
    return Array.isArray(items) ? (items as PublishingQueueItem[]) : [];
  }, [itemsQuery.data, selectedLane]);

  const itemsByEstimatedMs = useMemo(() => {
    const map = new Map<number, PublishingQueueItem>();
    for (const item of queueItems) {
      if (!item.estimatedScheduledAt) continue;
      const ms = new Date(item.estimatedScheduledAt).getTime();
      if (!Number.isFinite(ms)) continue;
      if (!map.has(ms)) map.set(ms, item);
    }
    return map;
  }, [queueItems]);

  const calendarContentById = useMemo(() => {
    const map = new Map<string, Content>();
    for (const item of calendarContent) {
      if (item && typeof item.id === 'string') map.set(item.id, item);
    }
    return map;
  }, [calendarContent]);

  const primaryAssetIds = useMemo(() => {
    const ids: Array<string | null> = [];

    for (const item of calendarContent) {
      ids.push(item.primaryAssetId || item.mediaAssets?.[0]?.assetId || null);
    }

    for (const qi of queueItems) {
      const primary = qi.content?.primaryAssetId || qi.content?.mediaAssets?.[0]?.assetId || null;
      ids.push(primary);
    }

    return ids;
  }, [calendarContent, queueItems]);
  const { data: assetsById } = useAssetsByIds(primaryAssetIds);
  const nowUtcMs = Date.now();

  const scheduleAheadLimitQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead'],
    queryFn: () => campaignApi.getScheduleAheadLimit(),
    staleTime: 60 * 1000,
  });
  const scheduleAheadLimits = (scheduleAheadLimitQuery.data as any)?.data as
    | { tier: string; maxAllowed: number; currentCount: number }
    | undefined;
  const scheduleAheadAtCapacity =
    !!scheduleAheadLimits &&
    Number.isFinite(scheduleAheadLimits.maxAllowed) &&
    scheduleAheadLimits.currentCount >= scheduleAheadLimits.maxAllowed;

  const unassignedQueueItems = useMemo(
    () => queueItems.filter((i) => !i.estimatedScheduledAt),
    [queueItems]
  );

  const isTouch = typeof window !== 'undefined' ? isTouchDevice() : false;
  const touchDndOptions = isTouch
    ? {
        enableTouchEvents: true,
        enableMouseEvents: true,
        delayTouchStart: 800,
      }
    : undefined;

  return (
    <DndProvider
      backend={isTouch ? TouchBackend : HTML5Backend}
      options={isTouch ? touchDndOptions : undefined}
    >
      <div className="space-y-4">
        <Card className="bg-card">
          <div className="border-border flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
            <Select
              value={selectedQueueId ?? ''}
              onValueChange={(v) => setSelectedQueueId(v)}
              disabled={queuesQuery.isLoading || !effectiveSocialAccountId || !queueId}
            >
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Select a queue" />
              </SelectTrigger>
              <SelectContent>
                {(() => {
                  const raw = queuesQuery.data as any;
                  const list = raw?.data?.queues;
                  const queues = Array.isArray(list) ? (list as PublishingQueueSummary[]) : [];
                  if (queues.length === 0) {
                    return (
                      <SelectItem value="__none" disabled>
                        No queues
                      </SelectItem>
                    );
                  }
                  return queues.map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.name}
                      {q.isDefault ? ' (Default)' : ''}
                    </SelectItem>
                  ));
                })()}
              </SelectContent>
            </Select>

            <Tabs
              value={selectedLane}
              onValueChange={(v) => {
                const next = v === 'all' ? 'all' : normalizeLaneKey(v);
                if (next === 'any') {
                  setSelectedLane('post');
                  return;
                }
                setSelectedLane(next);
              }}
            >
              <TabsList>
                <TabsTrigger value="all" className="gap-1">
                  <LayoutGrid className="h-4 w-4" />
                  <span className="hidden sm:inline">All</span>
                </TabsTrigger>
                <TabsTrigger value="post" className="gap-1">
                  <ImageIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">Posts</span>
                </TabsTrigger>
                <TabsTrigger value="reel" className="gap-1">
                  <Film className="h-4 w-4" />
                  <span className="hidden sm:inline">Reels</span>
                </TabsTrigger>
                <TabsTrigger value="story" className="gap-1">
                  <CircleFadingPlus className="h-4 w-4" />
                  <span className="hidden sm:inline">Stories</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <QueueScheduleLane
            brandId={brandId}
            laneView={selectedLane}
            instances={instances}
            itemsByEstimatedMs={itemsByEstimatedMs}
            calendarContentById={calendarContentById}
            assetsById={assetsById}
            brandTimezone={brandTimezone}
            nowUtcMs={nowUtcMs}
            scheduleAheadAtCapacity={scheduleAheadAtCapacity}
            scheduleAheadLimits={scheduleAheadLimits}
            onCreate={(slotIso, slotLaneKey) => {
              const contentType =
                selectedLane === 'all'
                  ? slotLaneKey === 'post' || slotLaneKey === 'reel' || slotLaneKey === 'story'
                    ? slotLaneKey
                    : 'post'
                  : selectedLane;
              openSidebar('post-create', {
                params: {
                  scheduledAt: slotIso,
                  targetSocialAccountId: effectiveSocialAccountId,
                  contentType,
                },
              });
            }}
            onOpen={(contentId) => openSidebar('post', { id: contentId })}
            unassigned={unassignedQueueItems}
            isLoading={instancesQuery.isLoading || itemsQuery.isLoading}
          />
        </Card>
      </div>
    </DndProvider>
  );
}
