import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';
import type {
  QueueSlotDraft,
  WeeklyCalendarLaneView,
} from '@/components/social/queue-settings-utils/types';

export type QueueSlotsEditorProps = {
  selectedQueueId: string;

  laneView: WeeklyCalendarLaneView;
  onLaneViewChange: (next: WeeklyCalendarLaneView) => void;

  laneSlots: QueueSlotDraft[];
  addSlotDay: number | null;
  onAddSlotDayChange: (next: number | null) => void;

  newSlotTime: string;
  onNewSlotTimeChange: (next: string) => void;

  newSlotLaneKey: PublishingQueueLaneKey;
  onNewSlotLaneKeyChange: (next: PublishingQueueLaneKey) => void;

  onAddSlot: (dayOfWeek: number, laneKey: PublishingQueueLaneKey) => void;
  onUpdateSlot: (slot: QueueSlotDraft, patch: Partial<QueueSlotDraft>) => void;
  onDeleteSlot: (slot: QueueSlotDraft) => void;

  slotsDirty: boolean;
  saving: boolean;
  onSave: () => void;
  onClose?: (() => void) | null;
};
