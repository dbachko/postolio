import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';

export type QueueSlotDraft = {
  dayOfWeek: number;
  localTime: string;
  laneKey: PublishingQueueLaneKey;
};

export type PublishingQueueContentLaneKey = Exclude<PublishingQueueLaneKey, 'any'>;
export type WeeklyCalendarLaneView = 'all' | PublishingQueueContentLaneKey;
