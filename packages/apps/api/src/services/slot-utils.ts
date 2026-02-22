import { TimezoneService } from './timezone.js';

const MIN_SLOT_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Compute upcoming posting slots for a schedule cadence based on frequency and postingTime(s).
 * Returns Date objects representing the brand-local time converted to UTC for storage.
 */
export async function computeUpcomingSlots(
  start: Date,
  end: Date,
  postingTime: string,
  postingTimes: string[],
  frequency: 'daily' | 'every2days' | '3weekly' | string,
  timezone: string,
  maxSlots: number,
  now: Date = new Date()
): Promise<Date[]> {
  const slots: Date[] = [];

  const times = (
    Array.isArray(postingTimes) && postingTimes.length > 0 ? postingTimes : [postingTime]
  )
    .filter(Boolean)
    .map((t) => {
      const [h, m] = t.split(':');
      const hh = String(parseInt(h ?? '0', 10)).padStart(2, '0');
      const mm = String(parseInt(m ?? '0', 10)).padStart(2, '0');
      return `${hh}:${mm}`;
    })
    .filter((v, i, a) => a.indexOf(v) === i);

  // Compute day boundaries using timezone-aware formatting to avoid DST issues
  const fmtYmd = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(d)
      .replace(/\//g, '-');
  const addDays = (ymd: string, days: number) => {
    const dt = new Date(`${ymd}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  };

  const todayStr = fmtYmd(now);
  let cursorStr = fmtYmd(start);
  const endStr = fmtYmd(end);
  const bufferedNow = new Date(now.getTime() + MIN_SLOT_BUFFER_MS);

  const toUtcMidnight = (ymd: string) =>
    TimezoneService.createDateInBrandTimezone(ymd, '00:00', timezone);
  const todayStart = toUtcMidnight(todayStr);
  let cursor = toUtcMidnight(cursorStr);

  // Determine day step
  const intervalDays =
    frequency === 'daily' ? 1 : frequency === 'every2days' ? 2 : frequency === '3weekly' ? 1 : 7;
  // Note: for '3weekly' we still generate daily slots; weekly quota enforced in caller

  // First, include any remaining times today (even if cadence would skip today)
  let addedToday = false;
  for (const t of times) {
    const scheduledUtc = TimezoneService.createDateInBrandTimezone(todayStr, t, timezone);
    if (scheduledUtc > bufferedNow) {
      slots.push(scheduledUtc);
      addedToday = true;
      if (slots.length >= maxSlots) {
        return slots;
      }
    }
  }

  // Keep cursor aligned to the original cadence even after the start date passes
  while (cursor < todayStart) {
    cursorStr = addDays(cursorStr, intervalDays);
    cursor = toUtcMidnight(cursorStr);
  }

  // If we already added today's slots, advance past today to avoid duplicates
  if (addedToday && cursorStr === todayStr) {
    cursorStr = addDays(cursorStr, intervalDays);
    cursor = toUtcMidnight(cursorStr);
  }

  while (cursorStr <= endStr && slots.length < maxSlots) {
    const dateStr = cursorStr;

    for (const t of times) {
      const scheduledUtc = TimezoneService.createDateInBrandTimezone(dateStr, t, timezone);
      if (scheduledUtc > bufferedNow) {
        slots.push(scheduledUtc);
        if (slots.length >= maxSlots) {
          break;
        }
      }
    }

    // Advance cursor
    cursorStr = addDays(cursorStr, intervalDays);
    cursor = toUtcMidnight(cursorStr);
  }

  return slots;
}
