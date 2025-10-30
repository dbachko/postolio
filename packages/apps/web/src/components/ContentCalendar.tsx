import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addMonths, subMonths } from 'date-fns';
import { MonthGridView } from './MonthGridView';
import { TimelineView } from './TimelineView';
import { ContentListView } from './ContentListView';
import { CalendarFilters } from './calendar/CalendarFilters';
import { CalendarExport } from './calendar/CalendarExport';
import { CampaignColorLegend } from './CampaignColorLegend';
import { useFilteredContent } from '../hooks/useFilteredContent';
import { useCalendarFilterStore } from '../stores/calendarFilterStore';
import { useURLFilterSync } from '../hooks/useURLFilterSync';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { content as contentApi, type Content } from '@/lib/api';
import { getStoredCampaignColor } from '@/utils/campaign-color-storage';
import { getStableColorFromId } from '@/utils/campaign-colors';
import { useTimezone } from '../contexts/TimezoneContext';
import type { CalendarItem, Placeholder } from '../types/calendar';
import { Calendar, List, Clock, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

// type guard no longer needed for the month grid only

type ViewMode = 'month' | 'timeline' | 'list';

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
  // Keep timeline icon import referenced while the control is hidden
  const __keepTimelineIcon = Clock;
  void __keepTimelineIcon;

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
    if (v === 'month' || v === 'timeline' || v === 'list') {
      setViewMode(v as ViewMode);
    }
    const dateParam = searchParams.get('date');
    if (dateParam) {
      // Support yyyy-MM or full ISO
      const d = /\d{4}-\d{2}$/.test(dateParam)
        ? new Date(`${dateParam}-01T00:00:00`)
        : new Date(dateParam);
      if (!isNaN(d.getTime())) setCurrentDate(d);
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
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
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
      staleTime: 5 * 60 * 1000,
    });

    // Prefetch next month
    queryClient.prefetchQuery({
      queryKey: ['calendar', brandId, nextMonth],
      queryFn: () => contentApi.getCalendarContent(brandId, nextMonth),
      staleTime: 5 * 60 * 1000,
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
  const filters = useCalendarFilterStore();
  const { filteredItems } = useFilteredContent(allItems as any);

  // Navigation handlers
  const handlePreviousMonth = () => {
    setCurrentDate((prev) => {
      const next = subMonths(prev, 1);
      setParam('date', format(next, 'yyyy-MM'));
      return next;
    });
  };

  const handleNextMonth = () => {
    setCurrentDate((prev) => {
      const next = addMonths(prev, 1);
      setParam('date', format(next, 'yyyy-MM'));
      return next;
    });
  };

  const handleToday = () => {
    const t = new Date();
    setCurrentDate(t);
    setParam('date', format(t, 'yyyy-MM'));
  };

  // Statistics (based on filtered items)
  // Stats removed from UI; keep placeholder for potential future use

  if (calendarQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
          Loading calendar...
        </CardContent>
      </Card>
    );
  }

  // Add a stable fallback color for items without a campaign color
  const enrichWithCampaignColor = (items: any[]): any[] =>
    items.map((i) => {
      const campaignId = i.campaignId || i.campaign?.id || null;
      const direct = i.campaignColor || null;
      const stored = campaignId ? getStoredCampaignColor(campaignId) : null;
      const fallback = campaignId ? getStableColorFromId(campaignId) : null;
      return {
        ...i,
        campaignColor: direct || stored || fallback,
      };
    });

  return (
    <div className="space-y-4">
      {/* Compact Header Bar: navigation, current month, view toggles, filters toggle */}
      <div className="bg-card rounded-lg border px-3 py-2 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          {/* Left: Navigation + current month */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handlePreviousMonth}
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleToday}>
              Today
            </Button>
            <Button variant="outline" size="icon" onClick={handleNextMonth} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-foreground ml-2 text-sm font-medium">
              {format(currentDate, 'MMMM yyyy')}
            </span>
          </div>

          {/* Right: view toggles + Filters button + New Post */}
          <div className="flex items-center gap-2">
            <div className="bg-muted flex gap-1 rounded-md p-1">
              <Button
                variant={viewMode === 'month' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => {
                  setViewMode('month');
                  setParam('view', 'month');
                }}
                className="gap-1"
                data-testid="view-month"
              >
                <Calendar className="h-4 w-4" />
                <span className="hidden sm:inline">Month</span>
              </Button>
              {/* Timeline temporarily disabled
              <Button
                variant={viewMode === 'timeline' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => {
                  setViewMode('timeline');
                  setParam('view', 'timeline');
                }}
                className="gap-1"
              >
                <Clock className="h-4 w-4" />
                <span className="hidden sm:inline">Timeline</span>
              </Button>
              */}
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => {
                  setViewMode('list');
                  setParam('view', 'list');
                }}
                className="gap-1"
              >
                <List className="h-4 w-4" />
                <span className="hidden sm:inline">List</span>
              </Button>
            </div>
            {(() => {
              const hasActive = filters.hasActiveFilters();
              const count = filters.getActiveFilterCount();
              const active = showFilters || hasActive;
              return (
                <Button
                  variant={active ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={active}
                  onClick={() => setShowFilters((s) => !s)}
                  className="relative"
                >
                  Filters
                  {hasActive && (
                    <span
                      className={`ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium ${
                        active
                          ? 'bg-background text-foreground ring-ring ring-1'
                          : 'bg-foreground text-background'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </Button>
              );
            })()}
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
                instagramPermalink: item.instagramPermalink || undefined,
              }))}
              brandName={brandName || 'Brand'}
              dateRange={filters.dateRange}
            />
            {filters.hasActiveFilters() && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => filters.clearAll()}
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

      {/* Campaign Color Legend */}
      <CampaignColorLegend
        items={enrichWithCampaignColor(filteredItems as any) as any as CalendarItem[]}
        className="px-4"
      />

      {/* Filter results summary removed for cleaner filtered state */}

      {/* Statistics removed to reduce header/footer noise */}

      {/* View content based on selected mode */}
      {viewMode === 'month' && (
        <MonthGridView
          items={
            enrichWithCampaignColor(
              (filteredItems as any).map((i: any) => ({
                ...i,
                type: i.type || 'content',
              }))
            ) as any
          }
          currentDate={currentDate}
          timezone={brandTimezone}
        />
      )}

      {viewMode === 'timeline' && (
        <TimelineView
          items={
            enrichWithCampaignColor(
              (filteredItems as any).map((i: any) => ({
                id: i.id,
                type: i.type,
                caption: i.caption || '',
                scheduledAt: i.scheduledAt || undefined,
                postedAt: i.postedAt || undefined,
                status: i.status,
                hashtags: i.hashtags,
                imageUrl: i.imageUrl || undefined,
                campaignName: i.campaignName || i.campaign?.name,
                campaignId: i.campaignId || i.campaign?.id,
                processing: Boolean(i?.generationParams?.processing?.active),
              }))
            ) as any
          }
          currentDate={currentDate}
          timezone={brandTimezone}
        />
      )}

      {viewMode === 'list' && (
        <ContentListView
          items={
            enrichWithCampaignColor(
              (filteredItems as any).map((i: any) => ({
                id: i.id,
                type: i.type,
                caption: i.caption || '',
                scheduledAt: i.scheduledAt || undefined,
                postedAt: i.postedAt || undefined,
                createdAt: i.createdAt,
                status: i.status,
                hashtags: i.hashtags,
                imageUrl: i.imageUrl || undefined,
                campaignName: i.campaignName || i.campaign?.name,
                campaignId: i.campaignId || i.campaign?.id,
                processing: Boolean(i?.generationParams?.processing?.active),
              }))
            ) as any
          }
          currentDate={currentDate}
          timezone={brandTimezone}
        />
      )}
    </div>
  );
}
