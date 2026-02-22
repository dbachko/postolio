import { formatInTimeZone } from 'date-fns-tz';

export function matchesQuery(timezone: string, query: string): boolean {
  if (!query) {
    return true;
  }
  const q = query.toLowerCase();
  const raw = timezone.toLowerCase();
  const spaced = timezone.replace(/_/g, ' ').toLowerCase();
  return raw.includes(q) || spaced.includes(q);
}

export function formatTimezoneLabel(timezone: string): string {
  if (timezone === 'UTC') {
    return 'UTC';
  }
  const parts = timezone.split('/');
  const lastPart = parts[parts.length - 1] || timezone;
  return lastPart.replace(/_/g, ' ');
}

export function formatTimezoneOffsetLabel(timezone: string, now: Date): string | null {
  try {
    const formatted = formatInTimeZone(now, timezone, 'O');
    return formatted === 'GMT+0' ? 'GMT' : formatted;
  } catch {
    return null;
  }
}
