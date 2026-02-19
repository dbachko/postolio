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

export function useQueueSchedulesQueries({
  brandId,
  brandTimezone,
  date,
  calendarContent,
  selectedSocialAccountIds,
  selectedLane,
  selectedQueueId,
  setSelectedQueueId,
}: UseQueueSchedulesQueriesParams) {
  const socialAccountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandId],
    queryFn: () => brandApi.getConnectedAccounts(brandId),
    enabled: Boolean(brandId),
    staleTime: CACHE_TIMES.LONG,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });

  const fallbackSocialAccountId = useMemo(() => {
    const raw = socialAccountsQuery.data as any;
    const list = Array.isArray(raw?.socialAccounts) ? (raw.socialAccounts as any[]) : [];
    const connectedAccounts = list.filter(
      (account) => account?.disconnected !== true && typeof account?.id === 'string'
    );
    if (!connectedAccounts.length) return null;

    const rawPrimary = raw?.primarySocialAccountId;
    const primaryId = typeof rawPrimary === 'string' ? rawPrimary : null;
    if (primaryId && connectedAccounts.some((account) => account.id === primaryId)) {
      return primaryId;
    }

    const firstId = connectedAccounts[0]?.id;
    return typeof firstId === 'string' ? firstId : null;
  }, [socialAccountsQuery.data]);

  const effectiveSocialAccountId = useMemo(() => {
    if (Array.isArray(selectedSocialAccountIds) && selectedSocialAccountIds.length === 1) {
      return selectedSocialAccountIds[0];
    }
    if (Array.isArray(selectedSocialAccountIds) && selectedSocialAccountIds.length > 1) {
      return null;
    }
    return fallbackSocialAccountId;
  }, [fallbackSocialAccountId, selectedSocialAccountIds]);

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
  }, [queueId, setSelectedQueueId]);

  useEffect(() => {
    setSelectedQueueId(null);
  }, [effectiveSocialAccountId, setSelectedQueueId]);

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

  const unassignedQueueItems = useMemo(
    () => queueItems.filter((i) => !i.estimatedScheduledAt),
    [queueItems]
  );

  return {
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
  };
}
