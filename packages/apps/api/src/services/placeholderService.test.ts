import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Campaign, Content } from '@postolio/database';

// Mock timezone module BEFORE importing the module under test to avoid DB initialization
vi.mock('./timezone.js', () => {
  const toLocal = (d: Date | string) => new Date(d);
  const toUTC = (d: Date | string) => new Date(d);
  const createDateInBrandTimezone = (dateString: string, timeString: string) =>
    new Date(`${dateString}T${timeString}:00Z`); // Treat inputs as UTC for tests
  return {
    TimezoneService: {
      getBrandTimezone: vi.fn(async () => 'UTC'),
      toLocal,
      toUTC,
      createDateInBrandTimezone,
    },
  };
});

import { computePlaceholders } from './placeholderService.js';

describe('computePlaceholders', () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('suppresses placeholder for a day when single daily slot and a post already exists that day', async () => {
    // Freeze time to 2025-01-15 08:00 UTC
    vi.setSystemTime(new Date('2025-01-15T08:00:00Z'));

    const campaigns: Campaign[] = [
      {
        id: 'c1',
        name: 'Daily 12pm',
        brandId: 'b1',
        config: {
          frequency: 'daily',
          duration: { start: '2025-01-10', end: '2025-01-20' },
          postingTime: '12:00',
        },
      } as unknown as Campaign,
    ];

    const existingContent: Content[] = [
      {
        id: 'x1',
        brandId: 'b1',
        campaignId: 'c1',
        status: 'published',
        postedAt: new Date('2025-01-15T09:00:00Z'),
        scheduledAt: null,
      } as unknown as Content,
    ];

    const placeholders = await computePlaceholders(
      campaigns,
      existingContent,
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-31T23:59:59Z')
    );

    // Ensure there is no placeholder on 2025-01-15
    const hasJan15 = placeholders.some((p) => p.scheduledAt.startsWith('2025-01-15'));
    expect(hasJan15).toBe(false);
  });

  it('allows multiple placeholders per day when postingTimes array provided, blocking only occupied slots', async () => {
    vi.setSystemTime(new Date('2025-01-15T08:00:00Z'));

    const campaigns: Campaign[] = [
      {
        id: 'c2',
        name: 'Multi-times',
        brandId: 'b1',
        config: {
          frequency: 'daily',
          duration: { start: '2025-01-14', end: '2025-01-16' },
          postingTimes: ['12:00', '15:00', '20:00'],
        },
      } as unknown as Campaign,
    ];

    const existingContent: Content[] = [
      {
        id: 'y1',
        brandId: 'b1',
        campaignId: 'c2',
        status: 'published',
        postedAt: new Date('2025-01-15T12:15:00Z'),
        scheduledAt: null,
      } as unknown as Content,
    ];

    const placeholders = await computePlaceholders(
      campaigns,
      existingContent,
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-31T23:59:59Z')
    );

    // Should include 2025-01-15 15:00 and 20:00 but not 12:00
    const daySlots = placeholders.filter((p) => p.scheduledAt.startsWith('2025-01-15'));
    const times = daySlots.map((p) => p.scheduledAt.substring(11, 16)).sort();
    expect(times).toEqual(['15:00', '20:00']);
  });

  it('does not create placeholders for slots already scheduled in the future', async () => {
    vi.setSystemTime(new Date('2025-01-15T08:00:00Z'));

    const campaigns: Campaign[] = [
      {
        id: 'c3',
        name: 'Single slot',
        brandId: 'b1',
        config: {
          frequency: 'daily',
          duration: { start: '2025-01-15', end: '2025-01-17' },
          postingTime: '12:00',
        },
      } as unknown as Campaign,
    ];

    const existingContent: Content[] = [
      {
        id: 'z1',
        brandId: 'b1',
        campaignId: 'c3',
        status: 'scheduled',
        postedAt: null,
        scheduledAt: new Date('2025-01-16T12:00:00Z'),
      } as unknown as Content,
    ];

    const placeholders = await computePlaceholders(
      campaigns,
      existingContent,
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-31T23:59:59Z')
    );

    // Ensure 2025-01-16 is not present
    const hasJan16 = placeholders.some((p) => p.scheduledAt.startsWith('2025-01-16'));
    expect(hasJan16).toBe(false);
  });
});
