import { useState, useMemo, useCallback, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, dateFnsLocalizer, type View, type Event } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import { format, parse, startOfWeek, getDay, addDays, subDays, isToday } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { content as contentApi, type Content } from '../lib/api';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  CheckCircle,
  XCircle,
  Globe,
  Loader2,
} from 'lucide-react';
import { useTimezone } from '../contexts/TimezoneContext';
import {
  formatInUserTimezone,
  convertUTCToLocal,
  convertLocalToUTC,
  getTimezoneAbbr,
} from '../lib/timezone';
import { toast } from 'sonner';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import './CalendarView.css';
import { Button } from '@/components/ui/button';

const locales = {
  'en-US': enUS,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

// Create the DnD Calendar component
const DnDCalendar = withDragAndDrop(Calendar);
// Wrap with a broad ComponentType to avoid incomplete HOC typings blocking base Calendar props
const DnDCalendarAny = DnDCalendar as unknown as ComponentType<Record<string, unknown>>;

interface PlaceholderContent {
  id: string;
  caption: string;
  hashtags: string[];
  imageUrl: string;
  brandId: string;
  status: 'placeholder';
  postedAt: null;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string;
  campaignId: string;
  campaignName: string;
  type: 'placeholder';
  isPlaceholder: boolean;
  message: string;
}

interface CalendarEvent extends Event {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: Content | PlaceholderContent;
}

interface CalendarViewProps {
  brandId?: string;
  content?: Content[];
  onContentClick?: (content: Content) => void;
  timezone?: string; // brand posting timezone override
}

export function CalendarView({
  brandId,
  content: propContent,
  onContentClick,
  timezone: tzOverride,
}: CalendarViewProps) {
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<View>('week');
  const { timezone: ctxTimezone, isAutoDetected } = useTimezone();
  const timezone = tzOverride || ctxTimezone;
  const queryClient = useQueryClient();

  // Fetch calendar content with placeholders if brandId is provided
  const calendarQuery = useQuery({
    queryKey: ['calendar', brandId, format(currentDate, 'yyyy-MM')],
    queryFn: () => contentApi.getCalendarContent(brandId!, format(currentDate, 'yyyy-MM')),
    enabled: !!brandId && !propContent,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });

  // Use provided content or fetched content, then defensively de-duplicate by id
  const content = useMemo(
    () => propContent ?? calendarQuery.data?.data?.content ?? [],
    [propContent, calendarQuery.data?.data?.content]
  );
  const contentDeduped = useMemo(() => {
    const seen = new Set<string>();
    const arr = Array.isArray(content) ? (content as Content[]) : [];
    return arr.filter((item) => {
      if (!item || typeof item.id !== 'string') return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [content]);
  const placeholders = useMemo(
    () => calendarQuery.data?.data?.placeholders ?? [],
    [calendarQuery.data?.data?.placeholders]
  );

  // Type guards
  const isPlaceholderContent = (r: unknown): r is PlaceholderContent => {
    if (!r || typeof r !== 'object') return false;
    const obj = r as Record<string, unknown>;
    return obj.type === 'placeholder' && obj.isPlaceholder === true && typeof obj.id === 'string';
  };

  const isContent = (r: unknown): r is Content => {
    if (!r || typeof r !== 'object') return false;
    const obj = r as Record<string, unknown>;
    return typeof obj.id === 'string' && typeof obj.status === 'string';
  };

  const isCalendarEvent = useCallback((e: unknown): e is CalendarEvent => {
    if (!e || typeof e !== 'object') return false;
    const obj = e as Record<string, unknown>;
    return (
      obj.start instanceof Date &&
      obj.end instanceof Date &&
      typeof obj.id === 'string' &&
      (isContent(obj.resource) || isPlaceholderContent(obj.resource))
    );
  }, []);

  // Reschedule mutation with optimistic updates
  type CalendarAPIData = { data?: { content?: Content[] } } | undefined;

  const rescheduleMutation = useMutation({
    mutationFn: ({ contentId, scheduledAt }: { contentId: string; scheduledAt: string }) =>
      contentApi.updateContent({ contentId, scheduledAt }),
    onMutate: async ({ contentId, scheduledAt }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: ['calendar', brandId, format(currentDate, 'yyyy-MM')],
      });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData([
        'calendar',
        brandId,
        format(currentDate, 'yyyy-MM'),
      ]);

      // Optimistically update the cache
      queryClient.setQueryData(
        ['calendar', brandId, format(currentDate, 'yyyy-MM')],
        (old: CalendarAPIData) => {
          if (!old?.data?.content) return old;
          const next: NonNullable<CalendarAPIData> = {
            ...old,
            data: {
              ...old.data,
              content: old.data.content.map((item: Content) =>
                item.id === contentId ? { ...item, scheduledAt } : item
              ),
            },
          };
          return next;
        }
      );

      // Return a context with the previous data
      return { previousData };
    },
    onError: (error, _variables, context) => {
      console.error('Reschedule failed:', error);
      // If the mutation fails, use the context to roll back
      if (context?.previousData) {
        queryClient.setQueryData(
          ['calendar', brandId, format(currentDate, 'yyyy-MM')],
          context.previousData
        );
      }
      toast.error(
        `Failed to reschedule post: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    },
    onSuccess: () => {
      toast.success('Post rescheduled successfully');
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
      if (brandId) {
        calendarQuery.refetch();
      }
    },
  });

  // Convert content and placeholders to calendar events
  const events: CalendarEvent[] = useMemo(() => {
    const contentEvents = (contentDeduped as Content[])
      .filter((item) => item.scheduledAt || item.postedAt)
      .map((item: Content) => {
        // Prefer actual posted time for published items; otherwise use scheduled time
        const utcDate =
          (item.status === 'published' && item.postedAt) || item.scheduledAt || item.postedAt!;
        const localDate = convertUTCToLocal(utcDate, timezone);
        return {
          id: item.id,
          title: item.caption.length > 50 ? `${item.caption.substring(0, 50)}...` : item.caption,
          start: localDate,
          end: new Date(localDate.getTime() + 60 * 60 * 1000), // 1 hour duration
          resource: item,
        };
      });

    // Add placeholder events
    const placeholderEvents = placeholders.map((placeholder: any) => {
      const localDate = convertUTCToLocal(placeholder.scheduledAt, timezone);
      return {
        id: placeholder.id,
        title: '⏳ Future Post',
        start: localDate,
        end: new Date(localDate.getTime() + 60 * 60 * 1000),
        resource: {
          id: placeholder.id,
          caption: placeholder.message,
          hashtags: [],
          imageUrl: '',
          brandId: placeholder.campaignId,
          status: 'placeholder' as const,
          postedAt: null,
          createdAt: placeholder.scheduledAt,
          updatedAt: placeholder.scheduledAt,
          scheduledAt: placeholder.scheduledAt,
          campaignId: placeholder.campaignId,
          campaignName: placeholder.campaignName,
          type: 'placeholder' as const,
          isPlaceholder: true,
          message: placeholder.message,
        },
      };
    });

    return [...contentEvents, ...placeholderEvents];
  }, [contentDeduped, placeholders, timezone]);

  // Handle event drop (rescheduling)
  const handleEventDrop = useCallback(
    (args: { event: unknown; start: Date | string; end: Date | string }) => {
      const { event, start } = args;
      if (!isCalendarEvent(event)) return;
      const draggedContent = event.resource;

      // Don't allow dragging of published posts or placeholders
      if (
        draggedContent.status === 'published' ||
        ('isPlaceholder' in draggedContent && draggedContent.isPlaceholder)
      ) {
        toast.error('Cannot reschedule this post');
        return;
      }

      // The 'start' parameter from react-big-calendar is already in local timezone
      // and represents the exact date/time where the event was dropped
      const newLocalDate = typeof start === 'string' ? new Date(start) : start;

      // Convert the local date/time to UTC for storage
      const utcDate = convertLocalToUTC(newLocalDate, timezone);
      const scheduledAt = utcDate.toISOString();

      // Perform the mutation
      rescheduleMutation.mutate({
        contentId: draggedContent.id,
        scheduledAt,
      });
    },
    [rescheduleMutation, timezone, isCalendarEvent]
  );

  // Navigation handlers with memoization
  const handlePrevious = useCallback(() => {
    if (view === 'week') {
      setCurrentDate((prev) => subDays(prev, 7));
    } else {
      setCurrentDate((prev) => subDays(prev, 1));
    }
  }, [view]);

  const handleNext = useCallback(() => {
    if (view === 'week') {
      setCurrentDate((prev) => addDays(prev, 7));
    } else {
      setCurrentDate((prev) => addDays(prev, 1));
    }
  }, [view]);

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  // Custom event component
  const EventComponent = ({ event }: { event: Event }) => {
    if (!isCalendarEvent(event)) return null;
    const calendarEvent = event;
    const content = calendarEvent.resource;
    const isPlaceholder = 'isPlaceholder' in content && content.isPlaceholder;
    const isProcessing = Boolean((content as any)?.generationParams?.processing?.active);
    const isDraggable = !isPlaceholder && (content as any)?.status !== 'published';

    // Get campaign color from content or placeholder
    const campaignColor = (content as any)?.campaignColor || null;

    // Neutral status styling — no color-coding
    const statusColors = {
      draft: 'bg-muted border-border text-foreground',
      scheduled: 'bg-muted border-border text-foreground',
      published: 'bg-muted border-border text-foreground',
      failed: 'bg-muted border-border text-foreground',
      skipped: 'bg-muted border-border text-foreground',
      placeholder: 'bg-muted border-border text-muted-foreground',
    } as const;

    const statusIcons = {
      draft: null,
      scheduled: Play,
      published: CheckCircle,
      failed: XCircle,
      skipped: null,
      placeholder: null, // No icon for placeholders
    };

    const StatusIcon = isProcessing
      ? Loader2
      : statusIcons[content.status as keyof typeof statusIcons];

    // Campaign color styles
    const getCampaignStyles = () => {
      if (!campaignColor) return {};
      const isHex = /^#([0-9A-F]{6})$/i.test(campaignColor);
      return {
        borderLeftColor: campaignColor,
        borderLeftWidth: '3px',
        borderLeftStyle: 'solid' as const,
        ...(isHex
          ? (() => {
              const r = parseInt(campaignColor.slice(1, 3), 16);
              const g = parseInt(campaignColor.slice(3, 5), 16);
              const b = parseInt(campaignColor.slice(5, 7), 16);
              return { backgroundColor: `rgba(${r}, ${g}, ${b}, 0.1)` };
            })()
          : {}),
      } as React.CSSProperties;
    };

    return (
      <div
        className={`rounded p-1 ${isPlaceholder ? 'border border-dashed' : 'border-l-2'} ${!campaignColor ? (isProcessing ? statusColors.scheduled : statusColors[content.status as keyof typeof statusColors] || statusColors.draft) : ''} ${isDraggable ? 'cursor-move' : isPlaceholder ? '' : 'cursor-pointer'} transition-opacity hover:opacity-80`}
        style={campaignColor ? getCampaignStyles() : {}}
        onClick={() => {
          if (!isPlaceholder && 'id' in content) {
            onContentClick?.(content as Content);
          }
        }}
        title={isProcessing ? 'Scheduling...' : isDraggable ? 'Drag to reschedule' : ''}
      >
        <div className="flex items-center gap-1 text-xs">
          {StatusIcon && (
            <StatusIcon className={`h-3 w-3 flex-shrink-0 ${isProcessing ? 'animate-spin' : ''}`} />
          )}
          <span className="truncate">{isProcessing ? 'Scheduling…' : calendarEvent.title}</span>
        </div>
        {isPlaceholder && <div className="mt-0.5 text-[10px] opacity-60">Will generate</div>}
      </div>
    );
  };

  // Memoize timezone abbreviation to avoid recalculation
  const tzAbbr = useMemo(() => getTimezoneAbbr(timezone), [timezone]);

  // Custom toolbar component
  const CustomToolbar = () => {
    const nextRunTime = new Date();
    nextRunTime.setDate(nextRunTime.getDate() + 1);
    nextRunTime.setHours(2, 0, 0, 0);

    return (
      <div className="mb-6 space-y-4">
        {/* Timezone Display */}
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Globe className="h-4 w-4" />
            <span>
              Showing times in {tzAbbr}
              {isAutoDetected && ' (auto-detected)'}
            </span>
          </div>
        </div>

        {/* Autopilot Status */}
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-muted h-3 w-3 animate-pulse rounded-full"></div>
              <div>
                <h3 className="font-medium">Autopilot Active</h3>
                <p className="text-muted-foreground text-sm">
                  Next run:{' '}
                  {formatInUserTimezone(nextRunTime, "EEEE, MMMM d 'at' h:mm a", timezone)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium">
                {contentDeduped.filter((c: any) => c.status === 'scheduled').length} posts scheduled
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold">
              {view === 'week' ? 'Weekly Schedule' : 'Daily Schedule'}
            </h2>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={handlePrevious}
                title="Previous"
                className="h-8 w-8 p-2"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={handleToday} className="h-8 px-3 py-1">
                Today
              </Button>
              <Button variant="ghost" onClick={handleNext} title="Next" className="h-8 w-8 p-2">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">{format(currentDate, 'MMMM yyyy')}</div>
            <div className="bg-muted flex rounded-lg p-1">
              <Button
                variant={view === 'day' ? 'default' : 'ghost'}
                onClick={() => setView('day')}
                className="h-8 px-3 py-1"
              >
                Day
              </Button>
              <Button
                variant={view === 'week' ? 'default' : 'ghost'}
                onClick={() => setView('week')}
                className="h-8 px-3 py-1"
              >
                Week
              </Button>
            </div>
          </div>
        </div>

        {/* Status Legend */}
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="bg-muted h-3 w-3 rounded-sm"></div>
            <span className="text-muted-foreground">
              Scheduled ({contentDeduped.filter((c: any) => c.status === 'scheduled').length})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-muted h-3 w-3 rounded-sm"></div>
            <span className="text-muted-foreground">
              Published ({contentDeduped.filter((c: any) => c.status === 'published').length})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-muted h-3 w-3 rounded-sm border border-dashed"></div>
            <span className="text-muted-foreground">Future AI ({placeholders.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-muted h-3 w-3 rounded-sm"></div>
            <span className="text-muted-foreground">
              Failed ({content.filter((c: any) => c.status === 'failed').length})
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Check if event is draggable
  const canDragEvent = useCallback((_ev: unknown) => false, []);

  // Handle event click to navigate to post detail
  const handleSelectEvent = useCallback(
    (event: unknown) => {
      if (!isCalendarEvent(event)) return;
      const resource = event.resource as any;
      // If placeholder, take user to create post with prefilled campaign/time
      if ('isPlaceholder' in resource && resource.isPlaceholder) {
        const campaignId = resource.campaignId;
        const scheduledAt = resource.scheduledAt;
        const params = new URLSearchParams();
        if (campaignId) params.set('campaignId', campaignId);
        if (scheduledAt) params.set('scheduledAt', scheduledAt);
        navigate(`/posts/create?${params.toString()}`);
        return;
      }
      // Navigate to post detail page
      navigate(`/posts/${resource.id}`);
    },
    [navigate, isCalendarEvent]
  );

  return (
    <div className="rounded-lg border p-6 shadow-sm">
      <CustomToolbar />

      <div
        className="calendar-container"
        style={{
          height: '75vh',
          minHeight: view === 'week' ? '900px' : '600px',
        }}
      >
        <DnDCalendarAny
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          date={currentDate}
          onNavigate={setCurrentDate}
          view={view}
          onView={setView}
          views={['day', 'week']}
          toolbar={false} // We use our custom toolbar
          allDaySlot={false}
          components={{
            event: EventComponent,
          }}
          eventPropGetter={
            (/* event: Event, _start, _end, _isSelected */) => ({
              className: 'calendar-event',
              style: {
                border: 'none',
                borderRadius: '4px',
                padding: '2px',
              },
            })
          }
          dayPropGetter={(date: Date) => ({
            className: isToday(date) ? 'calendar-today' : '',
            style: isToday(date)
              ? {
                  backgroundColor: 'hsl(var(--muted))',
                }
              : {},
          })}
          // Show full 24-hour range
          min={new Date(1970, 0, 1, 0, 0, 0)}
          max={new Date(1970, 0, 1, 23, 59, 59)}
          // Smaller step keeps hours readable while allowing precise drops
          step={60}
          timeslots={1}
          defaultDate={new Date()}
          // Start scrolled near the current time for convenience
          scrollToTime={new Date(1970, 0, 1, new Date().getHours(), 0, 0)}
          dayLayoutAlgorithm="no-overlap"
          formats={{
            timeGutterFormat: 'h a',
            eventTimeRangeFormat: (
              { start }: { start: Date; end: Date },
              culture: string,
              localizer: {
                format: (date: Date, f: string, c?: string) => string;
              }
            ) => localizer?.format(start, 'h:mm a', culture) || '',
          }}
          // Drag and drop props
          draggableAccessor={(ev: Event) => canDragEvent(ev)}
          onEventDrop={({
            event,
            start,
            end,
          }: {
            event: Event;
            start: Date | string;
            end: Date | string;
          }) => handleEventDrop({ event, start, end })}
          resizable={false}
          // Click handler for navigation
          onSelectEvent={handleSelectEvent}
        />
      </div>
    </div>
  );
}
