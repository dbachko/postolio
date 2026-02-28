import { formatInTimeZone } from 'date-fns-tz';
import type { Content } from '@/lib/api';
import type {
  PublishingQueueItem,
  PublishingQueueSlotInstance,
} from '@/lib/api/publishing-queues-client';
import { buildSlotRowModel } from '../helpers';
import { SlotRow } from './slot-row';

interface QueueScheduleSlotItemProps {
  inst: PublishingQueueSlotInstance;
  laneView: 'all' | 'post' | 'reel' | 'story';
  itemsByEstimatedMs: Map<number, PublishingQueueItem>;
  calendarContentById: Map<string, Content>;
  assetsById?: Record<string, any>;
  brandTimezone: string;
  nowUtcMs: number;
  onCreate: (slotIso: string, slotLaneKey: PublishingQueueSlotInstance['laneKey']) => void;
  onOpen: (contentId: string) => void;
  onDropToSlot: (params: {
    contentId: string;
    scheduledAt: string;
    sourceQueueItem?: { queueId: string; queueItemId: string } | null;
  }) => Promise<void>;
  scheduleAheadAtCapacity: boolean;
  scheduleLimitMessage: string;
}

function QueueScheduleSlotItem(props: QueueScheduleSlotItemProps) {
  const rowModel = buildSlotRowModel({
    inst: props.inst,
    laneView: props.laneView,
    itemsByEstimatedMs: props.itemsByEstimatedMs,
    calendarContentById: props.calendarContentById,
    assetsById: props.assetsById,
    brandTimezone: props.brandTimezone,
    nowUtcMs: props.nowUtcMs,
  });
  return (
    <SlotRow
      inst={props.inst}
      laneView={props.laneView}
      isPast={rowModel.isPast}
      timeLabel={rowModel.timeLabel}
      showContentId={rowModel.showContentId}
      title={rowModel.title}
      previewUrl={rowModel.previewUrl}
      occupiedContent={rowModel.occupiedContent}
      estimatedItem={rowModel.estimatedItem}
      onCreate={props.onCreate}
      onOpen={props.onOpen}
      onDropToSlot={props.onDropToSlot}
      scheduleAheadAtCapacity={props.scheduleAheadAtCapacity}
      scheduleLimitMessage={props.scheduleLimitMessage}
    />
  );
}

interface QueueScheduleDayGroupProps extends Omit<QueueScheduleSlotItemProps, 'inst'> {
  dayKey: string;
  dayInstances: PublishingQueueSlotInstance[];
}

export function QueueScheduleDayGroup({
  dayKey,
  dayInstances,
  brandTimezone,
  ...slotProps
}: QueueScheduleDayGroupProps) {
  const first = dayInstances[0];
  const dayLabel = first
    ? formatInTimeZone(new Date(first.scheduledAt), brandTimezone, 'EEE, MMM d')
    : dayKey;
  return (
    <div className="space-y-2">
      <div className="text-muted-foreground text-xs font-medium">{dayLabel}</div>
      <div className="border-border divide-border divide-y overflow-hidden rounded-md border">
        {dayInstances.map((inst) => (
          <QueueScheduleSlotItem
            key={inst.scheduledAt}
            inst={inst}
            brandTimezone={brandTimezone}
            {...slotProps}
          />
        ))}
      </div>
    </div>
  );
}
