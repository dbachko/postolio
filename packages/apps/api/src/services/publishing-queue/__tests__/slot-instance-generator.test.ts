import { formatInTimeZone } from 'date-fns-tz';
import { describe, expect, it } from 'vitest';

import {
  generateSlotInstances,
  type PublishingQueueSlotTemplate,
} from '../slot-instance-generator.js';

describe('generateSlotInstances', () => {
  it('generates next weekly occurrences and orders chronologically', () => {
    const timezone = 'UTC';
    const startAtUtc = new Date('2025-01-06T10:00:00.000Z'); // Monday 10:00

    const slots: PublishingQueueSlotTemplate[] = [
      {
        slotId: 'slot-09',
        queueId: 'queue-1',
        laneKey: 'post',
        dayOfWeek: 1, // Monday
        localTime: '09:00',
      },
      {
        slotId: 'slot-11',
        queueId: 'queue-1',
        laneKey: 'post',
        dayOfWeek: 1, // Monday
        localTime: '11:00',
      },
    ];

    const instances = generateSlotInstances({ slots, timezone, startAtUtc, limit: 3 });

    expect(instances.map((i) => `${i.slotId}@${i.scheduledAtUtc.toISOString()}`)).toEqual([
      'slot-11@2025-01-06T11:00:00.000Z',
      'slot-09@2025-01-13T09:00:00.000Z',
      'slot-11@2025-01-13T11:00:00.000Z',
    ]);
  });

  it('skips invalid slot definitions', () => {
    const timezone = 'UTC';
    const startAtUtc = new Date('2025-01-01T00:00:00.000Z');

    const slots: PublishingQueueSlotTemplate[] = [
      // invalid time
      {
        slotId: 'bad-time',
        queueId: 'queue-1',
        laneKey: 'post',
        dayOfWeek: 1,
        localTime: '9:0',
      },
      // invalid day of week
      {
        slotId: 'bad-day',
        queueId: 'queue-1',
        laneKey: 'post',
        dayOfWeek: 9,
        localTime: '09:00',
      },
    ];

    const instances = generateSlotInstances({ slots, timezone, startAtUtc, limit: 10 });
    expect(instances).toEqual([]);
  });

  it('is DST-safe (local wall clock stays consistent)', () => {
    const timezone = 'America/New_York';
    const startAtUtc = new Date('2025-03-08T12:00:00.000Z'); // Sat, before DST start

    const slots: PublishingQueueSlotTemplate[] = [
      {
        slotId: 'sun-0900',
        queueId: 'queue-1',
        laneKey: 'post',
        dayOfWeek: 0, // Sunday
        localTime: '09:00',
      },
    ];

    const [first, second] = generateSlotInstances({ slots, timezone, startAtUtc, limit: 2 });

    expect(first?.scheduledAtUtc.toISOString()).toBe('2025-03-09T13:00:00.000Z'); // 09:00 EDT
    expect(formatInTimeZone(first!.scheduledAtUtc, timezone, 'yyyy-MM-dd HH:mm')).toBe(
      '2025-03-09 09:00'
    );
    expect(formatInTimeZone(second!.scheduledAtUtc, timezone, 'yyyy-MM-dd HH:mm')).toBe(
      '2025-03-16 09:00'
    );
  });
});
