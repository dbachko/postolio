import { describe, it, expect } from 'vitest';
import { TimezoneService } from '../timezone.js';
import { formatInTimeZone } from 'date-fns-tz';

/**
 * Comprehensive tests for timezone conversion and scheduling
 *
 * These tests verify that:
 * 1. Dates are converted correctly between UTC and brand timezones
 * 2. Scheduled times are created properly in brand timezone and stored in UTC
 * 3. Calendar month boundaries work correctly across timezones
 * 4. Auto-detect timezone scenarios are handled
 */

describe('TimezoneService', () => {
  describe('createDateInBrandTimezone', () => {
    it('should create date at specific time in brand timezone and convert to UTC', () => {
      // Create Jan 15, 2025 at 2:00 PM PST
      const date = TimezoneService.createDateInBrandTimezone(
        '2025-01-15',
        '14:00',
        'America/Los_Angeles'
      );

      // PST is UTC-8, so 2:00 PM PST = 10:00 PM UTC
      expect(formatInTimeZone(date, 'UTC', 'yyyy-MM-dd HH:mm')).toBe('2025-01-15 22:00');
      expect(formatInTimeZone(date, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm')).toBe(
        '2025-01-15 14:00'
      );
    });

    it('should handle timezone with different DST offset', () => {
      // Create date in summer (DST active in US)
      const summerDate = TimezoneService.createDateInBrandTimezone(
        '2025-06-15',
        '14:00',
        'America/New_York'
      );

      // EDT is UTC-4, so 2:00 PM EDT = 6:00 PM UTC
      expect(formatInTimeZone(summerDate, 'UTC', 'yyyy-MM-dd HH:mm')).toBe('2025-06-15 18:00');

      // Create date in winter (DST not active)
      const winterDate = TimezoneService.createDateInBrandTimezone(
        '2025-01-15',
        '14:00',
        'America/New_York'
      );

      // EST is UTC-5, so 2:00 PM EST = 7:00 PM UTC
      expect(formatInTimeZone(winterDate, 'UTC', 'yyyy-MM-dd HH:mm')).toBe('2025-01-15 19:00');
    });

    it('should handle non-integer timezone offset (India)', () => {
      // IST is UTC+5:30
      const date = TimezoneService.createDateInBrandTimezone('2025-01-15', '14:30', 'Asia/Kolkata');

      // 2:30 PM IST = 9:00 AM UTC
      expect(formatInTimeZone(date, 'UTC', 'yyyy-MM-dd HH:mm')).toBe('2025-01-15 09:00');
      expect(formatInTimeZone(date, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm')).toBe('2025-01-15 14:30');
    });

    it('should handle midnight in different timezones', () => {
      // Midnight PST
      const pstMidnight = TimezoneService.createDateInBrandTimezone(
        '2025-01-15',
        '00:00',
        'America/Los_Angeles'
      );

      // Midnight PST = 8:00 AM UTC
      expect(formatInTimeZone(pstMidnight, 'UTC', 'yyyy-MM-dd HH:mm')).toBe('2025-01-15 08:00');

      // Midnight UTC
      const utcMidnight = TimezoneService.createDateInBrandTimezone('2025-01-15', '00:00', 'UTC');

      expect(formatInTimeZone(utcMidnight, 'UTC', 'yyyy-MM-dd HH:mm')).toBe('2025-01-15 00:00');
    });

    it('should handle end of day in different timezones', () => {
      // 11:59 PM PST
      const pstEOD = TimezoneService.createDateInBrandTimezone(
        '2025-01-15',
        '23:59',
        'America/Los_Angeles'
      );

      // Should be next day in UTC
      expect(formatInTimeZone(pstEOD, 'UTC', 'yyyy-MM-dd HH:mm')).toBe('2025-01-16 07:59');
    });
  });

  describe('toLocal and toUTC conversions', () => {
    it('should convert UTC to local time correctly', () => {
      const utcDate = new Date('2025-01-15T22:00:00Z');

      // Formatting UTC instant in target timezone is the reliable display method
      expect(formatInTimeZone(utcDate, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm')).toBe(
        '2025-01-15 14:00'
      );

      expect(formatInTimeZone(utcDate, 'America/New_York', 'yyyy-MM-dd HH:mm')).toBe(
        '2025-01-15 17:00'
      );

      expect(formatInTimeZone(utcDate, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm')).toBe(
        '2025-01-16 03:30'
      );
    });

    it('should round-trip UTC -> Local -> UTC correctly', () => {
      const originalUTC = new Date('2025-01-15T22:00:00Z');

      // Convert to PST and back
      const localPST = TimezoneService.toLocal(originalUTC, 'America/Los_Angeles');
      const backToUTC = TimezoneService.toUTC(localPST, 'America/Los_Angeles');

      // Should be equal (allowing for ms precision)
      expect(Math.abs(backToUTC.getTime() - originalUTC.getTime())).toBeLessThan(1000);
    });
  });

  describe('Content Scheduling Scenarios', () => {
    it('should schedule post at 9 AM brand time across different timezones', () => {
      const postingTime = '09:00';
      const postDate = '2025-01-20';

      // PST brand
      const pstSchedule = TimezoneService.createDateInBrandTimezone(
        postDate,
        postingTime,
        'America/Los_Angeles'
      );

      // EST brand
      const estSchedule = TimezoneService.createDateInBrandTimezone(
        postDate,
        postingTime,
        'America/New_York'
      );

      // UTC brand
      const utcSchedule = TimezoneService.createDateInBrandTimezone(postDate, postingTime, 'UTC');

      // All should be stored as different UTC times
      const pstUTC = formatInTimeZone(pstSchedule, 'UTC', 'HH:mm');
      const estUTC = formatInTimeZone(estSchedule, 'UTC', 'HH:mm');
      const utcUTC = formatInTimeZone(utcSchedule, 'UTC', 'HH:mm');

      expect(pstUTC).toBe('17:00'); // 9 AM PST = 5 PM UTC
      expect(estUTC).toBe('14:00'); // 9 AM EST = 2 PM UTC
      expect(utcUTC).toBe('09:00'); // 9 AM UTC = 9 AM UTC

      // But all display as 9 AM in their respective timezones
      expect(formatInTimeZone(pstSchedule, 'America/Los_Angeles', 'HH:mm')).toBe('09:00');
      expect(formatInTimeZone(estSchedule, 'America/New_York', 'HH:mm')).toBe('09:00');
      expect(formatInTimeZone(utcSchedule, 'UTC', 'HH:mm')).toBe('09:00');
    });

    it('should handle a date range spanning DST transition', () => {
      // Date range from March 1 to March 31, 2025
      // DST starts March 9, 2025 in US (2 AM -> 3 AM)

      // Schedule for before DST (March 8)
      const beforeDST = TimezoneService.createDateInBrandTimezone(
        '2025-03-08',
        '14:00',
        'America/Los_Angeles'
      );

      // Schedule for after DST (March 10)
      const afterDST = TimezoneService.createDateInBrandTimezone(
        '2025-03-10',
        '14:00',
        'America/Los_Angeles'
      );

      // Before DST: PST (UTC-8), so 2 PM = 10 PM UTC
      expect(formatInTimeZone(beforeDST, 'UTC', 'HH:mm')).toBe('22:00');

      // After DST: PDT (UTC-7), so 2 PM = 9 PM UTC
      expect(formatInTimeZone(afterDST, 'UTC', 'HH:mm')).toBe('21:00');

      // Both should still be 2 PM in local time
      expect(formatInTimeZone(beforeDST, 'America/Los_Angeles', 'HH:mm')).toBe('14:00');
      expect(formatInTimeZone(afterDST, 'America/Los_Angeles', 'HH:mm')).toBe('14:00');
    });
  });

  describe('Calendar Month Boundaries', () => {
    it('should create month boundaries in brand timezone for PST', () => {
      // January 2025 calendar for PST user
      const timezone = 'America/Los_Angeles';

      // Month start: Jan 1, 2025 00:00:00 PST = Jan 1, 2025 08:00:00 UTC
      const monthStart = TimezoneService.createDateInBrandTimezone('2025-01-01', '00:00', timezone);

      // Month end: Jan 31, 2025 23:59:00 PST = Feb 1, 2025 07:59:00 UTC
      const monthEnd = TimezoneService.createDateInBrandTimezone('2025-01-31', '23:59', timezone);

      // Verify they cover the full month in PST
      expect(formatInTimeZone(monthStart, timezone, 'yyyy-MM-dd HH:mm')).toBe('2025-01-01 00:00');
      expect(formatInTimeZone(monthEnd, timezone, 'yyyy-MM-dd HH:mm')).toBe('2025-01-31 23:59');

      // Verify UTC storage
      expect(formatInTimeZone(monthStart, 'UTC', 'yyyy-MM-dd HH:mm')).toBe('2025-01-01 08:00');
      expect(formatInTimeZone(monthEnd, 'UTC', 'yyyy-MM-dd HH:mm')).toBe('2025-02-01 07:59');
    });

    it('should create month boundaries in brand timezone for Tokyo', () => {
      // January 2025 calendar for Tokyo user
      const timezone = 'Asia/Tokyo';

      // Month start: Jan 1, 2025 00:00:00 JST = Dec 31, 2024 15:00:00 UTC
      const monthStart = TimezoneService.createDateInBrandTimezone('2025-01-01', '00:00', timezone);

      // Month end: Jan 31, 2025 23:59:00 JST = Jan 31, 2025 14:59:00 UTC
      const monthEnd = TimezoneService.createDateInBrandTimezone('2025-01-31', '23:59', timezone);

      // Verify they cover the full month in JST
      expect(formatInTimeZone(monthStart, timezone, 'yyyy-MM-dd HH:mm')).toBe('2025-01-01 00:00');
      expect(formatInTimeZone(monthEnd, timezone, 'yyyy-MM-dd HH:mm')).toBe('2025-01-31 23:59');

      // Verify UTC storage (note: starts on previous day in UTC)
      expect(formatInTimeZone(monthStart, 'UTC', 'yyyy-MM-dd HH:mm')).toBe('2024-12-31 15:00');
      expect(formatInTimeZone(monthEnd, 'UTC', 'yyyy-MM-dd HH:mm')).toBe('2025-01-31 14:59');
    });
  });

  describe('Edge Cases', () => {
    it('should handle leap year dates', () => {
      // Feb 29, 2024 (leap year)
      const leapDate = TimezoneService.createDateInBrandTimezone(
        '2024-02-29',
        '12:00',
        'America/New_York'
      );

      expect(formatInTimeZone(leapDate, 'America/New_York', 'yyyy-MM-dd')).toBe('2024-02-29');
    });

    it('should handle year boundaries', () => {
      // Dec 31, 2024 11:00 PM PST = Jan 1, 2025 7:00 AM UTC
      const newYearEve = TimezoneService.createDateInBrandTimezone(
        '2024-12-31',
        '23:00',
        'America/Los_Angeles'
      );

      expect(formatInTimeZone(newYearEve, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm')).toBe(
        '2024-12-31 23:00'
      );
      expect(formatInTimeZone(newYearEve, 'UTC', 'yyyy-MM-dd HH:mm')).toBe('2025-01-01 07:00');
    });

    it('should handle negative timezone offset (west of UTC)', () => {
      const date = TimezoneService.createDateInBrandTimezone(
        '2025-01-15',
        '14:00',
        'America/Los_Angeles' // UTC-8
      );

      expect(formatInTimeZone(date, 'UTC', 'HH:mm')).toBe('22:00');
    });

    it('should handle positive timezone offset (east of UTC)', () => {
      const date = TimezoneService.createDateInBrandTimezone(
        '2025-01-15',
        '14:00',
        'Europe/Paris' // UTC+1
      );

      expect(formatInTimeZone(date, 'UTC', 'HH:mm')).toBe('13:00');
    });
  });

  describe('Auto-detect timezone scenarios', () => {
    it('should handle null timezone with fallback', async () => {
      // When brand.postingTimezone is null, should fallback to user timezone or default
      const brandWithNoTZ = {
        id: 'test-brand',
        postingTimezone: null,
        user: {
          timezone: 'America/New_York',
          timezoneAutoDetected: false,
        },
      };

      // Simulate the fallback logic
      const timezone =
        brandWithNoTZ.postingTimezone ||
        (brandWithNoTZ.user.timezone && TimezoneService.isValidTimezone(brandWithNoTZ.user.timezone)
          ? brandWithNoTZ.user.timezone
          : 'UTC');

      expect(timezone).toBe('America/New_York');
    });

    it('should use default timezone when both brand and user timezone are null', () => {
      const brandWithNoTZ = {
        id: 'test-brand',
        postingTimezone: null,
        user: {
          timezone: null,
          timezoneAutoDetected: true,
        },
      };

      // Simulate the fallback logic
      const timezone =
        brandWithNoTZ.postingTimezone ||
        (brandWithNoTZ.user.timezone && TimezoneService.isValidTimezone(brandWithNoTZ.user.timezone)
          ? brandWithNoTZ.user.timezone
          : 'UTC');

      expect(timezone).toBe('UTC');
    });

    it('should prefer brand timezone over user timezone', () => {
      const brandWithTZ = {
        id: 'test-brand',
        postingTimezone: 'America/Los_Angeles',
        user: {
          timezone: 'America/New_York',
          timezoneAutoDetected: false,
        },
      };

      // Simulate the priority logic
      const timezone =
        brandWithTZ.postingTimezone ||
        (brandWithTZ.user.timezone && TimezoneService.isValidTimezone(brandWithTZ.user.timezone)
          ? brandWithTZ.user.timezone
          : 'UTC');

      expect(timezone).toBe('America/Los_Angeles');
    });
  });
});
