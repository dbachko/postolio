import { TimezoneService } from './timezone.js';

/**
 * Compute upcoming posting slots for a campaign based on frequency and postingTime(s).
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

  const todayLocal = TimezoneService.toLocal(now, timezone);
  const startLocal = TimezoneService.toLocal(start, timezone);
  const endLocal = TimezoneService.toLocal(end, timezone);

  // Start from the later of campaign start or today
  let cursor = new Date(Math.max(startLocal.getTime(), todayLocal.getTime()));

  // Normalize to date only
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());

  // Determine day step
  const intervalDays =
    frequency === 'daily' ? 1 : frequency === 'every2days' ? 2 : frequency === '3weekly' ? 1 : 7;
  // Note: for '3weekly' we still generate daily slots; weekly quota enforced in caller

  while (cursor <= endLocal && slots.length < maxSlots) {
    const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
      cursor.getDate()
    ).padStart(2, '0')}`;

    for (const t of times) {
      const localScheduled = TimezoneService.createDateInBrandTimezone(dateStr, t, timezone);
      if (localScheduled > todayLocal) {
        const utc = TimezoneService.toUTC(localScheduled, timezone);
        slots.push(utc);
        if (slots.length >= maxSlots) break;
      }
    }

    // Advance cursor
    cursor.setDate(cursor.getDate() + intervalDays);
  }

  return slots;
}
