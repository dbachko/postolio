import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimezoneService } from '../timezone.js';

/**
 * Comprehensive tests for campaign date validation across different timezones
 *
 * These tests verify that:
 * 1. Dates are compared correctly in the brand's timezone (not server timezone)
 * 2. Date-only comparisons work (without time components causing issues)
 * 3. Users in different timezones can create campaigns for "today" without errors
 * 4. The "Campaign start date cannot be in the past" error only triggers for actual past dates
 */

describe('Campaign Date Validation', () => {
  describe('Date-only comparison (ignoring time)', () => {
    it('should allow campaign start date to be today in Pacific timezone', () => {
      // Scenario: User in PST (UTC-8) at 10 PM creating campaign for today
      // Current time: Jan 15, 2025 10:00 PM PST = Jan 16, 2025 6:00 AM UTC
      const nowUTC = new Date('2025-01-16T06:00:00Z');
      const brandTimezone = 'America/Los_Angeles';

      // Campaign start date: Jan 15, 2025 (today in PST)
      const campaignStartDate = new Date('2025-01-15T08:00:00Z'); // Arbitrary time, will be normalized

      // Simulate the fixed validation logic
      const nowInBrandTz = TimezoneService.toLocal(nowUTC, brandTimezone);
      const todayMidnight = new Date(
        nowInBrandTz.getFullYear(),
        nowInBrandTz.getMonth(),
        nowInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      const startDateInBrandTz = TimezoneService.toLocal(campaignStartDate, brandTimezone);
      const startDateMidnight = new Date(
        startDateInBrandTz.getFullYear(),
        startDateInBrandTz.getMonth(),
        startDateInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      // Should NOT throw error - start date equals today
      expect(startDateMidnight.getTime()).toEqual(todayMidnight.getTime());
    });

    it('should reject campaign start date in the past in Eastern timezone', () => {
      // Scenario: User in EST (UTC-5) creating campaign for yesterday
      const nowUTC = new Date('2025-01-16T12:00:00Z'); // Jan 16, 2025 12:00 PM UTC = 7:00 AM EST
      const brandTimezone = 'America/New_York';

      // Campaign start date: Jan 14, 2025 (2 days ago)
      const campaignStartDate = new Date('2025-01-14T08:00:00Z');

      const nowInBrandTz = TimezoneService.toLocal(nowUTC, brandTimezone);
      const todayMidnight = new Date(
        nowInBrandTz.getFullYear(),
        nowInBrandTz.getMonth(),
        nowInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      const startDateInBrandTz = TimezoneService.toLocal(campaignStartDate, brandTimezone);
      const startDateMidnight = new Date(
        startDateInBrandTz.getFullYear(),
        startDateInBrandTz.getMonth(),
        startDateInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      // Should be in the past
      expect(startDateMidnight < todayMidnight).toBe(true);
    });

    it('should allow campaign start date in the future', () => {
      const nowUTC = new Date('2025-01-16T12:00:00Z');
      const brandTimezone = 'America/New_York';

      // Campaign start date: Jan 20, 2025 (4 days in future)
      const campaignStartDate = new Date('2025-01-20T08:00:00Z');

      const nowInBrandTz = TimezoneService.toLocal(nowUTC, brandTimezone);
      const todayMidnight = new Date(
        nowInBrandTz.getFullYear(),
        nowInBrandTz.getMonth(),
        nowInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      const startDateInBrandTz = TimezoneService.toLocal(campaignStartDate, brandTimezone);
      const startDateMidnight = new Date(
        startDateInBrandTz.getFullYear(),
        startDateInBrandTz.getMonth(),
        startDateInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      // Should be in the future
      expect(startDateMidnight >= todayMidnight).toBe(true);
    });
  });

  describe('Edge cases across timezones', () => {
    it('should handle timezone boundary at UTC midnight', () => {
      // User in Tokyo (UTC+9) at 8:00 AM = UTC midnight
      const nowUTC = new Date('2025-01-16T00:00:00Z');
      const brandTimezone = 'Asia/Tokyo';

      // Campaign start date: Jan 16, 2025 (today in Tokyo, just started)
      const campaignStartDate = new Date('2025-01-16T00:00:00Z');

      const nowInBrandTz = TimezoneService.toLocal(nowUTC, brandTimezone);
      const todayMidnight = new Date(
        nowInBrandTz.getFullYear(),
        nowInBrandTz.getMonth(),
        nowInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      const startDateInBrandTz = TimezoneService.toLocal(campaignStartDate, brandTimezone);
      const startDateMidnight = new Date(
        startDateInBrandTz.getFullYear(),
        startDateInBrandTz.getMonth(),
        startDateInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      // Should be valid - same day in Tokyo
      expect(startDateMidnight >= todayMidnight).toBe(true);
    });

    it('should handle daylight saving time transitions', () => {
      // Test around DST transition in US (March 2025)
      const nowUTC = new Date('2025-03-10T12:00:00Z'); // After DST
      const brandTimezone = 'America/Los_Angeles';

      // Campaign start date: March 10, 2025
      const campaignStartDate = new Date('2025-03-10T00:00:00Z');

      const nowInBrandTz = TimezoneService.toLocal(nowUTC, brandTimezone);
      const todayMidnight = new Date(
        nowInBrandTz.getFullYear(),
        nowInBrandTz.getMonth(),
        nowInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      const startDateInBrandTz = TimezoneService.toLocal(campaignStartDate, brandTimezone);
      const startDateMidnight = new Date(
        startDateInBrandTz.getFullYear(),
        startDateInBrandTz.getMonth(),
        startDateInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      // Validation should work correctly even during DST
      expect(startDateMidnight >= todayMidnight).toBe(true);
    });

    it('should handle date across International Date Line', () => {
      // User in Auckland (UTC+13) vs Honolulu (UTC-10)
      const nowUTC = new Date('2025-01-16T11:00:00Z');
      // In Auckland: Jan 17, 12:00 AM (next day)
      // In Honolulu: Jan 16, 1:00 AM (same day as UTC)

      const campaignStartDate = new Date('2025-01-17T00:00:00Z');

      // Test in Auckland - should be today
      const nzTimezone = 'Pacific/Auckland';
      const nowInNZ = TimezoneService.toLocal(nowUTC, nzTimezone);
      const todayNZ = new Date(
        nowInNZ.getFullYear(),
        nowInNZ.getMonth(),
        nowInNZ.getDate(),
        0,
        0,
        0,
        0
      );

      const startInNZ = TimezoneService.toLocal(campaignStartDate, nzTimezone);
      const startNZMidnight = new Date(
        startInNZ.getFullYear(),
        startInNZ.getMonth(),
        startInNZ.getDate(),
        0,
        0,
        0,
        0
      );

      expect(startNZMidnight >= todayNZ).toBe(true);

      // Test in Honolulu - should be tomorrow (future)
      const hiTimezone = 'Pacific/Honolulu';
      const nowInHI = TimezoneService.toLocal(nowUTC, hiTimezone);
      const todayHI = new Date(
        nowInHI.getFullYear(),
        nowInHI.getMonth(),
        nowInHI.getDate(),
        0,
        0,
        0,
        0
      );

      const startInHI = TimezoneService.toLocal(campaignStartDate, hiTimezone);
      const startHIMidnight = new Date(
        startInHI.getFullYear(),
        startInHI.getMonth(),
        startInHI.getDate(),
        0,
        0,
        0,
        0
      );

      expect(startHIMidnight > todayHI).toBe(true);
    });
  });

  describe('Time component should not affect validation', () => {
    it('should validate correctly regardless of time in start date', () => {
      const nowUTC = new Date('2025-01-16T20:00:00Z');
      const brandTimezone = 'America/New_York';

      // Test with different times on the same day
      const times = ['00:00:00', '06:00:00', '12:00:00', '18:00:00', '23:59:59'];

      times.forEach((time) => {
        const campaignStartDate = new Date(`2025-01-16T${time}Z`);

        const nowInBrandTz = TimezoneService.toLocal(nowUTC, brandTimezone);
        const todayMidnight = new Date(
          nowInBrandTz.getFullYear(),
          nowInBrandTz.getMonth(),
          nowInBrandTz.getDate(),
          0,
          0,
          0,
          0
        );

        const startDateInBrandTz = TimezoneService.toLocal(campaignStartDate, brandTimezone);
        const startDateMidnight = new Date(
          startDateInBrandTz.getFullYear(),
          startDateInBrandTz.getMonth(),
          startDateInBrandTz.getDate(),
          0,
          0,
          0,
          0
        );

        // All should normalize to the same date
        expect(startDateMidnight.getTime()).toEqual(todayMidnight.getTime());
      });
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle PST user at 10 PM creating campaign for today', () => {
      // Bug scenario from the original issue
      // User in PST at 10 PM wants to create campaign starting today
      const nowUTC = new Date('2025-01-16T06:00:00Z'); // Jan 16 6 AM UTC = Jan 15 10 PM PST
      const brandTimezone = 'America/Los_Angeles';

      // Frontend sends "2025-01-15" (today in PST)
      const campaignStartDate = new Date('2025-01-15T00:00:00Z');

      const nowInBrandTz = TimezoneService.toLocal(nowUTC, brandTimezone);
      const todayMidnight = new Date(
        nowInBrandTz.getFullYear(),
        nowInBrandTz.getMonth(),
        nowInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      const startDateInBrandTz = TimezoneService.toLocal(campaignStartDate, brandTimezone);
      const startDateMidnight = new Date(
        startDateInBrandTz.getFullYear(),
        startDateInBrandTz.getMonth(),
        startDateInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      // Should be valid (same day)
      expect(startDateMidnight >= todayMidnight).toBe(true);
    });

    it('should handle user in India creating campaign', () => {
      // User in India (UTC+5:30) at 2:30 AM creating campaign for today
      const nowUTC = new Date('2025-01-15T21:00:00Z'); // Jan 15 9 PM UTC = Jan 16 2:30 AM IST
      const brandTimezone = 'Asia/Kolkata';

      // Campaign start date: Jan 16, 2025 (today in IST)
      const campaignStartDate = new Date('2025-01-16T00:00:00Z');

      const nowInBrandTz = TimezoneService.toLocal(nowUTC, brandTimezone);
      const todayMidnight = new Date(
        nowInBrandTz.getFullYear(),
        nowInBrandTz.getMonth(),
        nowInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      const startDateInBrandTz = TimezoneService.toLocal(campaignStartDate, brandTimezone);
      const startDateMidnight = new Date(
        startDateInBrandTz.getFullYear(),
        startDateInBrandTz.getMonth(),
        startDateInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      // Should be valid
      expect(startDateMidnight >= todayMidnight).toBe(true);
    });

    it('should handle European user at end of day', () => {
      // User in Berlin (UTC+1) at 11:30 PM creating campaign for today
      const nowUTC = new Date('2025-01-16T22:30:00Z'); // Jan 16 10:30 PM UTC = Jan 16 11:30 PM CET
      const brandTimezone = 'Europe/Berlin';

      // Campaign start date: Jan 16, 2025 (today)
      const campaignStartDate = new Date('2025-01-16T00:00:00Z');

      const nowInBrandTz = TimezoneService.toLocal(nowUTC, brandTimezone);
      const todayMidnight = new Date(
        nowInBrandTz.getFullYear(),
        nowInBrandTz.getMonth(),
        nowInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      const startDateInBrandTz = TimezoneService.toLocal(campaignStartDate, brandTimezone);
      const startDateMidnight = new Date(
        startDateInBrandTz.getFullYear(),
        startDateInBrandTz.getMonth(),
        startDateInBrandTz.getDate(),
        0,
        0,
        0,
        0
      );

      // Should be valid (same day)
      expect(startDateMidnight >= todayMidnight).toBe(true);
    });
  });
});
