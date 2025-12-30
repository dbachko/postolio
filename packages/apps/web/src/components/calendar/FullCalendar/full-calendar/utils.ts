import { addDays, startOfMonth, startOfWeek } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { convertLocalToUTC } from '@/lib/timezone';

type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function getQueueSlotRange(opts: {
  view: 'month' | 'week';
  date: Date;
  timezone: string;
  weekStartsOn: WeekStartsOn;
}): { afterUtcIso: string; endUtcMs: number; limit: number } {
  const { view, date, timezone, weekStartsOn } = opts;
  const zoned = toZonedTime(date, timezone);

  if (view === 'month') {
    const monthStart = startOfMonth(zoned);
    const localStart = startOfWeek(monthStart, { weekStartsOn });
    const localEnd = addDays(localStart, 42);
    return {
      afterUtcIso: convertLocalToUTC(localStart, timezone).toISOString(),
      endUtcMs: convertLocalToUTC(localEnd, timezone).getTime(),
      limit: 600,
    };
  }

  if (view === 'week') {
    const localStart = startOfWeek(zoned, { weekStartsOn });
    const localEnd = addDays(localStart, 7);
    return {
      afterUtcIso: convertLocalToUTC(localStart, timezone).toISOString(),
      endUtcMs: convertLocalToUTC(localEnd, timezone).getTime(),
      limit: 250,
    };
  }

  const exhaustive: never = view;
  throw new Error(`Unhandled calendar view: ${exhaustive}`);
}

const SLOT_CONFLICT_WINDOW_MS = 60 * 1000; // 1 minute (match API)

export function isTimeOccupied(params: {
  candidateUtcMs: number;
  occupiedUtcMsSorted: number[];
}): boolean {
  const { candidateUtcMs, occupiedUtcMsSorted } = params;
  if (occupiedUtcMsSorted.length === 0) return false;

  // Binary search for nearest occupied time.
  let lo = 0;
  let hi = occupiedUtcMsSorted.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = occupiedUtcMsSorted[mid]!;
    if (t === candidateUtcMs) return true;
    if (t < candidateUtcMs) lo = mid + 1;
    else hi = mid - 1;
  }

  const left = hi >= 0 ? occupiedUtcMsSorted[hi] : null;
  const right = lo < occupiedUtcMsSorted.length ? occupiedUtcMsSorted[lo] : null;

  if (left !== null && Math.abs(candidateUtcMs - left) < SLOT_CONFLICT_WINDOW_MS) return true;
  if (right !== null && Math.abs(candidateUtcMs - right) < SLOT_CONFLICT_WINDOW_MS) return true;
  return false;
}
