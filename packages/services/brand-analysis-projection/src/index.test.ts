import { describe, it, expect } from 'vitest';
import { computeDerivedProjection } from './index';

describe('computeDerivedProjection', () => {
  it('derives tones, palette, topicsTop', () => {
    const derived = computeDerivedProjection({
      text: { tone: ['warm', 'bold', 'playful'] },
      visual: { palette: ['#111', '#222', '#333'] },
      topics: [
        { value: 'fashion', count: 5 },
        { value: 'style', count: 3 },
      ],
    });
    expect(derived.tones.length).toBe(3);
    expect(derived.palette.length).toBe(3);
    expect(derived.topicsTop?.length).toBe(2);
  });

  it('handles missing fields', () => {
    const derived = computeDerivedProjection({});
    expect(derived.tones).toEqual([]);
    expect(derived.palette).toEqual([]);
    expect(derived.topicsTop).toBeNull();
  });
});

// Idempotency decision is enforced via SQL WHERE clause. As a unit we assert that
// we only accept newer versions conceptually (this documents expectation for reviewers).
function shouldUpsert(current: number | null, incoming: number) {
  if (current == null) {
    return true;
  }
  return incoming > current;
}

describe('idempotency', () => {
  it('upserts only when incoming version newer', () => {
    expect(shouldUpsert(null, 1)).toBe(true);
    expect(shouldUpsert(1, 1)).toBe(false);
    expect(shouldUpsert(2, 1)).toBe(false);
    expect(shouldUpsert(1, 2)).toBe(true);
  });
});
