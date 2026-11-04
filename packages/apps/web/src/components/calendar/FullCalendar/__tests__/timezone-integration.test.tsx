import { describe, it, expect } from 'vitest';
import { luxon } from '@postolio/calendar';
import { toWallTimeDate } from '../utils/timezone';

function runRealBugScenarioRegressionTests() {
  describe('Real bug scenario regression tests', () => {
    it('REGRESSION: should not show 3:31 PM when scheduled for 11:31 PM EST', () => {
      const scheduledForEST = '2025-01-16T04:31:00Z'; // 11:31 PM EST
      const brandTimezone = 'America/New_York';
      const date = toWallTimeDate(scheduledForEST, brandTimezone);
      const localizer = luxon.create({ timezone: brandTimezone });
      const displayed = localizer.format(date!, 'h:mm a');

      expect(displayed).toBe('11:31 PM');
      expect(displayed).not.toBe('3:31 PM');
    });

    it('REGRESSION: should show correct time regardless of user location', () => {
      const scheduledAtUTC = '2025-01-16T04:31:00Z'; // 11:31 PM EST
      const brandTimezone = 'America/New_York';
      const date = toWallTimeDate(scheduledAtUTC, brandTimezone);
      const localizer = luxon.create({ timezone: brandTimezone });
      const displayedTime = localizer.format(date!, 'h:mm a');

      expect(displayedTime).toBe('11:31 PM');
    });

    it('REGRESSION: wall-time approach was wrong', () => {
      const utcDate = new Date('2025-01-16T04:31:00Z');
      const result = toWallTimeDate(utcDate.toISOString(), 'America/New_York');

      expect(result?.toISOString()).toBe(utcDate.toISOString());
    });
  });
}

describe('Calendar Timezone Integration', () => {
  describe('End-to-end timezone flow', () => {
    it('should display correct time: Database → Calendar → Display', () => {
      // SCENARIO: Post scheduled for 11:31 PM EST
      // User viewing from PST browser

      // Step 1: Database stores UTC
      const dbTimestamp = '2025-01-16T04:31:00.000Z'; // 11:31 PM EST = 4:31 AM UTC

      // Step 2: API returns this timestamp
      const contentItem = {
        id: 'test-1',
        scheduledAt: dbTimestamp,
        caption: 'Test post',
      };

      // Step 3: Calendar processing - toWallTimeDate
      const brandTimezone = 'America/New_York';
      const dateForCalendar = toWallTimeDate(contentItem.scheduledAt, brandTimezone);

      // Should return UTC date unchanged
      expect(dateForCalendar?.toISOString()).toBe(dbTimestamp);

      // Step 4: Luxon localizer formats with brand timezone
      const localizer = luxon.create({ timezone: brandTimezone });
      const displayTime = localizer.format(dateForCalendar!, 'h:mm a');

      // CRITICAL: Must show 11:31 PM (EST time) regardless of user's browser timezone
      expect(displayTime).toBe('11:31 PM');
    });

    it('should show same time for users in different timezones', () => {
      const dbTimestamp = '2025-01-16T14:00:00.000Z'; // 9:00 AM EST

      // User 1: In EST (same as brand)
      const est_localizer = luxon.create({ timezone: 'America/New_York' });
      const est_date = toWallTimeDate(dbTimestamp, 'America/New_York');
      expect(est_localizer.format(est_date!, 'h:mm a')).toBe('9:00 AM');

      // User 2: In PST (3 hours behind)
      const pst_localizer = luxon.create({ timezone: 'America/New_York' }); // Still brand timezone!
      const pst_date = toWallTimeDate(dbTimestamp, 'America/New_York');
      expect(pst_localizer.format(pst_date!, 'h:mm a')).toBe('9:00 AM');

      // User 3: In India (9.5 hours ahead)
      const ist_localizer = luxon.create({ timezone: 'America/New_York' }); // Still brand timezone!
      const ist_date = toWallTimeDate(dbTimestamp, 'America/New_York');
      expect(ist_localizer.format(ist_date!, 'h:mm a')).toBe('9:00 AM');

      // All users see the SAME time because calendar is configured with brand timezone
    });

    it('should handle multiple events with different times', () => {
      const brandTimezone = 'America/New_York';
      const localizer = luxon.create({ timezone: brandTimezone });

      const events = [
        { scheduledAt: '2025-01-16T14:00:00Z', expectedTime: '9:00 AM' }, // 9 AM EST
        { scheduledAt: '2025-01-16T17:00:00Z', expectedTime: '12:00 PM' }, // Noon EST
        { scheduledAt: '2025-01-16T22:00:00Z', expectedTime: '5:00 PM' }, // 5 PM EST
        { scheduledAt: '2025-01-17T04:31:00Z', expectedTime: '11:31 PM' }, // 11:31 PM EST
      ];

      events.forEach((event) => {
        const date = toWallTimeDate(event.scheduledAt, brandTimezone);
        const formatted = localizer.format(date!, 'h:mm a');
        expect(formatted).toBe(event.expectedTime);
      });
    });
  });

  describe('Calendar event bounds with timezone', () => {
    it('should create correct start/end bounds for events', () => {
      const scheduledAtUTC = '2025-01-16T04:31:00Z';
      const brandTimezone = 'America/New_York';

      // Calendar creates event bounds
      const start = toWallTimeDate(scheduledAtUTC, brandTimezone);
      const end = new Date(start!.getTime() + 60 * 60 * 1000); // +1 hour

      // Localizer formats both
      const localizer = luxon.create({ timezone: brandTimezone });

      expect(localizer.format(start!, 'h:mm a')).toBe('11:31 PM');
      expect(localizer.format(end, 'h:mm a')).toBe('12:31 AM');
    });

    it('should handle events spanning midnight', () => {
      const brandTimezone = 'America/New_York';
      const localizer = luxon.create({ timezone: brandTimezone });

      // Event at 11:30 PM EST
      const lateNight = toWallTimeDate('2025-01-16T04:30:00Z', brandTimezone);

      // Event at 12:30 AM EST (next day)
      const pastMidnight = toWallTimeDate('2025-01-16T05:30:00Z', brandTimezone);

      expect(localizer.format(lateNight!, 'h:mm a')).toBe('11:30 PM');
      expect(localizer.format(lateNight!, 'LLL d')).toBe('Jan 15');

      expect(localizer.format(pastMidnight!, 'h:mm a')).toBe('12:30 AM');
      expect(localizer.format(pastMidnight!, 'LLL d')).toBe('Jan 16');
    });
  });

  describe('Month view scenarios', () => {
    it('should group events by correct date in brand timezone', () => {
      const brandTimezone = 'America/New_York';
      const localizer = luxon.create({ timezone: brandTimezone });

      // These UTC times span across midnight in EST
      const events = [
        '2025-01-16T04:00:00Z', // Jan 15, 11:00 PM EST
        '2025-01-16T04:59:00Z', // Jan 15, 11:59 PM EST
        '2025-01-16T05:00:00Z', // Jan 16, 12:00 AM EST (midnight)
        '2025-01-16T05:01:00Z', // Jan 16, 12:01 AM EST
      ];

      const formattedDates = events.map((utc) => {
        const date = toWallTimeDate(utc, brandTimezone);
        return {
          date: localizer.format(date!, 'LLL d'),
          time: localizer.format(date!, 'h:mm a'),
        };
      });

      // First two events on Jan 15
      expect(formattedDates[0].date).toBe('Jan 15');
      expect(formattedDates[1].date).toBe('Jan 15');

      // Last two events on Jan 16
      expect(formattedDates[2].date).toBe('Jan 16');
      expect(formattedDates[3].date).toBe('Jan 16');
    });

    it('should handle International Date Line correctly', () => {
      const nzTimezone = 'Pacific/Auckland';
      const localizer = luxon.create({ timezone: nzTimezone });

      // UTC: Jan 15, 12:00 PM
      // NZ:  Jan 16, 1:00 AM (next day due to UTC+13)
      const utcDate = '2025-01-15T12:00:00Z';
      const date = toWallTimeDate(utcDate, nzTimezone);

      expect(localizer.format(date!, 'LLL d, yyyy')).toBe('Jan 16, 2025');
      expect(localizer.format(date!, 'h:mm a')).toBe('1:00 AM');
    });
  });

  describe('DST transitions in calendar', () => {
    it('should handle spring forward correctly', () => {
      const brandTimezone = 'America/New_York';
      const localizer = luxon.create({ timezone: brandTimezone });

      // March 9, 2025: DST starts, clocks jump from 2 AM → 3 AM

      // Before DST (1:00 AM EST)
      const beforeDST = toWallTimeDate('2025-03-09T06:00:00Z', brandTimezone);
      expect(localizer.format(beforeDST!, 'h:mm a')).toBe('1:00 AM');

      // After DST (3:00 AM EDT) - 2 AM doesn't exist!
      const afterDST = toWallTimeDate('2025-03-09T07:00:00Z', brandTimezone);
      expect(localizer.format(afterDST!, 'h:mm a')).toBe('3:00 AM');
    });

    it('should handle fall back correctly', () => {
      const brandTimezone = 'America/New_York';
      const localizer = luxon.create({ timezone: brandTimezone });

      // November 2, 2025: DST ends, clocks fall back from 2 AM → 1 AM

      // First 1:00 AM (EDT)
      const firstOccurrence = toWallTimeDate('2025-11-02T05:00:00Z', brandTimezone);
      expect(localizer.format(firstOccurrence!, 'h:mm a')).toBe('1:00 AM');

      // Second 1:00 AM (EST, after fallback)
      const secondOccurrence = toWallTimeDate('2025-11-02T06:00:00Z', brandTimezone);
      expect(localizer.format(secondOccurrence!, 'h:mm a')).toBe('1:00 AM');
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle null scheduledAt gracefully', () => {
      const result = toWallTimeDate(null, 'America/New_York');
      expect(result).toBeNull();
    });

    it('should handle invalid timezone in localizer gracefully', () => {
      // Invalid stored timezone preferences fall back deterministically to UTC.
      const localizer = luxon.create({ timezone: 'Invalid/Timezone' });
      const date = new Date('2025-01-16T04:31:00Z');
      const formatted = localizer.format(date, 'h:mm a');

      // Should still produce a formatted string (falls back to system/UTC)
      expect(formatted).toBe('4:31 AM');
    });

    it('should handle malformed ISO strings', () => {
      const result = toWallTimeDate('not-a-date', 'America/New_York');
      expect(result).toBeNull();
    });
  });

  runRealBugScenarioRegressionTests();
});
