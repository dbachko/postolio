import type { CalendarDataItem } from '../types';
import { DEFAULT_EVENT_DURATION_MS } from '../constants';

export function formatGmtOffset(hours: number): string {
  const sign = hours >= 0 ? '+' : '-';
  const abs = Math.abs(hours);
  const whole = Math.floor(abs);
  const minutes = Math.round((abs - whole) * 60);

  if (minutes) {
    return `GMT${sign}${whole}:${String(minutes).padStart(2, '0')}`;
  }

  return `GMT${sign}${whole}`;
}

export function toWallTimeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getEventBounds(item: CalendarDataItem): { start: Date; end: Date } | null {
  const baseIso =
    item.type === 'placeholder'
      ? item.scheduledAt
      : getContentIso(item, ['postedAt', 'scheduledAt', 'createdAt']);

  const start = toWallTimeDate(baseIso ?? null);
  if (!start) return null;

  const endIso = item.type === 'content' ? getContentIso(item, ['endAt']) : undefined;
  const end =
    toWallTimeDate(endIso ?? null) ?? new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS);

  return { start, end };
}

export function buildTimezoneLabel(abbr: string, offset: string): string {
  return `${abbr} · ${offset}`;
}

function getContentIso(
  item: Extract<CalendarDataItem, { type: 'content' }> | CalendarDataItem,
  keys: Array<'postedAt' | 'scheduledAt' | 'createdAt' | 'endAt'>
): string | null | undefined {
  if (item.type !== 'content') return null;

  const candidate = item as unknown as Record<string, unknown>;

  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return null;
}
