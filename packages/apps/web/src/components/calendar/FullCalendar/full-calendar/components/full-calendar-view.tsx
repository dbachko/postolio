import type { Dispatch, SetStateAction } from 'react';
import { Calendar as PostolioCalendar, type luxon } from '@postolio/calendar';
import { TouchBackend } from 'react-dnd-touch-backend';
import type { AssetType } from '@/features/assets/api/client';
import type { SocialAccountsById } from '@/types/social-accounts';
import { EventRenderer } from '../../components/EventRenderer';
import { RescheduleManager } from '../../components/RescheduleManager';
import type { CalendarEvent, RescheduleState } from '../../types';
import type { EventDropArgs } from '../hooks/calendar-event-drop-types';
import { CalendarCreateCta } from './calendar-create-cta';

type CalendarLocalizer = ReturnType<typeof luxon.create>;

export interface FullCalendarViewProps {
  assetsById?: Record<string, AssetType | null>;
  brandId: string;
  calendarView: 'month' | 'week';
  date: Date;
  effectiveSingleDestinationId: string | null;
  events: CalendarEvent[];
  handleBackgroundClick: (arg: Date) => void;
  handleEventDrop: (arg: EventDropArgs) => Promise<void>;
  isTouch: boolean;
  localizer: CalendarLocalizer;
  reschedule: RescheduleState;
  setReschedule: Dispatch<SetStateAction<RescheduleState>>;
  socialAccountsById: SocialAccountsById;
  timezone: string;
  touchDndOptions?: {
    enableTouchEvents: boolean;
    enableMouseEvents: boolean;
    delayTouchStart: number;
  };
  weekStartsOn: 0 | 1;
}

export function FullCalendarView({
  assetsById,
  brandId,
  calendarView,
  date,
  effectiveSingleDestinationId,
  events,
  handleBackgroundClick,
  handleEventDrop,
  isTouch,
  localizer,
  reschedule,
  setReschedule,
  socialAccountsById,
  timezone,
  touchDndOptions,
  weekStartsOn,
}: FullCalendarViewProps) {
  return (
    <>
      <PostolioCalendar
        localizer={localizer}
        view={calendarView as never}
        date={date}
        events={events as never}
        weekStartsOn={weekStartsOn}
        dragAndDrop
        dndBackend={isTouch ? TouchBackend : undefined}
        dndOptions={touchDndOptions}
        onEventDrop={handleEventDrop}
        components={{
          event: ({ event }: { event: CalendarEvent }) => (
            <EventRenderer
              event={event}
              timezone={timezone}
              brandId={brandId}
              onReschedule={(item) => setReschedule({ open: true, item })}
              assetsById={assetsById}
              socialAccountsById={socialAccountsById}
              hideDestinations={Boolean(effectiveSingleDestinationId)}
            />
          ),
          createCta: CalendarCreateCta,
        }}
        onBackgroundClick={handleBackgroundClick}
      />
      <RescheduleManager
        brandId={brandId}
        timezone={timezone}
        state={reschedule}
        onStateChange={setReschedule}
      />
    </>
  );
}
