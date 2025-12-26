import { useMemo } from 'react';
import type { CalendarDataItem, CalendarEvent, CalendarFilters } from '../types';
import { applyFilters } from '../utils/filtering';
import { getEventBounds } from '../utils/timezone';

export function useFilteredEvents(
  items: CalendarDataItem[],
  filters: CalendarFilters,
  timezone: string
): CalendarEvent[] {
  const { campaigns, statuses, searchQuery } = filters;

  return useMemo(() => {
    const filterSnapshot: CalendarFilters = {
      campaigns,
      statuses,
      searchQuery,
    };

    const filtered = applyFilters(items, filterSnapshot);
    const events: CalendarEvent[] = [];

    for (const item of filtered) {
      const bounds = getEventBounds(item, timezone);
      if (!bounds) continue;

      const record = item as unknown as Record<string, unknown>;
      const isPlaceholder = item.type === 'placeholder';

      const status = isPlaceholder ? 'placeholder' : readString(record.status);
      const campaignId = readString(isPlaceholder ? item.campaignId : record.campaignId);
      const campaignName = readString(isPlaceholder ? item.campaignName : record.campaignName);
      const campaignColor = readString(isPlaceholder ? item.campaignColor : record.campaignColor);
      const scheduledAt = readString(isPlaceholder ? item.scheduledAt : record.scheduledAt);
      const postedAt = readString(record.postedAt);

      const event: CalendarEvent = {
        id: String(item.id),
        title: buildTitle(item, record),
        start: bounds.start,
        end: bounds.end,
        allDay: false,
        resource: {
          type: item.type,
          status,
          campaignId,
          campaignName,
          campaignColor,
          placeholder: isPlaceholder,
          scheduledAt,
          postedAt,
          item,
        },
      };

      events.push(event);
    }

    events.sort((a, b) => {
      const ta = a.start?.getTime?.() ?? 0;
      const tb = b.start?.getTime?.() ?? 0;
      if (ta !== tb) return ta - tb;

      const aPlaceholder = Boolean((a as any)?.resource?.placeholder);
      const bPlaceholder = Boolean((b as any)?.resource?.placeholder);
      if (aPlaceholder !== bPlaceholder) return aPlaceholder ? 1 : -1;

      return String(a.title ?? '').localeCompare(String(b.title ?? ''));
    });

    return events;
  }, [items, campaigns, statuses, searchQuery, timezone]);
}

function buildTitle(item: CalendarDataItem, record: Record<string, unknown>): string {
  if (item.type === 'placeholder') {
    return 'Future Post';
  }

  const caption = readString(record.caption);
  if (!caption) return '';

  return caption.slice(0, 60);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
