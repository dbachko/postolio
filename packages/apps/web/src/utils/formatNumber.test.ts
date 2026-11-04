import { describe, expect, it } from 'vitest';
import { formatNumber } from './formatNumber';

describe('formatNumber', () => {
  it('shortens large numbers', () => {
    expect(formatNumber(1500)).toMatch(/1\.5\s?K/i);
  });
});
