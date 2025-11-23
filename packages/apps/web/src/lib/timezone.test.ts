import { describe, it, expect } from 'vitest';
import { toUTCFromInput } from './timezone';

describe('toUTCFromInput', () => {
  it('converts datetime-local string in a provided timezone to UTC', () => {
    const result = toUTCFromInput('2025-01-15T09:00', 'America/Los_Angeles');
    expect(result.toISOString()).toBe('2025-01-15T17:00:00.000Z');
  });

  it('honors explicit offsets without reinterpreting via timezone', () => {
    const result = toUTCFromInput('2025-01-15T09:00-05:00', 'Asia/Tokyo');
    expect(result.toISOString()).toBe('2025-01-15T14:00:00.000Z');
  });

  it('passes through ISO strings with Z unchanged', () => {
    const result = toUTCFromInput('2025-01-15T09:00:00Z', 'America/New_York');
    expect(result.toISOString()).toBe('2025-01-15T09:00:00.000Z');
  });
});
