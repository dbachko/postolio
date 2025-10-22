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

  it('generates a single placeholder per day using primary postingTime, even if postingTimes array is provided', async () => {
    vi.setSystemTime(new Date('2025-01-15T08:00:00Z'));

    const campaigns: Campaign[] = [
      {
        id: 'c2',
        name: 'Multi-times',
        brandId: 'b1',
        config: {
          frequency: 'daily',
          duration: { start: '2025-01-14', end: '2025-01-16' },
          postingTime: '12:00',
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

    // With one placeholder per day using postingTime and a same-day post at 12:15,
    // there should be NO placeholder for 2025-01-15
    const daySlots = placeholders.filter((p) => p.scheduledAt.startsWith('2025-01-15'));
    expect(daySlots.length).toBe(0);
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

  it('does NOT block placeholders on days with content from OTHER campaigns (no cross-campaign blocking)', async () => {
    vi.setSystemTime(new Date('2025-01-15T08:00:00Z'));

    // Two different campaigns for the same brand
    const campaigns: Campaign[] = [
      {
        id: 'campaign-a',
        name: 'Campaign A',
        brandId: 'b1',
        config: {
          frequency: 'daily',
          duration: { start: '2025-01-15', end: '2025-01-20' },
          postingTime: '15:00', // 3 PM
        },
      } as unknown as Campaign,
    ];

    // Content exists from a DIFFERENT campaign (e.g., default campaign from Instagram sync)
    const existingContent: Content[] = [
      {
        id: 'synced-post',
        brandId: 'b1',
        campaignId: 'default-campaign', // Different campaign!
        status: 'published',
        postedAt: new Date('2025-01-16T09:00:00Z'), // Posted at 9 AM
        scheduledAt: null,
      } as unknown as Content,
    ];

    const placeholders = await computePlaceholders(
      campaigns,
      existingContent,
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-31T23:59:59Z')
    );

    // Placeholders should still be created for Jan 16 despite other-campaign content
    const hasJan16 = placeholders.some((p) => p.scheduledAt.startsWith('2025-01-16'));
    expect(hasJan16).toBe(true);
  });

  it('generates a single placeholder per day for multi-slot campaigns as well', async () => {
    vi.setSystemTime(new Date('2025-01-15T08:00:00Z'));

    // Multi-slot campaign
    const campaigns: Campaign[] = [
      {
        id: 'campaign-multi',
        name: 'Multi-slot Campaign',
        brandId: 'b1',
        config: {
          frequency: 'daily',
          duration: { start: '2025-01-15', end: '2025-01-20' },
          postingTimes: ['12:00', '15:00', '20:00'],
        },
      } as unknown as Campaign,
    ];

    // Content from different campaign at 9 AM
    const existingContent: Content[] = [
      {
        id: 'synced-post',
        brandId: 'b1',
        campaignId: 'default-campaign',
        status: 'published',
        postedAt: new Date('2025-01-16T09:00:00Z'),
        scheduledAt: null,
      } as unknown as Content,
    ];

    const placeholders = await computePlaceholders(
      campaigns,
      existingContent,
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-31T23:59:59Z')
    );

    // Only one placeholder per day using default/primary postingTime
    const jan16Slots = placeholders.filter((p) => p.scheduledAt.startsWith('2025-01-16'));
    expect(jan16Slots.length).toBe(1);
  });
});
