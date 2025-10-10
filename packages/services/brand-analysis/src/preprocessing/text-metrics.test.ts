import { describe, it, expect } from 'vitest';
import { computeTextMetrics } from './text-metrics';

describe('computeTextMetrics', () => {
  it('computes basic metrics', () => {
    const res = computeTextMetrics(['Hello world. This is a test!']);
    expect(res.avgSentenceLength).toBeGreaterThan(0);
    expect(res.typeTokenRatio).toBeGreaterThan(0);
  });
});
