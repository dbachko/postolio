import type { CalendarItem } from '@/types/calendar';
import type { AssetType } from '@/features/assets/api/client';
import type { SocialAccountsById } from '@/types/social-accounts';
import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface PostPreviewCardProps {
  item: CalendarItem;
  timezone: string;
  primaryAsset?: AssetType | null;
  socialAccountsById?: SocialAccountsById;
  hideDestinations?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutation Targets
// ─────────────────────────────────────────────────────────────────────────────

export type DeleteTarget =
  | { kind: 'content'; contentId: string }
  | { kind: 'group'; contentGroupId: string; destinationCount: number };

export type ScheduleTarget =
  | { kind: 'content'; contentId: string }
  | { kind: 'group'; contentGroupId: string; destinationCount: number };

// ─────────────────────────────────────────────────────────────────────────────
// Derived Metadata
// ─────────────────────────────────────────────────────────────────────────────

export type PostStatus = 'published' | 'scheduled' | 'draft' | 'failed' | 'skipped' | 'placeholder';

export interface PostMeta {
  id: string;
  status: PostStatus;
  displayTime: string;
  timestamp: string | null;
  campaignId: string | null;
  caption: string | null;
  hashtags: string[];
}

export interface GroupMeta {
  contentGroupId: string;
  destinationCount: number;
}

export interface QueueSlotMeta {
  scheduledAt: string | null;
  laneKey: PublishingQueueLaneKey;
  timeLabel: string;
  isPast: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Item record accessor (safe cast helper)
// ─────────────────────────────────────────────────────────────────────────────

/** Type-safe accessor for CalendarItem's dynamic properties */
export type ItemRecord = Record<string, unknown>;

export function asRecord(item: CalendarItem): ItemRecord {
  return item as unknown as ItemRecord;
}
