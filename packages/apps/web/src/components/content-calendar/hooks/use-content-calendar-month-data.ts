import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addMonths, subMonths } from 'date-fns';
import { content as contentApi, type Content } from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import type { Placeholder } from '@/types/calendar';

type UseContentCalendarMonthDataArgs = {
  brandId: string;
  currentDate: Date;
};

function prefetchCalendarMonth(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
  monthKey: string
) {
  queryClient.prefetchQuery({
    queryKey: ['calendar', brandId, monthKey],
    queryFn: () => contentApi.getCalendarContent(brandId, monthKey),
    staleTime: CACHE_TIMES.MEDIUM,
  });
}

export function useContentCalendarMonthData({
  brandId,
  currentDate,
}: UseContentCalendarMonthDataArgs) {
  const monthKey = useMemo(() => format(currentDate, 'yyyy-MM'), [currentDate]);
  const prevMonthKey = useMemo(() => format(subMonths(currentDate, 1), 'yyyy-MM'), [currentDate]);
  const nextMonthKey = useMemo(() => format(addMonths(currentDate, 1), 'yyyy-MM'), [currentDate]);

  const calendarQuery = useQuery({
    queryKey: ['calendar', brandId, monthKey],
    queryFn: () => contentApi.getCalendarContent(brandId, monthKey),
    staleTime: CACHE_TIMES.MEDIUM,
    gcTime: GC_TIMES.STANDARD,
  });

  const prevCalendarQuery = useQuery({
    queryKey: ['calendar', brandId, prevMonthKey],
    queryFn: () => contentApi.getCalendarContent(brandId, prevMonthKey),
    enabled: Boolean(brandId),
    staleTime: CACHE_TIMES.MEDIUM,
    gcTime: GC_TIMES.STANDARD,
  });

  const nextCalendarQuery = useQuery({
    queryKey: ['calendar', brandId, nextMonthKey],
    queryFn: () => contentApi.getCalendarContent(brandId, nextMonthKey),
    enabled: Boolean(brandId),
    staleTime: CACHE_TIMES.MEDIUM,
    gcTime: GC_TIMES.STANDARD,
  });

  const queryClient = useQueryClient();
  useEffect(() => {
    prefetchCalendarMonth(queryClient, brandId, prevMonthKey);
    prefetchCalendarMonth(queryClient, brandId, nextMonthKey);
  }, [brandId, nextMonthKey, prevMonthKey, queryClient]);

  const mergedContent = useMemo(() => {
    const collected: Content[] = [];
    const sources = [prevCalendarQuery.data, calendarQuery.data, nextCalendarQuery.data];
    for (const source of sources) {
      const list = (source as any)?.data?.content;
      if (Array.isArray(list)) {
        collected.push(...(list as Content[]));
      }
    }
    const seen = new Set<string>();
    return collected.filter((item) => {
      if (!item || typeof item.id !== 'string') {
        return false;
      }
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    });
  }, [calendarQuery.data, nextCalendarQuery.data, prevCalendarQuery.data]);

  const placeholders: Placeholder[] = useMemo(() => {
    const collected: Placeholder[] = [];
    const sources = [prevCalendarQuery.data, calendarQuery.data, nextCalendarQuery.data];
    for (const source of sources) {
      const list = (source as any)?.data?.placeholders;
      if (Array.isArray(list)) {
        collected.push(...(list as Placeholder[]));
      }
    }
    const seen = new Set<string>();
    return collected.filter((p) => {
      if (!p || typeof p.id !== 'string') {
        return false;
      }
      if (seen.has(p.id)) {
        return false;
      }
      seen.add(p.id);
      return true;
    });
  }, [calendarQuery.data, nextCalendarQuery.data, prevCalendarQuery.data]);

  return { mergedContent, placeholders };
}
