import type { ComponentType, CSSProperties, ReactNode } from 'react';
import type { Localizer } from './localizers';

export type CalendarView = 'month' | 'week' | 'three-day' | 'agenda';

export type CalendarEventBase = {
  id: string | number;
  title?: string;
  start: Date;
  end?: Date;
  allDay?: boolean;
  resource?: any;
};

export interface CalendarMessages {
  showMore?: (total: number) => string;
}

export interface CalendarFormats {
  timeGutter?: string; // e.g., 'h:mm a'
}

export interface CalendarComponents<E extends CalendarEventBase = CalendarEventBase> {
  event?: ComponentType<{ event: E }>;
}

export interface CalendarProps<E extends CalendarEventBase = CalendarEventBase> {
  date: Date;
  view: CalendarView;
  events: E[];

  localizer?: Localizer;
  formats?: CalendarFormats;
  messages?: CalendarMessages;
  weekStartsOn?: 0 | 1; // 0=Sunday, 1=Monday
  timezoneLabel?: string;
  timezoneTitle?: string;

  components?: CalendarComponents<E>;

  // Time grid options
  dayStartHour?: number; // 0-23
  dayEndHour?: number; // 1-24
  stepMinutes?: number; // grid resolution for drop snapping
  virtualize?: boolean;
  overscanPx?: number;

  // Drag-and-drop
  dragAndDrop?: boolean;
  useInternalDndProvider?: boolean;
  dndBackend?: any;
  dndOptions?: any;
  onEventDrop?: (args: {
    event: E;
    start: Date;
    end?: Date;
    allDay?: boolean;
  }) => void | Promise<void>;

  // Interactions
  onBackgroundClick?: (date: Date) => void; // click on empty day/time cell
  onMoreClick?: (date: Date) => void; // month view +X more

  // Styling
  className?: string;
  style?: CSSProperties;
}

export type { Localizer as CalendarLocalizer };
