import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  brand as brandApi,
  publishingQueues as publishingQueuesApi,
  type Content,
  httpGet,
} from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import { getDefaultQueueId } from '@/components/publishing-queues/queue-utils';
import type {
  PublishingQueueItem,
  PublishingQueueLaneKey,
  PublishingQueueSlotInstance,
} from '@/lib/api/publishing-queues-client';
import {
  getBrandRangeEndUtcMs,
  getBrandRangeStartUtcIso,
} from '@/components/calendar/QueueSchedules/queue-schedules-utils';

type SelectedLane = 'all' | Exclude<PublishingQueueLaneKey, 'any'>;

type UseQueueSchedulesQueriesParams = {
  brandId: string;
  brandTimezone: string;
  date: Date;
  calendarContent: Content[];
  selectedSocialAccountIds: string[] | null;
  selectedLane: SelectedLane;
  selectedQueueId: string | null;
  setSelectedQueueId: (next: string | null) => void;
};

function getFallbackSocialAccountId(data: unknown) {
  const raw = data as any;
  const list = Array.isArray(raw?.socialAccounts) ? (raw.socialAccounts as any[]) : [];
  const connected = list.filter(
    (account) => account?.disconnected !== true && typeof account?.id === 'string'
  );
  if (!connected.length) {
    return null;
  }
  const primaryId =
    typeof raw?.primarySocialAccountId === 'string' ? raw.primarySocialAccountId : null;
  if (primaryId && connected.some((account) => account.id === primaryId)) {
    return primaryId;
  }
  const firstId = connected[0]?.id;
  return typeof firstId === 'string' ? firstId : null;
}

function useSocialAccountSelection({
  brandId,
  selectedSocialAccountIds,
}: Pick<UseQueueSchedulesQueriesParams, 'brandId' | 'selectedSocialAccountIds'>) {
  const socialAccountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandId],
    queryFn: () => brandApi.getConnectedAccounts(brandId),
    enabled: Boolean(brandId),
    staleTime: CACHE_TIMES.LONG,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });
  const fallbackSocialAccountId = useMemo(
    () => getFallbackSocialAccountId(socialAccountsQuery.data),
    [socialAccountsQuery.data]
  );
  const effectiveSocialAccountId = useMemo(() => {
    if (Array.isArray(selectedSocialAccountIds) && selectedSocialAccountIds.length === 1) {
      return selectedSocialAccountIds[0];
    }
    if (Array.isArray(selectedSocialAccountIds) && selectedSocialAccountIds.length > 1) {
      return null;
    }
    return fallbackSocialAccountId;
  }, [fallbackSocialAccountId, selectedSocialAccountIds]);
  return { effectiveSocialAccountId, socialAccountsQuery };
}

function useQueueSelection({
  effectiveSocialAccountId,
  selectedQueueId,
  setSelectedQueueId,
}: {
  effectiveSocialAccountId: string | null;
  selectedQueueId: string | null;
  setSelectedQueueId: (next: string | null) => void;
}) {
  const queuesQuery = useQuery({
    queryKey: ['publishing-queues', effectiveSocialAccountId],
    queryFn: () => publishingQueuesApi.listQueuesForSocialAccount(effectiveSocialAccountId!),
    enabled: Boolean(effectiveSocialAccountId),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });
  const queueId = useMemo(
    () => selectedQueueId || getDefaultQueueId(queuesQuery.data as any),
    [queuesQuery.data, selectedQueueId]
  );
  useEffect(() => {
    if (queueId) {
      setSelectedQueueId(queueId);
    }
  }, [queueId, setSelectedQueueId]);
  useEffect(() => {
    setSelectedQueueId(null);
  }, [effectiveSocialAccountId, setSelectedQueueId]);
  return { queueId, queuesQuery };
}

function useQueueDateRange({
  date,
  brandTimezone,
}: Pick<UseQueueSchedulesQueriesParams, 'date' | 'brandTimezone'>) {
  const rangeStartUtcIso = useMemo(
    () => getBrandRangeStartUtcIso(date, brandTimezone),
    [date, brandTimezone]
  );
  const rangeEndUtcMs = useMemo(
    () => getBrandRangeEndUtcMs(date, brandTimezone, 7),
    [date, brandTimezone]
  );
  return { rangeEndUtcMs, rangeStartUtcIso };
}

function useQueueDataQueries({
  queueId,
  selectedLane,
  rangeStartUtcIso,
}: {
  queueId: string | null;
  selectedLane: SelectedLane;
  rangeStartUtcIso: string;
}) {
  const laneKey = selectedLane === 'all' ? undefined : selectedLane;
  const instancesQuery = useQuery({
    queryKey: ['publishing-queue-slot-instances', queueId, selectedLane, rangeStartUtcIso],
    queryFn: () =>
      publishingQueuesApi.listSlotInstances({
        queueId: queueId!,
        laneKey,
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
        laneKey,
        limit: 200,
        after: rangeStartUtcIso,
      }),
    enabled: Boolean(queueId),
    staleTime: 0,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });
  return { instancesQuery, itemsQuery };
}

function toInstances(instancesData: unknown, rangeEndUtcMs: number) {
  const list = (instancesData as any)?.data?.instances;
  const instances = Array.isArray(list) ? (list as PublishingQueueSlotInstance[]) : [];
  return instances
    .slice()
    .sort(
      (left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime()
    )
    .filter((instance) => new Date(instance.scheduledAt).getTime() < rangeEndUtcMs);
}

function toQueueItems(itemsData: unknown, selectedLane: SelectedLane) {
  const lanes = (itemsData as any)?.data?.lanes;
  if (!Array.isArray(lanes)) {
    return [] as PublishingQueueItem[];
  }
  if (selectedLane === 'all') {
    return lanes.flatMap((lane: any) =>
      Array.isArray(lane?.items) ? (lane.items as PublishingQueueItem[]) : []
    );
  }
  const lane = lanes.find((entry: any) => entry?.laneKey === selectedLane) || lanes[0] || null;
  return Array.isArray(lane?.items) ? (lane.items as PublishingQueueItem[]) : [];
}

function useQueueDerivedData({
  instancesData,
  itemsData,
  rangeEndUtcMs,
  selectedLane,
  calendarContent,
}: {
  instancesData: unknown;
  itemsData: unknown;
  rangeEndUtcMs: number;
  selectedLane: SelectedLane;
  calendarContent: Content[];
}) {
  const instances = useMemo(
    () => toInstances(instancesData, rangeEndUtcMs),
    [instancesData, rangeEndUtcMs]
  );
  const queueItems = useMemo(
    () => toQueueItems(itemsData, selectedLane),
    [itemsData, selectedLane]
  );
  const itemsByEstimatedMs = useMemo(() => {
    const map = new Map<number, PublishingQueueItem>();
    for (const item of queueItems) {
      if (!item.estimatedScheduledAt) {
        continue;
      }
      const ms = new Date(item.estimatedScheduledAt).getTime();
      if (Number.isFinite(ms) && !map.has(ms)) {
        map.set(ms, item);
      }
    }
    return map;
  }, [queueItems]);
  const calendarContentById = useMemo(() => {
    const map = new Map<string, Content>();
    for (const item of calendarContent) {
      if (item && typeof item.id === 'string') {
        map.set(item.id, item);
      }
    }
    return map;
  }, [calendarContent]);
  const primaryAssetIds = useMemo(() => {
    const ids: Array<string | null> = [];
    for (const item of calendarContent) {
      ids.push(item.primaryAssetId || item.mediaAssets?.[0]?.assetId || null);
    }
    for (const queueItem of queueItems) {
      ids.push(
        queueItem.content?.primaryAssetId || queueItem.content?.mediaAssets?.[0]?.assetId || null
      );
    }
    return ids;
  }, [calendarContent, queueItems]);
  const unassignedQueueItems = useMemo(
    () => queueItems.filter((item) => !item.estimatedScheduledAt),
    [queueItems]
  );
  return {
    calendarContentById,
    instances,
    itemsByEstimatedMs,
    primaryAssetIds,
    queueItems,
    unassignedQueueItems,
  };
}

function useScheduleAheadLimit() {
  const scheduleAheadLimitQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead'],
    queryFn: async () => httpGet('/api/account/limits/schedule-ahead'),
    staleTime: 60 * 1000,
  });
  const scheduleAheadLimits = (scheduleAheadLimitQuery.data as any)?.data as
    | { tier: string; maxAllowed: number; currentCount: number }
    | undefined;
  const scheduleAheadAtCapacity =
    !!scheduleAheadLimits &&
    Number.isFinite(scheduleAheadLimits.maxAllowed) &&
    scheduleAheadLimits.currentCount >= scheduleAheadLimits.maxAllowed;
  return { scheduleAheadAtCapacity, scheduleAheadLimits };
}

export function useQueueSchedulesQueries(params: UseQueueSchedulesQueriesParams) {
  const socialAccountSelection = useSocialAccountSelection({
    brandId: params.brandId,
    selectedSocialAccountIds: params.selectedSocialAccountIds,
  });
  const queueSelection = useQueueSelection({
    effectiveSocialAccountId: socialAccountSelection.effectiveSocialAccountId,
    selectedQueueId: params.selectedQueueId,
    setSelectedQueueId: params.setSelectedQueueId,
  });
  const range = useQueueDateRange({ date: params.date, brandTimezone: params.brandTimezone });
  const queries = useQueueDataQueries({
    queueId: queueSelection.queueId,
    selectedLane: params.selectedLane,
    rangeStartUtcIso: range.rangeStartUtcIso,
  });
  const derived = useQueueDerivedData({
    instancesData: queries.instancesQuery.data,
    itemsData: queries.itemsQuery.data,
    rangeEndUtcMs: range.rangeEndUtcMs,
    selectedLane: params.selectedLane,
    calendarContent: params.calendarContent,
  });
  const { data: assetsById } = useAssetsByIds(derived.primaryAssetIds);
  const scheduleAhead = useScheduleAheadLimit();

  return {
    assetsById,
    calendarContentById: derived.calendarContentById,
    effectiveSocialAccountId: socialAccountSelection.effectiveSocialAccountId,
    instances: derived.instances,
    instancesQuery: queries.instancesQuery,
    itemsByEstimatedMs: derived.itemsByEstimatedMs,
    itemsQuery: queries.itemsQuery,
    nowUtcMs: Date.now(),
    queueId: queueSelection.queueId,
    queuesQuery: queueSelection.queuesQuery,
    scheduleAheadAtCapacity: scheduleAhead.scheduleAheadAtCapacity,
    scheduleAheadLimits: scheduleAhead.scheduleAheadLimits,
    unassignedQueueItems: derived.unassignedQueueItems,
  };
}
