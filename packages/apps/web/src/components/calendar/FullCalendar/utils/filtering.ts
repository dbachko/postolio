import type { CalendarDataItem, CalendarFilters } from '../types';

export function applyFilters(
  items: CalendarDataItem[],
  filters: CalendarFilters
): CalendarDataItem[] {
  const { statuses, searchQuery } = filters;

  return items.filter((item) => {
    // Queue slots are structural calendar affordances; content filters should never hide them.
    if (isQueueSlotPlaceholder(item)) {
      return true;
    }

    if (statuses.length > 0 && !matchesStatus(item, statuses)) {
      return false;
    }

    if (searchQuery && !matchesSearchQuery(item, searchQuery)) {
      return false;
    }

    return true;
  });
}

function isQueueSlotPlaceholder(item: CalendarDataItem): boolean {
  if (item.type !== 'placeholder') return false;
  return item.message === 'Queue slot';
}

function matchesStatus(item: CalendarDataItem, statuses: string[]): boolean {
  if (item.type === 'placeholder') {
    return false;
  }

  const status = asRecord(item).status;

  if (typeof status !== 'string') {
    return false;
  }

  return statuses.includes(status);
}

function matchesSearchQuery(item: CalendarDataItem, query: string): boolean {
  const normalized = query.toLowerCase();

  const caption = getStringField(item, 'caption');
  if (caption && caption.includes(normalized)) {
    return true;
  }

  const hashtags = getArrayField(item, 'hashtags').join(' ');
  if (hashtags && hashtags.toLowerCase().includes(normalized)) {
    return true;
  }
  return false;
}

function getStringField(item: CalendarDataItem, key: 'caption'): string {
  const source = asRecord(item);
  const value = source[key];

  if (typeof value === 'string') {
    return value.toLowerCase();
  }

  return '';
}

function getArrayField(item: CalendarDataItem, key: 'hashtags'): string[] {
  const source = asRecord(item);
  const value = source[key];

  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string') as string[];
  }

  return [];
}

function asRecord(item: CalendarDataItem): Record<string, unknown> {
  return item as unknown as Record<string, unknown>;
}
