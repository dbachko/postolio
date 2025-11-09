import { DateTime } from 'luxon';

export type FormatToken =
  | 'H:mm'
  | 'h:mm a'
  | 'EEE'
  | 'EEEE'
  | 'LLL'
  | 'LLLL'
  | 'LLL d'
  | 'LLL dd'
  | 'LLL d, yyyy'
  | 'yyyy-LL-dd'
  | string;

export interface Localizer {
  format(date: Date, token: FormatToken): string;
  startOfWeek(date: Date, weekStartsOn?: 0 | 1): Date;
  endOfWeek(date: Date, weekStartsOn?: 0 | 1): Date;
  startOfMonth(date: Date): Date;
  endOfMonth(date: Date): Date;
  addDays(date: Date, amount: number): Date;
  addWeeks(date: Date, amount: number): Date;
  addMonths(date: Date, amount: number): Date;
}

export function createLuxonLocalizer(opts?: {
  weekStartsOn?: 0 | 1;
  timezone?: string;
}): Localizer {
  const weekStartsOn = opts?.weekStartsOn ?? 1; // Monday default
  const timezone = opts?.timezone; // Optional timezone for formatting
  return {
    format(d: Date, token: FormatToken) {
      // Normalize base to UTC to avoid environment-dependent interpretations
      // Then shift to the requested IANA zone for display.
      const dtUtc = DateTime.fromMillis(d.getTime(), { zone: 'utc' });
      const dt = timezone ? dtUtc.setZone(timezone) : dtUtc;
      return dt.toFormat(token);
    },
    startOfWeek(d: Date, w?: 0 | 1) {
      const dt = DateTime.fromJSDate(d);
      const start = dt.startOf('week'); // Luxon starts week on Monday (ISO)
      if ((w ?? weekStartsOn) === 0) {
        // shift to Sunday
        const day = start.weekday; // 1..7
        const diff = day % 7; // 0 for Sunday, 1 for Monday, ...
        return start.minus({ days: diff }).toJSDate();
      }
      return start.toJSDate();
    },
    endOfWeek(d: Date, w?: 0 | 1) {
      const so = this.startOfWeek(d, w);
      return DateTime.fromJSDate(so).plus({ days: 6 }).endOf('day').toJSDate();
    },
    startOfMonth(d: Date) {
      return DateTime.fromJSDate(d).startOf('month').toJSDate();
    },
    endOfMonth(d: Date) {
      return DateTime.fromJSDate(d).endOf('month').toJSDate();
    },
    addDays(d: Date, amount: number) {
      return DateTime.fromJSDate(d).plus({ days: amount }).toJSDate();
    },
    addWeeks(d: Date, amount: number) {
      return DateTime.fromJSDate(d).plus({ weeks: amount }).toJSDate();
    },
    addMonths(d: Date, amount: number) {
      return DateTime.fromJSDate(d).plus({ months: amount }).toJSDate();
    },
  };
}

export const luxon = { create: createLuxonLocalizer };
