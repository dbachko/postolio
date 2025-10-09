import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addMonths, subMonths } from 'date-fns';
import { CalendarView } from './CalendarView';
import { TimelineView } from './TimelineView';
import { ContentListView } from './ContentListView';
import { CalendarFilters } from './calendar/CalendarFilters';
import { CalendarExport } from './calendar/CalendarExport';
import { useFilteredContent } from '../hooks/useFilteredContent';
import { useCalendarFilterStore } from '../stores/calendarFilterStore';
import { useURLFilterSync } from '../hooks/useURLFilterSync';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { apiClient, type Content } from '@/lib/api';
import type { CalendarItem, Placeholder } from '../types/calendar';
import { Calendar, List, Clock, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

const isContent = (item: CalendarItem): item is Content & { type: 'content' } =>
  item.type === 'content';

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

  // Fetch calendar data with placeholders - with prefetching
  const calendarQuery = useQuery({
    queryKey: ['calendar', brandId, format(currentDate, 'yyyy-MM')],
    queryFn: () => apiClient.getCalendarContent(brandId, format(currentDate, 'yyyy-MM')),
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
      queryFn: () => apiClient.getCalendarContent(brandId, prevMonth),
      staleTime: 5 * 60 * 1000,
    });

    // Prefetch next month
    queryClient.prefetchQuery({
      queryKey: ['calendar', brandId, nextMonth],
      queryFn: () => apiClient.getCalendarContent(brandId, nextMonth),
      staleTime: 5 * 60 * 1000,
    });
  }, [currentDate, brandId, queryClient]);

  const content = (calendarQuery.data?.data?.content || []) as Content[];
  const placeholders = (calendarQuery.data?.data?.placeholders || []) as Placeholder[];

  // Fetch campaigns for progress visualization
  const campaignsQuery = useQuery({
    queryKey: ['campaigns', brandId],
    queryFn: () => apiClient.listCampaigns(brandId),
    staleTime: 5 * 60 * 1000,
  });

  const campaigns = campaignsQuery.data?.campaigns || [];

  // Calculate campaign progress
  const campaignProgress = useMemo(() => {
    return campaigns.map((campaign) => {
      const campaignContent = content.filter((c) => c.campaignId === campaign.id);
      const campaignPlaceholders = placeholders.filter((p) => p.campaignId === campaign.id);
      const total = campaignContent.length + campaignPlaceholders.length;
      const published = campaignContent.filter((c) => c.status === 'published').length;
      const scheduled = campaignContent.filter((c) => c.status === 'scheduled').length;

      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        total,
        published,
        scheduled,
        pending: campaignPlaceholders.length,
        progress: total > 0 ? Math.round((published / total) * 100) : 0,
      };
    });
  }, [campaigns, content, placeholders]);

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
  const { filteredItems, totalItems, filteredCount, isFiltered } = useFilteredContent(
    allItems as any
  );

  // Navigation handlers
  const handlePreviousMonth = () => {
    setCurrentDate((prev) => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate((prev) => addMonths(prev, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Statistics (based on filtered items)
  const stats = useMemo(() => {
    const filteredContent = filteredItems.filter((item: any) => item.type === 'content');
    const filteredPlaceholders = filteredItems.filter((item: any) => item.type === 'placeholder');

    return {
      total: filteredItems.length,
      published: filteredContent.filter((c) => c.status === 'published').length,
      scheduled: filteredContent.filter((c) => c.status === 'scheduled').length,
      placeholders: filteredPlaceholders.length,
      failed: filteredContent.filter((c) => c.status === 'failed').length,
    };
  }, [filteredItems]);

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

  return (
    <div className="space-y-4">
      {/* Header with navigation and view switcher */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4">
            {/* Title and Navigation Row */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>Content Calendar</CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={handlePreviousMonth}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={handleToday}>
                  Today
                </Button>
                <Button variant="outline" size="icon" onClick={handleNextMonth}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <span className="ml-2 font-medium">{format(currentDate, 'MMMM yyyy')}</span>
              </div>
            </div>

            {/* View Controls Row */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
                <Button
                  variant={viewMode === 'month' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('month')}
                  className="gap-2"
                  data-testid="view-month"
                >
                  <Calendar className="h-4 w-4" />
                  Month
                </Button>
                <Button
                  variant={viewMode === 'timeline' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('timeline')}
                  className="gap-2"
                >
                  <Clock className="h-4 w-4" />
                  Timeline
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="gap-2"
                >
                  <List className="h-4 w-4" />
                  List
                </Button>
              </div>

              <CalendarExport
                content={filteredItems.map((item) => ({
                  ...item,
                  scheduledAt: item.scheduledAt || undefined,
                  postedAt: item.postedAt || undefined,
                  campaignId: item.campaignId || undefined,
                  instagramPermalink: item.instagramPermalink || undefined,
                }))}
                brandName={brandName || 'Brand'}
                dateRange={filters.dateRange}
              />
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Filters */}
      <CalendarFilters brandId={brandId} />

      {/* Filter Results Summary */}
      {isFiltered && (
        <Card>
          <CardContent className="px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">
                Showing <span className="font-medium text-gray-900">{filteredCount}</span> of{' '}
                {totalItems} items
              </span>
              {filteredCount === 0 && (
                <Button variant="ghost" size="sm" onClick={() => filters.clearAll()}>
                  Clear filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Campaign Progress */}
      {campaignProgress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Campaign Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {campaignProgress.map((campaign) => (
                <div key={campaign.id} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{campaign.name}</span>
                    <span className="text-gray-500">{campaign.progress}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gray-200">
                    <div
                      className="h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${campaign.progress}%`,
                        backgroundColor:
                          campaign.status === 'active'
                            ? '#22c55e'
                            : campaign.status === 'paused'
                              ? '#6b7280'
                              : '#3b82f6',
                      }}
                    />
                  </div>
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>{campaign.published} published</span>
                    <span>{campaign.scheduled} scheduled</span>
                    <span>{campaign.pending} pending</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Statistics bar */}
      <div className="grid grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-sm text-gray-600">Total Posts</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-green-600">{stats.published}</div>
            <div className="text-sm text-gray-600">Published</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-blue-600">{stats.scheduled}</div>
            <div className="text-sm text-gray-600">Scheduled</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-gray-500">{stats.placeholders}</div>
            <div className="text-sm text-gray-600">Future AI</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
            <div className="text-sm text-gray-600">Failed</div>
          </CardContent>
        </Card>
      </div>

      {/* View content based on selected mode */}
      {viewMode === 'month' && (
        <CalendarView
          brandId={brandId}
          content={(filteredItems as any).filter(isContent).map((c: any) => ({
            ...c,
            scheduledAt: c.scheduledAt || undefined,
            postedAt: c.postedAt || undefined,
          }))}
        />
      )}

      {viewMode === 'timeline' && (
        <TimelineView
          items={(filteredItems as any).map((i: any) => ({
            id: i.id,
            type: i.type,
            caption: i.caption || '',
            scheduledAt: i.scheduledAt || undefined,
            postedAt: i.postedAt || undefined,
            status: i.status,
            hashtags: i.hashtags,
            imageUrl: i.imageUrl || undefined,
            campaignName: i.campaignName || i.campaign?.name,
            processing: Boolean(i?.generationParams?.processing?.active),
          }))}
          currentDate={currentDate}
        />
      )}

      {viewMode === 'list' && (
        <ContentListView
          items={(filteredItems as any).map((i: any) => ({
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
          }))}
          currentDate={currentDate}
        />
      )}
    </div>
  );
}
