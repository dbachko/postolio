import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addMonths, subMonths } from 'date-fns';
import { FullCalendar } from './calendar/FullCalendar';
import { ErrorBoundary } from './ErrorBoundary';
import { ContentFiltersBar } from './calendar/CalendarFilters/ContentFiltersBar';
import { QueueSchedulesView } from './calendar/QueueSchedules/QueueSchedulesView';
import { useURLFilterSync } from '../hooks/useURLFilterSync';
import { Button } from '@/components/ui/button';
import { content as contentApi, type Content } from '@/lib/api';
import { useTimezone } from '../contexts/TimezoneContext';
import type { Placeholder } from '../types/calendar';
import { CalendarDays, ChevronLeft, ChevronRight, Globe2 } from 'lucide-react';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { AsyncTimezoneCombobox } from '@/components/timezone/AsyncTimezoneCombobox';
import { ContentViewSelector } from '@/components/content/ContentViewSelector';
import { useContentViewStore } from '@/stores/contentViewStore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// type guard no longer needed for the month grid only

type ViewMode = 'month' | 'week' | 'three-day' | 'queue';

interface ContentCalendarProps {
  brandId: string;
  brandName?: string;
}

export function ContentCalendar({ brandId }: ContentCalendarProps) {
  // Sync filters with URL
  useURLFilterSync();

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const { timezone: userTz, getBrandTimezone } = useTimezone();
  const [brandTimezone, setBrandTimezone] = useState<string>(userTz);
  const [searchParams, setSearchParams] = useSearchParams();

  // Resolve brand posting timezone (fallback to user timezone)
  useEffect(() => {
    let mounted = true;
    const resolveBrandTimezone = async () => {
      try {
        const tz = await getBrandTimezone(brandId);
        if (mounted && tz) setBrandTimezone(tz);
      } catch {
        if (mounted) setBrandTimezone(userTz);
      }
    };
    void resolveBrandTimezone();
    return () => {
      mounted = false;
    };
  }, [brandId, getBrandTimezone, userTz]);

  // Read view + date from URL once
  useEffect(() => {
    const v = searchParams.get('view');
    if (v === 'month' || v === 'week' || v === 'three-day' || v === 'queue') {
      setViewMode(v as ViewMode);
    } else {
      // Default to a mobile-friendly 3-day view on small screens
      if (typeof window !== 'undefined' && window.innerWidth < 640) {
        setViewMode('three-day');
      }
    }
    const dateParam = searchParams.get('date');
    if (dateParam) {
      const isYm = /\d{4}-\d{2}$/.test(dateParam);
      const d = isYm ? new Date(`${dateParam}-01T00:00:00`) : new Date(dateParam);
      if (!isNaN(d.getTime())) {
        // For week/3-day views, if the URL only carries year-month, prefer today's date
        if ((v === 'week' || v === 'three-day' || v === 'queue') && isYm) {
          setCurrentDate(new Date());
        } else {
          setCurrentDate(d);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper to merge URL params
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value == null || value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  // Fetch calendar data with placeholders - with prefetching
  const calendarQuery = useQuery({
    queryKey: ['calendar', brandId, format(currentDate, 'yyyy-MM')],
    queryFn: () => contentApi.getCalendarContent(brandId, format(currentDate, 'yyyy-MM')),
    staleTime: CACHE_TIMES.MEDIUM,
    gcTime: GC_TIMES.STANDARD,
  });

  // Prefetch adjacent months for smooth navigation
  const queryClient = useQueryClient();

  useEffect(() => {
    const prevMonth = format(subMonths(currentDate, 1), 'yyyy-MM');
    const nextMonth = format(addMonths(currentDate, 1), 'yyyy-MM');

    // Prefetch previous month
    queryClient.prefetchQuery({
      queryKey: ['calendar', brandId, prevMonth],
      queryFn: () => contentApi.getCalendarContent(brandId, prevMonth),
      staleTime: CACHE_TIMES.MEDIUM,
    });

    // Prefetch next month
    queryClient.prefetchQuery({
      queryKey: ['calendar', brandId, nextMonth],
      queryFn: () => contentApi.getCalendarContent(brandId, nextMonth),
      staleTime: CACHE_TIMES.MEDIUM,
    });
  }, [currentDate, brandId, queryClient]);

  const content = useMemo(() => {
    const raw = (calendarQuery.data?.data?.content || []) as Content[];
    const seen = new Set<string>();
    return raw.filter((item) => {
      if (!item || typeof item.id !== 'string') return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [calendarQuery.data?.data?.content]);
  const placeholders: Placeholder[] = useMemo(
    () => (calendarQuery.data?.data?.placeholders || []) as Placeholder[],
    [calendarQuery.data?.data?.placeholders]
  );

  const selectedSocialAccountIds = useContentViewStore(
    (s) => s.selectedSocialAccountIdsByBrandId[brandId]
  );
  const scopedContent = useMemo(() => {
    if (!Array.isArray(selectedSocialAccountIds) || selectedSocialAccountIds.length === 0)
      return content;
    const allowed = new Set(selectedSocialAccountIds);
    return content.filter(
      (item) => item.targetSocialAccountId && allowed.has(item.targetSocialAccountId)
    );
  }, [content, selectedSocialAccountIds]);

  // Schedule-ahead capacity banner is now shown globally in AppLayout

  // Navigation handlers (step depends on current view)
  const handlePrevious = () => {
    setCurrentDate((prev) => {
      let next = prev;
      if (viewMode === 'month') next = subMonths(prev, 1);
      else if (viewMode === 'week' || viewMode === 'queue')
        next = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 7);
      else if (viewMode === 'three-day')
        next = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 3);
      setParam('date', format(next, viewMode === 'month' ? 'yyyy-MM' : 'yyyy-MM-dd'));
      return next;
    });
  };

  const handleNext = () => {
    setCurrentDate((prev) => {
      let next = prev;
      if (viewMode === 'month') next = addMonths(prev, 1);
      else if (viewMode === 'week' || viewMode === 'queue')
        next = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7);
      else if (viewMode === 'three-day')
        next = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 3);
      setParam('date', format(next, viewMode === 'month' ? 'yyyy-MM' : 'yyyy-MM-dd'));
      return next;
    });
  };

  const handleToday = () => {
    const t = new Date();
    setCurrentDate(t);
    setParam('date', format(t, viewMode === 'month' ? 'yyyy-MM' : 'yyyy-MM-dd'));
  };

  const calendarDisabled = useMemo(() => {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    return params.get('calendar') === 'off' || params.get('disableCalendar') === '1';
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handlePrevious}
            aria-label="Previous"
            className="h-10 w-10"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleToday}
            aria-label="Today"
            className="h-10 w-10"
          >
            <CalendarDays className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleNext}
            aria-label="Next"
            className="h-10 w-10"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-foreground ml-2 min-w-0 truncate text-sm font-semibold">
            {format(currentDate, 'MMMM yyyy')}
          </span>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
          <ContentViewSelector brandId={brandId} />
          <AsyncTimezoneCombobox
            value={brandTimezone}
            onValueChange={(tz) => {
              setBrandTimezone(tz);
            }}
            leadingIcon={<Globe2 className="text-muted-foreground h-4 w-4" aria-hidden="true" />}
            buttonClassName="w-auto"
          />
          <Select
            value={viewMode}
            onValueChange={(v) => {
              const next = v as ViewMode;
              setViewMode(next);
              setParam('view', next);
            }}
          >
            <SelectTrigger className="w-auto justify-start gap-2">
              <SelectValue placeholder="View" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="three-day">3 Days</SelectItem>
              <SelectItem value="queue">Queues</SelectItem>
            </SelectContent>
          </Select>
          <ContentFiltersBar brandId={brandId} />
        </div>
      </div>

      {/* Filter results summary removed for cleaner filtered state */}

      {/* FullCalendar (no extra wrapper card/border) */}
      {calendarDisabled ? (
        <div className="text-muted-foreground text-sm">Calendar disabled (safe mode)</div>
      ) : viewMode === 'queue' ? (
        <QueueSchedulesView
          brandId={brandId}
          brandTimezone={brandTimezone}
          date={currentDate}
          calendarContent={scopedContent}
          selectedSocialAccountIds={
            Array.isArray(selectedSocialAccountIds) ? selectedSocialAccountIds : null
          }
        />
      ) : (
        <ErrorBoundary
          fallback={<div className="text-destructive text-sm">Failed to load calendar</div>}
        >
          <FullCalendar
            brandId={brandId}
            brandTimezone={brandTimezone}
            view={viewMode}
            date={currentDate}
            content={scopedContent}
            placeholders={placeholders}
            theme="monarch"
            targetSocialAccountIds={
              Array.isArray(selectedSocialAccountIds) ? selectedSocialAccountIds : null
            }
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
