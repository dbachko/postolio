import { Asterisk, Film, Image as ImageIcon, Layers } from 'lucide-react';

import { getLocalSetting, setLocalSetting } from '@/lib/settings/localSettings';

import type {
  PublishingQueueLaneKey,
  PublishingQueueSlot,
} from '@/lib/api/publishing-queues-client';

export type QueueSlotDraft = {
  dayOfWeek: number;
  localTime: string;
  laneKey: PublishingQueueLaneKey;
  enabled: boolean;
};

export type PublishingQueueContentLaneKey = Exclude<PublishingQueueLaneKey, 'any'>;
export type WeeklyCalendarLaneView = 'all' | PublishingQueueContentLaneKey;

export const DAYS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export const WEEK_DAYS: Array<{ value: number; label: string }> = [...DAYS.slice(1), DAYS[0]!];

export const DEFAULT_NEW_SLOT_LANE_KEY: PublishingQueueLaneKey = 'any';

export function normalizeLaneKey(value: unknown): PublishingQueueLaneKey | null {
  if (value === 'reel' || value === 'story' || value === 'any' || value === 'post') return value;
  return null;
}

export function getDefaultNewSlotLaneKeySettingKey(socialAccountId: string): string {
  return `publishing-queue.default-new-slot-lane-key:${socialAccountId}`;
}

export function loadDefaultNewSlotLaneKey(socialAccountId: string): PublishingQueueLaneKey {
  const stored = getLocalSetting<unknown>(getDefaultNewSlotLaneKeySettingKey(socialAccountId));
  return normalizeLaneKey(stored) ?? DEFAULT_NEW_SLOT_LANE_KEY;
}

export function persistDefaultNewSlotLaneKey(
  socialAccountId: string,
  laneKey: PublishingQueueLaneKey
): void {
  setLocalSetting(getDefaultNewSlotLaneKeySettingKey(socialAccountId), laneKey);
}

export function laneLabel(laneKey: PublishingQueueLaneKey): string {
  if (laneKey === 'any') return 'Any post';
  if (laneKey === 'reel') return 'Reels';
  if (laneKey === 'story') return 'Stories';
  return 'Posts';
}

export function laneIcon(laneKey: PublishingQueueLaneKey, className = 'h-4 w-4') {
  if (laneKey === 'any') return <Asterisk className={className} />;
  if (laneKey === 'reel') return <Film className={className} />;
  if (laneKey === 'story') return <Layers className={className} />;
  return <ImageIcon className={className} />;
}

export function sortSlots(a: QueueSlotDraft, b: QueueSlotDraft): number {
  if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
  if (a.localTime !== b.localTime) return a.localTime.localeCompare(b.localTime);
  return a.laneKey.localeCompare(b.laneKey);
}

export function normalizeSlots(slots: PublishingQueueSlot[]): QueueSlotDraft[] {
  return slots
    .map((s) => ({
      dayOfWeek: s.dayOfWeek,
      localTime: s.localTime,
      laneKey: s.laneKey,
      enabled: Boolean(s.enabled),
    }))
    .sort(sortSlots);
}
