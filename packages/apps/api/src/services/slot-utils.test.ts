import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('./timezone.js', () => {
  const toLocal = (d: Date | string) => new Date(d);
  const toUTC = (d: Date | string) => new Date(d);
  const createDateInBrandTimezone = (dateString: string, timeString: string) =>
    new Date(`${dateString}T${timeString}:00Z`);
  return {
    TimezoneService: {
      toLocal,
      toUTC,
      createDateInBrandTimezone,
    },
  };
});

import { computeUpcomingSlots } from './slot-utils.js';

describe('computeUpcomingSlots (utils)', () => {
  beforeAll(() => vi.useFakeTimers());
  afterAll(() => vi.useRealTimers());

  it('generates multiple times per day when postingTimes are provided', async () => {
    vi.setSystemTime(new Date('2025-01-15T08:00:00Z'));
    const slots = await computeUpcomingSlots(
      new Date('2025-01-14T00:00:00Z'),
      new Date('2025-01-16T23:59:59Z'),
      '12:00',
      ['12:00', '15:00', '20:00'],
      'daily',
      'UTC',
      10
    );
    const times = slots
      .filter((s) => s.toISOString().startsWith('2025-01-15'))
      .map((s) => s.toISOString().substring(11, 16))
      .sort();
    expect(times).toEqual(['12:00', '15:00', '20:00']);
  });

  it('respects maxSlots limit', async () => {
    vi.setSystemTime(new Date('2025-01-10T08:00:00Z'));
    const slots = await computeUpcomingSlots(
      new Date('2025-01-10T00:00:00Z'),
      new Date('2025-01-20T23:59:59Z'),
      '12:00',
      ['12:00', '15:00', '20:00'],
      'daily',
      'UTC',
      4
    );
    expect(slots.length).toBe(4);
  });
});
