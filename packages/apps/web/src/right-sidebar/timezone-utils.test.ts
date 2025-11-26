import { describe, it, expect } from 'vitest';
import { formatScheduledInput } from './timezone-utils';
import { toUTCFromInput } from '../lib/timezone';

describe('formatScheduledInput', () => {
  it('returns empty string when value is undefined', () => {
    expect(formatScheduledInput(undefined, 'America/New_York')).toBe('');
    expect(formatScheduledInput('', 'America/New_York')).toBe('');
  });

  it('formats UTC DB timestamp into brand wall time for datetime-local input', () => {
    // 2025-01-16T04:31:00Z is 11:31 PM on Jan 15 in New York (UTC-5)
    const dbUTC = '2025-01-16T04:31:00.000Z';
    const brandTimezone = 'America/New_York';

    const inputValue = formatScheduledInput(dbUTC, brandTimezone);

    // datetime-local value should be brand-local wall time
    expect(inputValue).toBe('2025-01-15T23:31');
  });

  it('defaults to UTC when no timezone is provided', () => {
    const dbUTC = '2025-01-16T04:31:00.000Z';
    const inputValue = formatScheduledInput(dbUTC);

    // Without a timezone, we preserve the UTC instant as wall time
    expect(inputValue).toBe('2025-01-16T04:31');
  });

  it('round-trips DB UTC → input (brand tz) → UTC again', () => {
    const dbUTC = '2025-01-16T04:31:00.000Z';
    const brandTimezone = 'America/New_York';

    const inputValue = formatScheduledInput(dbUTC, brandTimezone);
    const roundTrippedUTC = toUTCFromInput(inputValue, brandTimezone).toISOString();

    // Editing a scheduled time in the sidebar should not change the stored UTC instant
    expect(roundTrippedUTC).toBe(dbUTC);
  });

  it('handles forward-offset timezones crossing midnight', () => {
    // 2025-01-15T12:00:00Z is 1:00 AM on Jan 16 in Auckland (UTC+13 in January)
    const dbUTC = '2025-01-15T12:00:00.000Z';
    const tz = 'Pacific/Auckland';

    const inputValue = formatScheduledInput(dbUTC, tz);
    expect(inputValue).toBe('2025-01-16T01:00');
  });
});
