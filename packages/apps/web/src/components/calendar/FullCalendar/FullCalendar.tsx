import { memo, useState, useCallback } from 'react';
import '@postolio/calendar/styles.css';
import { Calendar as PostolioCalendar, luxon } from '@postolio/calendar';
import { TouchBackend } from 'react-dnd-touch-backend';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { content as contentApi, type Content } from '@/lib/api';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { convertLocalToUTC } from '@/lib/timezone';
import { useCalendarItems } from './hooks/useCalendarItems';
import { useFilteredEvents } from './hooks/useFilteredEvents';
import { useTimezoneMeta } from './hooks/useTimezoneMeta';
import { useCalendarFilters } from './hooks/useCalendarFilters';
import { EventRenderer } from './components/EventRenderer';
import { RescheduleManager } from './components/RescheduleManager';
import { isTouchDevice } from './utils/device';
import { CALENDAR_VIEW_MAP } from './constants';
import type { CalendarEvent, PlaceholderItem, RescheduleState } from './types';

export interface FullCalendarProps {
  brandId: string;
  brandTimezone: string;
  view: 'month' | 'week' | 'three-day' | 'schedule';
  date: Date;
  content?: Content[];
  placeholders?: PlaceholderItem[];
  theme?: 'default' | 'monarch';
}

const localizer = luxon.create();

function FullCalendarImpl({
  brandId,
  brandTimezone,
  view,
  date,
  content = [],
  placeholders = [],
}: FullCalendarProps) {
  const queryClient = useQueryClient();
  const { openSidebar } = useRightSidebarRouter();

  const [reschedule, setReschedule] = useState<RescheduleState>({ open: false, item: null });

  const { tzRef, weekStartsOn } = useTimezoneMeta(brandTimezone);
  const items = useCalendarItems(content, placeholders);
  const filters = useCalendarFilters();
  const events = useFilteredEvents(items, filters);

  const calendarView = CALENDAR_VIEW_MAP[view] ?? 'month';
  const calendarDate = calendarView === 'agenda' ? new Date() : date;
  const isTouch = isTouchDevice();

  const handleEventDrop = useCallback(
    async ({ event, start }: { event: CalendarEvent; start: Date }) => {
      try {
        const resource = event.resource;
        if (resource.placeholder || resource.status === 'published') {
          return;
        }

        if (!start) {
          throw new Error('Missing start date');
        }

        const utcISO = convertLocalToUTC(new Date(start), tzRef.current).toISOString();
        await contentApi.updateContent({ contentId: event.id, scheduledAt: utcISO });
        toast.success('Post rescheduled');
      } catch (error) {
        console.error(error);
        toast.error('Failed to reschedule');
      } finally {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
      }
    },
    [brandId, queryClient, tzRef]
  );

  const handleMoreClick = useCallback((value: Date) => {
    if (typeof window === 'undefined') return;

    try {
      const day = new Date(value);
      const yyyy = day.getFullYear();
      const mm = String(day.getMonth() + 1).padStart(2, '0');
      const dd = String(day.getDate()).padStart(2, '0');
      const dayStr = `${yyyy}-${mm}-${dd}`;
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'three-day');
      url.searchParams.set('date', dayStr);
      window.location.assign(url.toString());
    } catch (error) {
      console.error(error);
    }
  }, []);

  const handleBackgroundClick = useCallback(
    (value: Date) => {
      if (typeof window === 'undefined') return;

      try {
        const local = new Date(value);
        if (calendarView === 'month') {
          local.setHours(10, 0, 0, 0);
        }
        const utcISO = convertLocalToUTC(local).toISOString();
        const url = new URL(window.location.href);
        url.searchParams.set('scheduledAt', utcISO);
        window.history.replaceState({}, '', url.toString());
        openSidebar('post-create');
      } catch (error) {
        console.error(error);
      }
    },
    [calendarView, openSidebar]
  );

  return (
    <>
      <PostolioCalendar
        localizer={localizer}
        view={calendarView as never}
        date={calendarView === 'agenda' ? new Date() : calendarDate}
        events={events as never}
        weekStartsOn={weekStartsOn}
        dragAndDrop
        dndBackend={isTouch ? TouchBackend : undefined}
        dndOptions={isTouch ? { enableMouseEvents: true } : undefined}
        onEventDrop={handleEventDrop}
        onMoreClick={handleMoreClick}
        components={{
          event: ({ event }: { event: CalendarEvent }) => (
            <EventRenderer
              event={event as CalendarEvent}
              timezone={tzRef.current}
              brandId={brandId}
              onReschedule={(item) => setReschedule({ open: true, item })}
            />
          ),
        }}
        onBackgroundClick={handleBackgroundClick}
      />
      <RescheduleManager
        brandId={brandId}
        timezone={tzRef.current}
        state={reschedule}
        onStateChange={setReschedule}
      />
    </>
  );
}

export const FullCalendar = memo(FullCalendarImpl, (prev, next) => {
  return (
    prev.brandId === next.brandId &&
    prev.brandTimezone === next.brandTimezone &&
    prev.view === next.view &&
    prev.date.getTime() === next.date.getTime() &&
    prev.content === next.content &&
    prev.placeholders === next.placeholders &&
    prev.theme === next.theme
  );
});

export default FullCalendar;
