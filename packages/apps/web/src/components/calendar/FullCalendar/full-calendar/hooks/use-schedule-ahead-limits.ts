import { useQuery } from '@tanstack/react-query';
import { httpGet } from '@/lib/api';
import { GC_TIMES } from '@/lib/cache-config';
import type { ScheduleAheadLimits } from './use-calendar-event-drop';

export function useScheduleAheadLimits(brandId: string) {
  const scheduleAheadLimitQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead', brandId],
    queryFn: async () => httpGet('/api/account/limits/schedule-ahead'),
    enabled: Boolean(brandId),
    staleTime: 60 * 1000,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });
  return (scheduleAheadLimitQuery.data as { data?: ScheduleAheadLimits } | undefined)?.data;
}

export function isScheduleAheadAtCapacity(limits: ScheduleAheadLimits | undefined) {
  if (!limits) {
    return false;
  }
  if (!Number.isFinite(limits.maxAllowed)) {
    return false;
  }
  return limits.currentCount >= limits.maxAllowed;
}
