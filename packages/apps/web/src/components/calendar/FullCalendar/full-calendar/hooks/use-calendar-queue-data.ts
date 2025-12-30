import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { publishingQueues as publishingQueuesApi, type Content } from '@/lib/api';
import type { PublishingQueueItem } from '@/lib/api/publishing-queues-client';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { getDefaultQueueId } from '@/components/publishing-queues/queue-utils';

import type { PlaceholderItem } from '../../types';
import { getQueueSlotRange } from '../utils';
import { useQueueSlotPlaceholders } from './use-queue-slot-placeholders';
import type { OptimisticCalendarOp } from './use-calendar-event-drop';

type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type QueueCapacity = {
  current: number | null;
  max: number | null;
  atCapacity: boolean;
};

type SlotRange = ReturnType<typeof getQueueSlotRange> | null;

type UseCalendarQueueDataParams = {
  brandId: string;
  brandTimezone: string;
  view: 'month' | 'week';
  date: Date;
  weekStartsOn: WeekStartsOn;
  content: Content[];
  effectiveSingleDestinationId: string | null;
  optimisticByContentId: Record<string, OptimisticCalendarOp>;
};

type UseCalendarQueueDataResult = {
  queueId: string | null;
  queueCapacity: QueueCapacity;
  queueItems: PublishingQueueItem[];
  queueEstimatedContent: Content[];
  queueSlotPlaceholders: PlaceholderItem[];
};

export function useCalendarQueueData({
  brandId,
  brandTimezone,
  view,
  date,
  weekStartsOn,
  content,
  effectiveSingleDestinationId,
  optimisticByContentId,
}: UseCalendarQueueDataParams): UseCalendarQueueDataResult {
  const slotRange: SlotRange = useMemo(
    () =>
      effectiveSingleDestinationId
        ? getQueueSlotRange({ view, date, timezone: brandTimezone, weekStartsOn })
        : null,
    [brandTimezone, date, effectiveSingleDestinationId, view, weekStartsOn]
  );

  const queuesQuery = useQuery({
    queryKey: ['publishing-queues', effectiveSingleDestinationId],
    queryFn: () => publishingQueuesApi.listQueuesForSocialAccount(effectiveSingleDestinationId!),
    enabled: Boolean(effectiveSingleDestinationId),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const queueCapacity: QueueCapacity = useMemo(() => {
    const raw = queuesQuery.data as any;
    const current = raw?.data?.queueDepthCurrent;
    const max = raw?.data?.queueDepthMax;
    const currentNum = typeof current === 'number' && Number.isFinite(current) ? current : null;
    const maxNum = typeof max === 'number' && Number.isFinite(max) ? max : null;
    return {
      current: currentNum,
      max: maxNum,
      atCapacity: currentNum !== null && maxNum !== null && currentNum >= maxNum,
    };
  }, [queuesQuery.data]);

  const queueId = useMemo(() => getDefaultQueueId(queuesQuery.data as any), [queuesQuery.data]);

  const slotInstancesQuery = useQuery({
    queryKey: ['publishing-queue-slot-instances-calendar', queueId, slotRange?.afterUtcIso, view],
    queryFn: () =>
      publishingQueuesApi.listSlotInstances({
        queueId: queueId!,
        limit: slotRange?.limit ?? 200,
        after: slotRange?.afterUtcIso,
      }),
    enabled: Boolean(queueId && effectiveSingleDestinationId && slotRange?.afterUtcIso),
    staleTime: 0,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const queueItemsQuery = useQuery({
    queryKey: ['publishing-queue-items-calendar', queueId, view],
    queryFn: () =>
      publishingQueuesApi.listQueueItems({
        queueId: queueId!,
        limit: 200,
      }),
    enabled: Boolean(queueId && effectiveSingleDestinationId),
    staleTime: 0,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const queueItems = useMemo(() => {
    const raw = queueItemsQuery.data as any;
    const lanes = raw?.data?.lanes;
    if (!Array.isArray(lanes)) return [] as PublishingQueueItem[];
    const collected: PublishingQueueItem[] = [];
    for (const lane of lanes) {
      const items = lane?.items;
      if (Array.isArray(items)) collected.push(...(items as PublishingQueueItem[]));
    }
    return collected;
  }, [queueItemsQuery.data]);

  const queueItemsByEstimatedMs = useMemo(() => {
    const map = new Map<number, PublishingQueueItem>();
    for (const item of queueItems) {
      if (!item.estimatedScheduledAt) continue;
      const ms = new Date(item.estimatedScheduledAt).getTime();
      if (!Number.isFinite(ms)) continue;
      if (!map.has(ms)) map.set(ms, item);
    }
    return map;
  }, [queueItems]);

  const occupiedTimesUtcMsSorted = useMemo(() => {
    if (!effectiveSingleDestinationId) return [] as number[];

    const occupied: number[] = [];

    // Optimistic drops should immediately reserve the target slot.
    for (const op of Object.values(optimisticByContentId)) {
      const scheduledAt = op?.override?.scheduledAt;
      if (!scheduledAt) continue;
      const ms = new Date(scheduledAt).getTime();
      if (Number.isFinite(ms)) occupied.push(ms);
    }

    // Pinned / scheduled content within the month data.
    for (const item of content) {
      if (!item?.scheduledAt) continue;
      const ms = new Date(item.scheduledAt).getTime();
      if (Number.isFinite(ms)) occupied.push(ms);
    }

    // Queue-estimated schedule (computed server-side).
    for (const ms of queueItemsByEstimatedMs.keys()) {
      if (Number.isFinite(ms)) occupied.push(ms);
    }

    occupied.sort((a, b) => a - b);
    return occupied;
  }, [content, effectiveSingleDestinationId, optimisticByContentId, queueItemsByEstimatedMs]);

  const queueEstimatedContent = useMemo(() => {
    if (!effectiveSingleDestinationId) return [] as Content[];
    if (!slotRange) return [] as Content[];

    const endUtcMs = slotRange.endUtcMs;
    const nowUtcMs = Date.now();
    const out: Content[] = [];

    for (const [ms, item] of queueItemsByEstimatedMs.entries()) {
      if (ms < nowUtcMs || ms >= endUtcMs) continue;
      const base = item.content;
      const status = (() => {
        const raw = base?.status;
        return raw === 'draft' ||
          raw === 'scheduled' ||
          raw === 'published' ||
          raw === 'failed' ||
          raw === 'skipped'
          ? raw
          : 'draft';
      })();

      out.push({
        id: item.contentId,
        caption: base?.caption ?? '',
        status,
        scheduledAt: new Date(ms).toISOString(),
        postedAt: null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        brandId,
        targetSocialAccountId: effectiveSingleDestinationId,
        contentType: base?.contentType ?? null,
        primaryAssetId: base?.primaryAssetId ?? null,
        mediaAssets: (base as any)?.mediaAssets ?? null,
        mediaAssetCount: (base as any)?.mediaAssetCount ?? null,
        publishingQueueItemId: item.id,
      });
    }

    return out;
  }, [brandId, effectiveSingleDestinationId, queueItemsByEstimatedMs, slotRange]);

  const queueSlotPlaceholders = useQueueSlotPlaceholders({
    effectiveSingleDestinationId,
    slotRange,
    slotInstancesData: slotInstancesQuery.data,
    occupiedTimesUtcMsSorted,
    queueAtCapacity: queueCapacity.atCapacity,
  });

  return {
    queueId,
    queueCapacity,
    queueItems,
    queueEstimatedContent,
    queueSlotPlaceholders,
  };
}
