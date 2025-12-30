import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';

export type QueueSlotDraft = {
  dayOfWeek: number;
  localTime: string;
  laneKey: PublishingQueueLaneKey;
  enabled: boolean;
};

export type PublishingQueueContentLaneKey = Exclude<PublishingQueueLaneKey, 'any'>;
export type WeeklyCalendarLaneView = 'all' | PublishingQueueContentLaneKey;
