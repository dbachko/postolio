import { addDays, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { Asterisk, CircleFadingPlus, Film, Image as ImageIcon } from 'lucide-react';

import { convertLocalToUTC } from '@/lib/timezone';
import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';

export function normalizeLaneKey(value: unknown): PublishingQueueLaneKey {
  if (value === 'reel' || value === 'story' || value === 'any') {
    return value;
  }
  return 'post';
}

export function getLanePillLabel(laneKey: PublishingQueueLaneKey): string {
  if (laneKey === 'any') {
    return 'Any post';
  }
  if (laneKey === 'reel') {
    return 'Reel';
  }
  if (laneKey === 'story') {
    return 'Story';
  }
  return 'Post';
}

export function getLaneCreateLabel(laneKey: PublishingQueueLaneKey): string {
  if (laneKey === 'reel') {
    return 'Create reel';
  }
  if (laneKey === 'story') {
    return 'Create story';
  }
  if (laneKey === 'any') {
    return 'Create content';
  }
  return 'Create post';
}

export function laneIcon(laneKey: PublishingQueueLaneKey, className = 'h-3.5 w-3.5') {
  if (laneKey === 'any') {
    return <Asterisk className={className} />;
  }
  if (laneKey === 'reel') {
    return <Film className={className} />;
  }
  if (laneKey === 'story') {
    return <CircleFadingPlus className={className} />;
  }
  return <ImageIcon className={className} />;
}

export function getBrandRangeStartUtcIso(date: Date, timezone: string): string {
  const localStart = startOfDay(toZonedTime(date, timezone));
  return convertLocalToUTC(localStart, timezone).toISOString();
}

export function getBrandRangeEndUtcMs(date: Date, timezone: string, days: number): number {
  const localStart = startOfDay(toZonedTime(date, timezone));
  const localEnd = addDays(localStart, days);
  return convertLocalToUTC(localEnd, timezone).getTime();
}
