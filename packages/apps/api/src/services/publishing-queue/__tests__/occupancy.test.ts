import { describe, expect, it } from 'vitest';

import { findOccupiedTime, isTimeOccupied } from '../occupancy.js';

describe('publishing queue occupancy', () => {
  it('returns null when no occupied times exist', () => {
    expect(
      findOccupiedTime({
        candidateUtcMs: 1000,
        occupiedUtcMsSorted: [],
        windowMs: 60_000,
      })
    ).toBeNull();
  });

  it('treats an exact match as occupied', () => {
    expect(
      findOccupiedTime({
        candidateUtcMs: 2_000,
        occupiedUtcMsSorted: [1_000, 2_000, 3_000],
        windowMs: 60_000,
      })
    ).toBe(2_000);
  });

  it('picks the nearest occupied time within the window (ties pick left)', () => {
    expect(
      findOccupiedTime({
        candidateUtcMs: 2_500,
        occupiedUtcMsSorted: [1_000, 2_000, 3_000],
        windowMs: 600,
      })
    ).toBe(2_000);
  });

  it('treats the window boundary as non-conflicting (strictly less than)', () => {
    expect(
      isTimeOccupied({
        candidateUtcMs: 1_600,
        occupiedUtcMsSorted: [1_000],
        windowMs: 600,
      })
    ).toBe(false);
    expect(
      isTimeOccupied({
        candidateUtcMs: 1_599,
        occupiedUtcMsSorted: [1_000],
        windowMs: 600,
      })
    ).toBe(true);
  });
});
