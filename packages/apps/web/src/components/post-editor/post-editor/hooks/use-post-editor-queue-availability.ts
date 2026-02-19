import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';

import { publishingQueues as publishingQueuesApi } from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';

type QueueAvailabilityMap = Record<string, boolean | null>;
type QueueLoadingMap = Record<string, boolean>;
type QueueErrorMap = Record<string, boolean>;

export function usePostEditorQueueAvailability(params: { socialAccountIds: string[] }) {
  const { socialAccountIds } = params;

  const uniqueSocialAccountIds = useMemo(
    () =>
      Array.from(
        new Set(
          (socialAccountIds || [])
            .map((id) => (typeof id === 'string' ? id.trim() : ''))
            .filter(Boolean)
        )
      ),
    [socialAccountIds]
  );

  const queueQueries = useQueries({
    queries: uniqueSocialAccountIds.map((socialAccountId) => ({
      queryKey: ['publishing-queues', socialAccountId],
      queryFn: () => publishingQueuesApi.listQueuesForSocialAccount(socialAccountId),
      enabled: Boolean(socialAccountId),
      staleTime: CACHE_TIMES.STANDARD,
      gcTime: GC_TIMES.STANDARD,
      refetchOnWindowFocus: false,
    })),
  });

  const hasQueueSlotsBySocialAccountId = useMemo((): QueueAvailabilityMap => {
    const out: QueueAvailabilityMap = {};

    uniqueSocialAccountIds.forEach((socialAccountId, index) => {
      const query = queueQueries[index] as any;
      const payload = query?.data as any;
      const queues = Array.isArray(payload?.data?.queues) ? payload.data.queues : null;

      if (!queues) {
        out[socialAccountId] = null;
        return;
      }

      const defaultQueue = queues.find((queue: any) => queue?.isDefault) || queues[0] || null;
      if (!defaultQueue) {
        out[socialAccountId] = false;
        return;
      }

      const slotCount =
        typeof defaultQueue?.slotCount === 'number' && Number.isFinite(defaultQueue.slotCount)
          ? defaultQueue.slotCount
          : 0;

      out[socialAccountId] = slotCount > 0;
    });

    return out;
  }, [queueQueries, uniqueSocialAccountIds]);

  const queueSlotsLoadingBySocialAccountId = useMemo((): QueueLoadingMap => {
    const out: QueueLoadingMap = {};
    uniqueSocialAccountIds.forEach((socialAccountId, index) => {
      const query = queueQueries[index] as any;
      out[socialAccountId] = Boolean(query?.isPending || query?.isLoading || query?.isFetching);
    });
    return out;
  }, [queueQueries, uniqueSocialAccountIds]);

  const queueSlotsErrorBySocialAccountId = useMemo((): QueueErrorMap => {
    const out: QueueErrorMap = {};
    uniqueSocialAccountIds.forEach((socialAccountId, index) => {
      const query = queueQueries[index] as any;
      out[socialAccountId] = Boolean(query?.isError);
    });
    return out;
  }, [queueQueries, uniqueSocialAccountIds]);

  return {
    uniqueSocialAccountIds,
    hasQueueSlotsBySocialAccountId,
    queueSlotsLoadingBySocialAccountId,
    queueSlotsErrorBySocialAccountId,
  };
}
