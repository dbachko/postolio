import { describe, it, expect } from 'vitest';

import {
  calculateDurationDays,
  calculateEstimatedPosts,
  getPostsPerWeek,
  isValidCampaignFrequency,
} from './campaign-frequency.js';

describe('campaign-frequency (helpers)', () => {
  describe('isValidCampaignFrequency', () => {
    it('accepts known campaign frequencies', () => {
      expect(isValidCampaignFrequency('daily')).toBe(true);
      expect(isValidCampaignFrequency('every2days')).toBe(true);
      expect(isValidCampaignFrequency('3weekly')).toBe(true);
    });

    it('rejects unknown campaign frequencies', () => {
      expect(isValidCampaignFrequency('weekly')).toBe(false);
      expect(isValidCampaignFrequency('')).toBe(false);
    });
  });

  describe('getPostsPerWeek', () => {
    it('maps campaign frequency to posts per week', () => {
      expect(getPostsPerWeek('daily')).toBe(7);
      expect(getPostsPerWeek('every2days')).toBe(3.5);
      expect(getPostsPerWeek('3weekly')).toBe(3);
    });

    it('defaults to weekly cadence for unknown frequencies', () => {
      expect(getPostsPerWeek('weekly')).toBe(1);
    });
  });

  describe('calculateEstimatedPosts', () => {
    it('rounds up to cover partial weeks', () => {
      expect(calculateEstimatedPosts(7, 'daily')).toBe(7);
      expect(calculateEstimatedPosts(1, 'daily')).toBe(1);
      expect(calculateEstimatedPosts(7, 'every2days')).toBe(4);
    });
  });

  describe('calculateDurationDays', () => {
    it('calculates inclusive campaign duration in days', () => {
      const startDate = new Date('2025-01-01T00:00:00Z');
      const endDate = new Date('2025-01-02T00:00:00Z');
      expect(calculateDurationDays(startDate, endDate)).toBe(1);
    });

    it('rounds up when end time is not aligned', () => {
      const startDate = new Date('2025-01-01T00:00:00Z');
      const endDate = new Date('2025-01-02T23:59:59Z');
      expect(calculateDurationDays(startDate, endDate)).toBe(2);
    });
  });
});
