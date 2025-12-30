import type { AssetType } from '@/features/assets/api/client';
import type { Content } from '@/lib/api';
import type {
  PublishingQueueItem,
  PublishingQueueLaneKey,
  PublishingQueueSlotInstance,
} from '@/lib/api/publishing-queues-client';

export type QueueScheduleLaneProps = {
  brandId: string;
  laneView: 'all' | Exclude<PublishingQueueLaneKey, 'any'>;
  instances: PublishingQueueSlotInstance[];
  itemsByEstimatedMs: Map<number, PublishingQueueItem>;
  calendarContentById: Map<string, Content>;
  assetsById?: Record<string, AssetType | null>;
  brandTimezone: string;
  nowUtcMs: number;
  scheduleAheadAtCapacity: boolean;
  scheduleAheadLimits?: { tier: string; maxAllowed: number; currentCount: number };
  onCreate: (slotIso: string, slotLaneKey: PublishingQueueLaneKey) => void;
  onOpen: (contentId: string) => void;
  unassigned: PublishingQueueItem[];
  isLoading: boolean;
};

export type QueueDragPayload = {
  kind: 'content' | 'queueItem';
  contentId: string;
  laneKey: PublishingQueueLaneKey;
  sourceQueueItem?: { queueId: string; queueItemId: string } | null;
};

export type SlotRowProps = {
  inst: PublishingQueueSlotInstance;
  laneView: QueueScheduleLaneProps['laneView'];
  isPast: boolean;
  timeLabel: string;
  showContentId: string | null;
  title: string | null;
  previewUrl: string | null;
  occupiedContent: Content | null;
  estimatedItem: PublishingQueueItem | null;
  onCreate: QueueScheduleLaneProps['onCreate'];
  onOpen: QueueScheduleLaneProps['onOpen'];
  onDropToSlot: (params: {
    contentId: string;
    scheduledAt: string;
    sourceQueueItem?: { queueId: string; queueItemId: string } | null;
  }) => Promise<void>;
  scheduleAheadAtCapacity: boolean;
  scheduleLimitMessage: string;
};

export type BacklogRowProps = {
  item: PublishingQueueItem;
  laneView: QueueScheduleLaneProps['laneView'];
  assetsById?: Record<string, AssetType | null>;
  calendarContentById: Map<string, Content>;
  onOpen: QueueScheduleLaneProps['onOpen'];
  scheduleAheadAtCapacity: boolean;
  scheduleLimitMessage: string;
};
