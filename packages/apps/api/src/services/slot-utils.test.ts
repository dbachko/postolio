import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

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

  it('keeps every2days cadence anchored to campaign start', async () => {
    vi.setSystemTime(new Date('2025-01-05T08:00:00Z'));
    const slots = await computeUpcomingSlots(
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-20T23:59:59Z'),
      '12:00',
      [],
      'every2days',
      'UTC',
      5
    );
    const slotDates = slots.map((s) => s.toISOString().substring(0, 10));
    expect(slotDates).toEqual([
      '2025-01-05',
      '2025-01-07',
      '2025-01-09',
      '2025-01-11',
      '2025-01-13',
    ]);
  });

  it('keeps first slot on the same local day when posting time is later today', async () => {
    vi.setSystemTime(new Date('2025-01-10T18:40:00Z')); // 10:40 AM PT
    const slots = await computeUpcomingSlots(
      new Date('2025-01-10T00:00:00Z'),
      new Date('2025-01-20T23:59:59Z'),
      '14:00',
      [],
      'every2days',
      'America/Los_Angeles',
      3
    );
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]!.toISOString().startsWith('2025-01-10')).toBe(true);
  });
});
