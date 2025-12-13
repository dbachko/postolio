import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addMonths, subMonths } from 'date-fns';
import { FullCalendar } from './calendar/FullCalendar';
import { ErrorBoundary } from './ErrorBoundary';
import { CalendarFilters } from './calendar/CalendarFilters/index';
import { CalendarExport } from './calendar/CalendarExport/index';
import { useFilteredContent } from '../hooks/useFilteredContent';
import { useCalendarFilterStore } from '../stores/calendarFilterStore';
import { useURLFilterSync } from '../hooks/useURLFilterSync';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { content as contentApi, type Content } from '@/lib/api';
import { useTimezone } from '../contexts/TimezoneContext';
import type { Placeholder } from '../types/calendar';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { COMMON_TIMEZONES, getTimezoneAbbr, getTimezoneOffset } from '@/lib/timezone';
import { formatGmtOffset } from './calendar/FullCalendar/utils/timezone';

// type guard no longer needed for the month grid only

type ViewMode = 'month' | 'week' | 'three-day' | 'schedule';

interface ContentCalendarProps {
  brandId: string;
  brandName?: string;
}

export function ContentCalendar({ brandId, brandName }: ContentCalendarProps) {
  // Sync filters with URL
  useURLFilterSync();

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const { timezone: userTz, getBrandTimezone } = useTimezone();
  const [brandTimezone, setBrandTimezone] = useState<string>(userTz);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const brandTimezoneLabel = useMemo(() => {
    const abbr = getTimezoneAbbr(brandTimezone);
    const offset = formatGmtOffset(getTimezoneOffset(brandTimezone));
    return `${abbr} · ${offset}`;
  }, [brandTimezone]);
  const timezoneOptions = useMemo(() => COMMON_TIMEZONES.filter((tz) => tz.value !== 'auto'), []);

  // Resolve brand posting timezone (fallback to user timezone)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const tz = await getBrandTimezone(brandId);
        if (mounted && tz) setBrandTimezone(tz);
      } catch {
        if (mounted) setBrandTimezone(userTz);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [brandId, getBrandTimezone, userTz]);

  // Read view + date from URL once
  useEffect(() => {
    const v = searchParams.get('view');
    if (v === 'month' || v === 'week' || v === 'three-day' || v === 'schedule') {
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
        if ((v === 'week' || v === 'three-day') && isYm) {
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

  // Prefetch adjacent months for smooth navigation (kept for export and misc)
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

  // Schedule-ahead capacity banner is now shown globally in AppLayout

  // Combine content and placeholders for unified handling
  type ContentItem = Content & { type: 'content'; scheduledAt?: string | null };
  type UnifiedItem = (ContentItem & { type: 'content' }) | (Placeholder & { type: 'placeholder' });
  const allItems: UnifiedItem[] = useMemo(() => {
    const items: UnifiedItem[] = [
      ...content.map((item) => ({
        ...item,
        type: 'content' as const,
      })),
      ...placeholders.map((p) => ({
        ...p,
        type: 'placeholder' as const,
      })),
    ];
    return items.sort((a, b) => {
      const dateA = new Date((a as any).scheduledAt || (a as any).createdAt).getTime();
      const dateB = new Date((b as any).scheduledAt || (b as any).createdAt).getTime();
      return dateA - dateB;
    });
  }, [content, placeholders]);

  // Apply filters to content
  const selectFilters = useShallow((s: ReturnType<typeof useCalendarFilterStore.getState>) => ({
    campaigns: s.campaigns,
    statuses: s.statuses,
    contentTypes: s.contentTypes,
    dateRange: s.dateRange,
    searchQuery: s.searchQuery,
  }));
  const { campaigns, statuses, contentTypes, dateRange, searchQuery } =
    useCalendarFilterStore(selectFilters);
  const clearAll = useCalendarFilterStore((s) => s.clearAll);
  const hasAnyActiveFilters = useMemo(
    () =>
      campaigns.length > 0 ||
      statuses.length > 0 ||
      contentTypes.length !== 2 ||
      !!dateRange.start ||
      !!dateRange.end ||
      !!searchQuery,
    [campaigns, statuses, contentTypes, dateRange, searchQuery]
  );
  const activeFilterCount = useMemo(() => {
    return (
      (campaigns.length > 0 ? 1 : 0) +
      (statuses.length > 0 ? 1 : 0) +
      (contentTypes.length !== 2 ? 1 : 0) +
      (dateRange.start || dateRange.end ? 1 : 0) +
      (searchQuery ? 1 : 0)
    );
  }, [
    campaigns.length,
    contentTypes.length,
    dateRange.end,
    dateRange.start,
    searchQuery,
    statuses.length,
  ]);
  const isFiltersActive = showFilters || hasAnyActiveFilters;
  const { filteredItems } = useFilteredContent(allItems as any);
  useEffect(() => {
    try {
      (window as any).__pc_filtered_items = (filteredItems || []).length;
    } catch {}
  }, [filteredItems]);

  // Navigation handlers (step depends on current view)
  const handlePrevious = () => {
    setCurrentDate((prev) => {
      let next = prev;
      if (viewMode === 'month') next = subMonths(prev, 1);
      else if (viewMode === 'week' || viewMode === 'schedule')
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
      else if (viewMode === 'week' || viewMode === 'schedule')
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

  // Add a stable fallback color for items without a campaign color
  return (
    <div className="space-y-4">
      {/* Compact Header Bar: navigation, current month, view toggles, filters toggle */}
      <div className="bg-card rounded-lg border px-3 py-2 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Left: Navigation + current month */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={handlePrevious} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleToday}>
              Today
            </Button>
            <Button variant="outline" size="icon" onClick={handleNext} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-foreground ml-2 text-sm font-medium">
              {format(currentDate, 'MMMM yyyy')}
            </span>
          </div>

          {/* Right: view dropdown + Filters + Export (wraps below on mobile) */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={brandTimezone}
              onValueChange={(tz) => {
                setBrandTimezone(tz);
              }}
            >
              <SelectTrigger className="w-full sm:w-[220px]">
                <span className="truncate text-left">
                  {brandTimezoneLabel} ({brandTimezone})
                </span>
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {timezoneOptions.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label} ({getTimezoneAbbr(tz.value)} ·{' '}
                    {formatGmtOffset(getTimezoneOffset(tz.value))})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={viewMode}
              onValueChange={(v) => {
                const next = v as ViewMode;
                setViewMode(next);
                setParam('view', next);
              }}
            >
              <SelectTrigger className="w-full sm:w-[140px]">
                <SelectValue placeholder="View" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">Month</SelectItem>
                <SelectItem value="week">Week</SelectItem>
                <SelectItem value="three-day">3 Days</SelectItem>
                <SelectItem value="schedule">Schedule</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={isFiltersActive ? 'default' : 'outline'}
              size="sm"
              aria-pressed={isFiltersActive}
              onClick={() => setShowFilters((s) => !s)}
              className="relative"
            >
              Filters
              {hasAnyActiveFilters && (
                <span
                  className={`ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium ${
                    isFiltersActive
                      ? 'bg-background text-foreground ring-ring ring-1'
                      : 'bg-foreground text-background'
                  }`}
                >
                  {activeFilterCount}
                </span>
              )}
            </Button>
            {/* Export */}
            <CalendarExport
              content={filteredItems.map((item: any) => ({
                id: item.id,
                type: item.type,
                caption: item.caption || '',
                hashtags: item.hashtags || [],
                status: item.status,
                scheduledAt: item.scheduledAt || undefined,
                postedAt: item.postedAt || undefined,
                campaignId: item.campaignId || undefined,
                permalink: item.permalink || undefined,
              }))}
              brandName={brandName || 'Brand'}
              dateRange={dateRange}
            />
            {hasAnyActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearAll()}
                aria-label="Clear all filters"
                className="text-muted-foreground hover:text-foreground"
              >
                Clear
              </Button>
            )}

            {/* New Post button removed (exists in tab navigation) */}
          </div>
        </div>
      </div>

      {/* Filters (hidden by default, compact) */}
      {showFilters && <CalendarFilters brandId={brandId} compact />}

      {/* Filter results summary removed for cleaner filtered state */}

      {/* FullCalendar (no extra wrapper card/border) */}
      <div className="p-2">
        {calendarDisabled ? (
          <div className="text-muted-foreground text-sm">Calendar disabled (safe mode)</div>
        ) : (
          <ErrorBoundary
            fallback={<div className="text-destructive text-sm">Failed to load calendar</div>}
          >
            <FullCalendar
              brandId={brandId}
              brandTimezone={brandTimezone}
              view={viewMode}
              date={currentDate}
              content={content}
              placeholders={placeholders}
              theme="monarch"
            />
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}
