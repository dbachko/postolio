import { useMemo } from 'react';
import type { CalendarDataItem, CalendarEvent, CalendarFilters } from '../types';
import { applyFilters } from '../utils/filtering';
import { getEventBounds } from '../utils/timezone';

function getEventStartTime(event: CalendarEvent): number {
  const start = event.start;
  return start instanceof Date ? start.getTime() : 0;
}

function isPlaceholderEvent(event: CalendarEvent): boolean {
  return Boolean((event as any)?.resource?.placeholder);
}

function compareCalendarEvents(left: CalendarEvent, right: CalendarEvent): number {
  const startDiff = getEventStartTime(left) - getEventStartTime(right);
  if (startDiff !== 0) {
    return startDiff;
  }

  const leftPlaceholder = isPlaceholderEvent(left);
  const rightPlaceholder = isPlaceholderEvent(right);
  if (leftPlaceholder !== rightPlaceholder) {
    return leftPlaceholder ? 1 : -1;
  }

  return String(left.title ?? '').localeCompare(String(right.title ?? ''));
}

function toCalendarEvent(item: CalendarDataItem, timezone: string): CalendarEvent | null {
  const bounds = getEventBounds(item, timezone);
  if (!bounds) {
    return null;
  }

  const record = item as unknown as Record<string, unknown>;
  const isPlaceholder = item.type === 'placeholder';

  return {
    id: String(item.id),
    title: buildTitle(item, record),
    start: bounds.start,
    end: bounds.end,
    allDay: false,
    resource: {
      type: item.type,
      status: isPlaceholder ? 'placeholder' : readString(record.status),
      placeholder: isPlaceholder,
      scheduledAt: readString(isPlaceholder ? item.scheduledAt : record.scheduledAt),
      postedAt: readString(record.postedAt),
      item,
    },
  };
}

export function useFilteredEvents(
  items: CalendarDataItem[],
  filters: CalendarFilters,
  timezone: string
): CalendarEvent[] {
  const { series, statuses, searchQuery } = filters;

  return useMemo(() => {
    const filterSnapshot: CalendarFilters = {
      series,
      statuses,
      searchQuery,
    };

    const filtered = applyFilters(items, filterSnapshot);
    const events: CalendarEvent[] = [];

    for (const item of filtered) {
      const event = toCalendarEvent(item, timezone);
      if (event) {
        events.push(event);
      }
    }

    events.sort(compareCalendarEvents);

    return events;
  }, [items, series, statuses, searchQuery, timezone]);
}

function buildTitle(item: CalendarDataItem, record: Record<string, unknown>): string {
  if (item.type === 'placeholder') {
    return 'Future Post';
  }

  const caption = readString(record.caption);
  if (!caption) {
    return '';
  }

  return caption.slice(0, 60);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
