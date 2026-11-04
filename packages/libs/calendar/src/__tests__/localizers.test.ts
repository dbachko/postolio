import { describe, it, expect } from 'vitest';
import { createLuxonLocalizer } from '../localizers';

describe('Luxon Localizer Timezone Handling', () => {
  describe('format() with timezone configuration', () => {
    it('should format UTC date in specified timezone (EST)', () => {
      const localizer = createLuxonLocalizer({ timezone: 'America/New_York' });

      // UTC: 2025-01-16T04:31:00Z (Jan 16, 4:31 AM UTC)
      // EST: Jan 15, 11:31 PM EST (UTC-5)
      const utcDate = new Date('2025-01-16T04:31:00Z');

      const formatted = localizer.format(utcDate, 'h:mm a');
      expect(formatted).toBe('11:31 PM');
    });

    it('should format UTC date in specified timezone (PST)', () => {
      const localizer = createLuxonLocalizer({ timezone: 'America/Los_Angeles' });

      // UTC: 2025-01-16T04:31:00Z (Jan 16, 4:31 AM UTC)
      // PST: Jan 15, 8:31 PM PST (UTC-8)
      const utcDate = new Date('2025-01-16T04:31:00Z');

      const formatted = localizer.format(utcDate, 'h:mm a');
      expect(formatted).toBe('8:31 PM');
    });

    it('should format UTC date in specified timezone (IST)', () => {
      const localizer = createLuxonLocalizer({ timezone: 'Asia/Kolkata' });

      // UTC: 2025-01-16T04:31:00Z (Jan 16, 4:31 AM UTC)
      // IST: Jan 16, 10:01 AM IST (UTC+5:30)
      const utcDate = new Date('2025-01-16T04:31:00Z');

      const formatted = localizer.format(utcDate, 'h:mm a');
      expect(formatted).toBe('10:01 AM');
    });

    it('should format date without timezone (uses local)', () => {
      const localizer = createLuxonLocalizer();

      const date = new Date('2025-01-16T04:31:00Z');
      const formatted = localizer.format(date, 'h:mm a');

      // Should format in system timezone (can't assert exact value)
      expect(formatted).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
    });

    it('should format date across DST transition', () => {
      const localizer = createLuxonLocalizer({ timezone: 'America/New_York' });

      // Before DST: EST (UTC-5)
      const beforeDST = new Date('2025-03-08T14:00:00Z');
      expect(localizer.format(beforeDST, 'h:mm a')).toBe('9:00 AM');

      // After DST: EDT (UTC-4)
      const afterDST = new Date('2025-03-10T14:00:00Z');
      expect(localizer.format(afterDST, 'h:mm a')).toBe('10:00 AM');
    });

    it('should format full date with timezone', () => {
      const localizer = createLuxonLocalizer({ timezone: 'America/New_York' });

      const utcDate = new Date('2025-01-16T04:31:00Z');

      expect(localizer.format(utcDate, 'LLL d, yyyy')).toBe('Jan 15, 2025');
      expect(localizer.format(utcDate, 'h:mm a')).toBe('11:31 PM');
      expect(localizer.format(utcDate, 'EEEE')).toBe('Wednesday');
    });
  });

  describe('Real-world calendar scenarios', () => {
    it('should show same clock time regardless of browser timezone', () => {
      // Post scheduled for 11:31 PM EST
      const utcDate = new Date('2025-01-16T04:31:00Z');

      // User in EST
      const estLocalizer = createLuxonLocalizer({ timezone: 'America/New_York' });
      expect(estLocalizer.format(utcDate, 'h:mm a')).toBe('11:31 PM');

      // User in PST - should still show 11:31 PM (brand timezone)
      const pstLocalizer = createLuxonLocalizer({ timezone: 'America/New_York' });
      expect(pstLocalizer.format(utcDate, 'h:mm a')).toBe('11:31 PM');

      // User in IST - should still show 11:31 PM (brand timezone)
      const istLocalizer = createLuxonLocalizer({ timezone: 'America/New_York' });
      expect(istLocalizer.format(utcDate, 'h:mm a')).toBe('11:31 PM');
    });

    it('should handle midnight boundary correctly', () => {
      const localizer = createLuxonLocalizer({ timezone: 'America/New_York' });

      // UTC: Jan 16, 5:00 AM UTC
      // EST: Jan 16, 12:00 AM EST (midnight)
      const midnight = new Date('2025-01-16T05:00:00Z');

      expect(localizer.format(midnight, 'h:mm a')).toBe('12:00 AM');
      expect(localizer.format(midnight, 'LLL d')).toBe('Jan 16');
    });

    it('should handle noon correctly', () => {
      const localizer = createLuxonLocalizer({ timezone: 'America/New_York' });

      // UTC: Jan 16, 5:00 PM UTC
      // EST: Jan 16, 12:00 PM EST (noon)
      const noon = new Date('2025-01-16T17:00:00Z');

      expect(localizer.format(noon, 'h:mm a')).toBe('12:00 PM');
    });

    it('should handle International Date Line correctly', () => {
      const localizer = createLuxonLocalizer({ timezone: 'Pacific/Auckland' });

      // UTC: Jan 15, 12:00 PM UTC
      // NZ:  Jan 16, 1:00 AM NZDT (UTC+13)
      const date = new Date('2025-01-15T12:00:00Z');

      expect(localizer.format(date, 'h:mm a')).toBe('1:00 AM');
      expect(localizer.format(date, 'LLL d')).toBe('Jan 16');
    });
  });

  describe('Edge cases', () => {
    it('should handle invalid timezone gracefully', () => {
      const localizer = createLuxonLocalizer({ timezone: 'Invalid/Timezone' });
      expect(localizer.format(new Date('2025-01-16T04:31:00Z'), 'h:mm a')).toBe('4:31 AM');
    });

    it('should handle leap year dates', () => {
      const localizer = createLuxonLocalizer({ timezone: 'America/New_York' });

      // Feb 29, 2024 (leap year)
      const leapDay = new Date('2024-02-29T17:00:00Z');
      expect(localizer.format(leapDay, 'LLL d, yyyy')).toBe('Feb 29, 2024');
    });

    it('should handle year boundaries', () => {
      const localizer = createLuxonLocalizer({ timezone: 'America/New_York' });

      // UTC: Jan 1, 2025, 4:00 AM
      // EST: Dec 31, 2024, 11:00 PM
      const newYear = new Date('2025-01-01T04:00:00Z');

      expect(localizer.format(newYear, 'h:mm a')).toBe('11:00 PM');
      expect(localizer.format(newYear, 'LLL d, yyyy')).toBe('Dec 31, 2024');
    });
  });

  describe('Week operations', () => {
    it('should respect weekStartsOn option', () => {
      const sundayLocalizer = createLuxonLocalizer({ weekStartsOn: 0 });
      const mondayLocalizer = createLuxonLocalizer({ weekStartsOn: 1 });

      // Wednesday, Jan 15, 2025
      const wednesday = new Date('2025-01-15T12:00:00Z');

      const sundayStart = sundayLocalizer.startOfWeek(wednesday);
      const mondayStart = mondayLocalizer.startOfWeek(wednesday);

      // Sunday start: should go back to Sunday, Jan 12
      expect(sundayStart.getDate()).toBe(12);

      // Monday start: should go back to Monday, Jan 13
      expect(mondayStart.getDate()).toBe(13);
    });
  });
});
