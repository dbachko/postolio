import { TimezoneService } from './timezone.js';

const MIN_SLOT_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

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
  const bufferedNow = new Date(now.getTime() + MIN_SLOT_BUFFER_MS);

  const toStartOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayStart = toStartOfDay(todayLocal);
  const cursor = toStartOfDay(startLocal);

  // Determine day step
  const intervalDays =
    frequency === 'daily' ? 1 : frequency === 'every2days' ? 2 : frequency === '3weekly' ? 1 : 7;
  // Note: for '3weekly' we still generate daily slots; weekly quota enforced in caller

  // Keep cursor aligned to the original campaign cadence even after the start date passes
  while (cursor < todayStart) {
    cursor.setDate(cursor.getDate() + intervalDays);
  }

  while (cursor <= endLocal && slots.length < maxSlots) {
    const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
      cursor.getDate()
    ).padStart(2, '0')}`;

    for (const t of times) {
      const scheduledUtc = TimezoneService.createDateInBrandTimezone(dateStr, t, timezone);
      if (scheduledUtc > bufferedNow) {
        slots.push(scheduledUtc);
        if (slots.length >= maxSlots) break;
      }
    }

    // Advance cursor
    cursor.setDate(cursor.getDate() + intervalDays);
  }

  return slots;
}
