import { describe, it, expect } from 'vitest';
import { toWallTimeDate, formatGmtOffset } from '../timezone';

describe('Calendar Timezone Utilities', () => {
  describe('toWallTimeDate()', () => {
    it('should return UTC date directly (localizer handles timezone)', () => {
      const isoString = '2025-01-16T04:31:00Z';
      const result = toWallTimeDate(isoString, 'America/New_York');

      // Should return UTC date as-is
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe('2025-01-16T04:31:00.000Z');
    });

    it('should parse ISO string without timezone param', () => {
      const isoString = '2025-01-16T04:31:00Z';
      const result = toWallTimeDate(isoString);

      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe('2025-01-16T04:31:00.000Z');
    });

    it('should return null for null input', () => {
      expect(toWallTimeDate(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(toWallTimeDate(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(toWallTimeDate('')).toBeNull();
    });

    it('should return null for invalid date string', () => {
      expect(toWallTimeDate('invalid-date')).toBeNull();
    });

    it('should handle ISO string with milliseconds', () => {
      const isoString = '2025-01-16T04:31:00.123Z';
      const result = toWallTimeDate(isoString, 'America/New_York');

      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe(isoString);
    });

    it('should handle ISO string without Z suffix', () => {
      const isoString = '2025-01-16T04:31:00';
      const result = toWallTimeDate(isoString);

      expect(result).toBeInstanceOf(Date);
      // JavaScript interprets this as local timezone, but still valid
      expect(result?.getTime()).toBeGreaterThan(0);
    });
  });

  describe('formatGmtOffset()', () => {
    it('should format positive offset without minutes', () => {
      expect(formatGmtOffset(5)).toBe('GMT+5');
    });

    it('should format negative offset without minutes', () => {
      expect(formatGmtOffset(-8)).toBe('GMT-8');
    });

    it('should format positive offset with minutes', () => {
      expect(formatGmtOffset(5.5)).toBe('GMT+5:30');
    });

    it('should format negative offset with minutes', () => {
      expect(formatGmtOffset(-3.5)).toBe('GMT-3:30');
    });

    it('should format zero offset', () => {
      expect(formatGmtOffset(0)).toBe('GMT+0');
    });

    it('should handle fractional hours correctly', () => {
      expect(formatGmtOffset(9.75)).toBe('GMT+9:45'); // Nepal
      expect(formatGmtOffset(-9.5)).toBe('GMT-9:30'); // Marquesas
    });

    it('should pad minutes with zero', () => {
      expect(formatGmtOffset(5.083333)).toBe('GMT+5:05'); // ~5 minutes
    });
  });

  describe('Real-world calendar display scenarios', () => {
    it('should prepare UTC dates for calendar localizer (EST brand, PST user)', () => {
      // Scenario: User in PST viewing calendar for EST brand
      // Post scheduled for 11:31 PM EST = 2025-01-16T04:31:00Z

      const scheduledAtUTC = '2025-01-16T04:31:00Z';
      const brandTimezone = 'America/New_York';

      // toWallTimeDate returns UTC date
      const calendarDate = toWallTimeDate(scheduledAtUTC, brandTimezone);

      // Calendar receives UTC date
      expect(calendarDate?.toISOString()).toBe('2025-01-16T04:31:00.000Z');

      // The luxon localizer (tested separately) will format this as:
      // "11:31 PM" in EST, regardless of user's browser timezone
    });

    it('should prepare UTC dates for calendar localizer (EST brand, IST user)', () => {
      // Scenario: User in India viewing calendar for EST brand
      // Post scheduled for 9:00 AM EST = 2025-01-16T14:00:00Z

      const scheduledAtUTC = '2025-01-16T14:00:00Z';
      const brandTimezone = 'America/New_York';

      const calendarDate = toWallTimeDate(scheduledAtUTC, brandTimezone);

      // Should return UTC date unchanged
      expect(calendarDate?.toISOString()).toBe('2025-01-16T14:00:00.000Z');
    });

    it('should handle midnight in brand timezone', () => {
      // Midnight EST = 5:00 AM UTC
      const midnightEST = '2025-01-16T05:00:00Z';
      const result = toWallTimeDate(midnightEST, 'America/New_York');

      expect(result?.toISOString()).toBe('2025-01-16T05:00:00.000Z');
    });

    it('should handle noon in brand timezone', () => {
      // Noon EST = 5:00 PM UTC
      const noonEST = '2025-01-16T17:00:00Z';
      const result = toWallTimeDate(noonEST, 'America/New_York');

      expect(result?.toISOString()).toBe('2025-01-16T17:00:00.000Z');
    });

    it('should handle date across International Date Line', () => {
      // Jan 15 in Pacific, but Jan 16 in New Zealand
      const utcDate = '2025-01-15T12:00:00Z';
      const result = toWallTimeDate(utcDate, 'Pacific/Auckland');

      // Returns UTC date - localizer will show Jan 16 in NZ timezone
      expect(result?.toISOString()).toBe('2025-01-15T12:00:00.000Z');
    });
  });

  describe('Integration with calendar workflow', () => {
    it('should maintain correct workflow: Storage → toWallTimeDate → Localizer', () => {
      // Step 1: Database stores UTC
      const dbStoredUTC = '2025-01-16T04:31:00.000Z';

      // Step 2: API returns UTC ISO string
      const apiResponse = { scheduledAt: dbStoredUTC };

      // Step 3: Calendar calls toWallTimeDate
      const brandTimezone = 'America/New_York';
      const dateForCalendar = toWallTimeDate(apiResponse.scheduledAt, brandTimezone);

      // Step 4: Calendar receives UTC date
      expect(dateForCalendar?.toISOString()).toBe(dbStoredUTC);

      // Step 5: Luxon localizer (configured with brandTimezone) formats it
      // This is tested in localizers.test.ts
      // Result: "11:31 PM" displayed in calendar
    });

    it('should work with placeholder dates', () => {
      const placeholderScheduledAt = '2025-01-20T14:00:00Z';
      const result = toWallTimeDate(placeholderScheduledAt, 'America/New_York');

      expect(result?.toISOString()).toBe('2025-01-20T14:00:00.000Z');
    });

    it('should work with postedAt dates', () => {
      const postedAtUTC = '2025-01-15T19:23:45.123Z';
      const result = toWallTimeDate(postedAtUTC, 'America/New_York');

      expect(result?.toISOString()).toBe(postedAtUTC);
    });
  });

  describe('DST edge cases', () => {
    it('should handle spring forward DST transition (EST → EDT)', () => {
      // March 9, 2025, 2:00 AM EST → 3:00 AM EDT (clocks jump forward)
      const beforeDST = '2025-03-09T06:59:00Z'; // 1:59 AM EST
      const afterDST = '2025-03-09T07:01:00Z'; // 3:01 AM EDT

      expect(toWallTimeDate(beforeDST, 'America/New_York')?.toISOString()).toBe(
        '2025-03-09T06:59:00.000Z'
      );
      expect(toWallTimeDate(afterDST, 'America/New_York')?.toISOString()).toBe(
        '2025-03-09T07:01:00.000Z'
      );
    });

    it('should handle fall back DST transition (EDT → EST)', () => {
      // November 2, 2025, 2:00 AM EDT → 1:00 AM EST (clocks fall back)
      const beforeFallback = '2025-11-02T05:59:00Z'; // 1:59 AM EDT
      const afterFallback = '2025-11-02T06:01:00Z'; // 1:01 AM EST

      expect(toWallTimeDate(beforeFallback, 'America/New_York')?.toISOString()).toBe(
        '2025-11-02T05:59:00.000Z'
      );
      expect(toWallTimeDate(afterFallback, 'America/New_York')?.toISOString()).toBe(
        '2025-11-02T06:01:00.000Z'
      );
    });
  });

  describe('Performance and edge cases', () => {
    it('should handle very old dates', () => {
      const oldDate = '1970-01-01T00:00:00Z';
      const result = toWallTimeDate(oldDate);

      expect(result?.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    });

    it('should handle far future dates', () => {
      const futureDate = '2099-12-31T23:59:59Z';
      const result = toWallTimeDate(futureDate);

      expect(result?.toISOString()).toBe('2099-12-31T23:59:59.000Z');
    });

    it('should be performant with many calls', () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        toWallTimeDate('2025-01-16T04:31:00Z', 'America/New_York');
      }

      const duration = Date.now() - start;
      // Should complete 1000 calls in under 100ms
      expect(duration).toBeLessThan(100);
    });
  });
});
