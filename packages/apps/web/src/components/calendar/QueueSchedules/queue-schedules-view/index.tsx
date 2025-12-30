import { useState } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { TouchBackend } from 'react-dnd-touch-backend';
import { CircleFadingPlus, Film, Image as ImageIcon, LayoutGrid } from 'lucide-react';

import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import type { Content } from '@/lib/api';
import type {
  PublishingQueueLaneKey,
  PublishingQueueSummary,
} from '@/lib/api/publishing-queues-client';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isTouchDevice } from '@/components/calendar/FullCalendar/utils/device';
import { normalizeLaneKey } from '@/components/calendar/QueueSchedules/queue-schedules-utils';
import { QueueScheduleLane } from '@/components/calendar/QueueSchedules/queue-schedule-lane';

import { useQueueSchedulesQueries } from './hooks/use-queue-schedules-queries';

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

  const {
    assetsById,
    calendarContentById,
    effectiveSocialAccountId,
    instances,
    instancesQuery,
    itemsByEstimatedMs,
    itemsQuery,
    nowUtcMs,
    queueId,
    queuesQuery,
    scheduleAheadAtCapacity,
    scheduleAheadLimits,
    unassignedQueueItems,
  } = useQueueSchedulesQueries({
    brandId,
    brandTimezone,
    date,
    calendarContent,
    selectedSocialAccountIds,
    selectedLane,
    selectedQueueId,
    setSelectedQueueId,
  });

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
