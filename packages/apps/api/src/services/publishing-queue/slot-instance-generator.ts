import { addDays, set } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export type LaneKey = 'post' | 'reel' | 'story' | 'any';

export interface PublishingQueueSlotTemplate {
  slotId: string;
  queueId: string;
  laneKey: LaneKey;
  dayOfWeek: number; // 0=Sun..6=Sat
  localTime: string; // "HH:mm"
}

export interface PublishingQueueSlotInstance {
  slotId: string;
  queueId: string;
  laneKey: LaneKey;
  scheduledAtUtc: Date;
}

export function parseLocalTime(localTime: string): { hours: number; minutes: number } | null {
  const raw = String(localTime ?? '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = parseInt(match[1] ?? '', 10);
  const minutes = parseInt(match[2] ?? '', 10);
  if (!Number.isFinite(hours) || hours < 0 || hours > 23) {
    return null;
  }
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 59) {
    return null;
  }
  return { hours, minutes };
}

function computeNextZonedOccurrence(
  nowUtc: Date,
  timezone: string,
  dayOfWeek: number,
  time: { hours: number; minutes: number }
): Date | null {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return null;
  }

  const zonedNow = toZonedTime(nowUtc, timezone);
  let candidate = set(zonedNow, {
    hours: time.hours,
    minutes: time.minutes,
    seconds: 0,
    milliseconds: 0,
  });

  const daysUntil = (dayOfWeek - zonedNow.getDay() + 7) % 7;
  candidate = addDays(candidate, daysUntil);

  if (daysUntil === 0 && candidate.getTime() <= zonedNow.getTime()) {
    candidate = addDays(candidate, 7);
  }

  return candidate;
}

export function generateSlotInstances(params: {
  slots: PublishingQueueSlotTemplate[];
  timezone: string;
  startAtUtc: Date;
  limit: number;
}): PublishingQueueSlotInstance[] {
  const { slots, timezone, startAtUtc, limit } = params;
  const startAt = startAtUtc instanceof Date ? startAtUtc : new Date(startAtUtc);
  if (Number.isNaN(startAt.getTime())) {
    return [];
  }

  const max = Number.isFinite(limit) ? Math.max(0, Math.min(1000, Math.floor(limit))) : 0;
  if (max === 0) {
    return [];
  }

  type NextSlotEntry = {
    slot: PublishingQueueSlotTemplate;
    nextZoned: Date;
    nextUtcMs: number;
  };

  const nextBySlot = new Map<string, NextSlotEntry>();

  for (const slot of slots) {
    const time = parseLocalTime(slot.localTime);
    if (!time) {
      continue;
    }
    const nextZoned = computeNextZonedOccurrence(startAt, timezone, slot.dayOfWeek, time);
    if (!nextZoned) {
      continue;
    }
    const nextUtc = fromZonedTime(nextZoned, timezone);
    if (Number.isNaN(nextUtc.getTime())) {
      continue;
    }
    nextBySlot.set(slot.slotId, {
      slot,
      nextZoned,
      nextUtcMs: nextUtc.getTime(),
    });
  }

  const instances: PublishingQueueSlotInstance[] = [];
  while (instances.length < max && nextBySlot.size > 0) {
    let nextEntry: NextSlotEntry | null = null;

    for (const entry of nextBySlot.values()) {
      if (!nextEntry || entry.nextUtcMs < nextEntry.nextUtcMs) {
        nextEntry = entry;
      }
    }

    if (!nextEntry) {
      break;
    }

    instances.push({
      slotId: nextEntry.slot.slotId,
      queueId: nextEntry.slot.queueId,
      laneKey: nextEntry.slot.laneKey,
      scheduledAtUtc: new Date(nextEntry.nextUtcMs),
    });

    // Next weekly occurrence for the same slot template.
    const nextZoned = addDays(nextEntry.nextZoned, 7);
    const nextUtc = fromZonedTime(nextZoned, timezone);
    if (Number.isNaN(nextUtc.getTime())) {
      nextBySlot.delete(nextEntry.slot.slotId);
      continue;
    }
    nextEntry.nextZoned = nextZoned;
    nextEntry.nextUtcMs = nextUtc.getTime();
  }

  return instances;
}
