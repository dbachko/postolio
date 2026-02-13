import type { CalendarContentItem, CalendarItem } from '@/types/calendar';
import type { CalendarFilterState } from '@/stores/calendarFilterStore';

export interface PlaceholderItem {
  id: string;
  scheduledAt: string;
  message?: string;
  queueAtCapacity?: boolean;
}

export type CalendarDataItem = CalendarContentItem | (PlaceholderItem & { type: 'placeholder' });

export type CalendarFilters = Pick<CalendarFilterState, 'series' | 'statuses' | 'searchQuery'>;

export interface CalendarEventResource {
  type: CalendarDataItem['type'];
  status?: string | null;
  placeholder: boolean;
  scheduledAt?: string | null;
  postedAt?: string | null;
  item: CalendarDataItem;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: CalendarEventResource;
}

export interface RescheduleState {
  open: boolean;
  item: CalendarItem | null;
}
