import type { CalendarItem } from '@/types/calendar';
import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';
import type { SocialAccountsById } from '@/types/social-accounts';

export type PrimaryAsset = {
  fileType: 'image' | 'video';
  thumbnailUrl?: string | null;
  url?: string | null;
};

export type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped' | 'placeholder';

export type GroupMeta = {
  contentGroupId: string;
  destinationCount: number;
};

export type DeleteTarget =
  | { kind: 'content'; contentId: string }
  | { kind: 'group'; contentGroupId: string; destinationCount: number };

export type ScheduleTarget =
  | { kind: 'content'; contentId: string }
  | { kind: 'group'; contentGroupId: string; destinationCount: number };

export type QueueSlotMeta = {
  scheduledAt: string | null;
  laneKey: PublishingQueueLaneKey;
  timeLabel: string;
  isPast: boolean;
};

export type PostPreviewCardProps = {
  item: CalendarItem;
  timezone: string;
  onReschedule?: (item: CalendarItem) => void;
  primaryAsset?: PrimaryAsset | null;
  socialAccountsById?: SocialAccountsById;
  hideDestinations?: boolean;
};
