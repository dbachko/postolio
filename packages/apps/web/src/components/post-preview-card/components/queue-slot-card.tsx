import type { MouseEvent } from 'react';
import { Item } from '@/components/ui/item';
import { Button } from '@/components/ui/button';
import {
  getLaneCreateLabel,
  laneIcon,
} from '@/components/calendar/QueueSchedules/queue-schedules-utils';
import { cn } from '@/lib/utils';
import type { QueueSlotMeta } from '../types';

type QueueSlotCardProps = {
  queueSlot: QueueSlotMeta;
  onCreate: () => void;
};

export function QueueSlotCard({ queueSlot, onCreate }: QueueSlotCardProps) {
  const handleCreate = () => {
    if (queueSlot.isPast) return;
    onCreate();
  };

  return (
    <Item
      variant="outline"
      size="sm"
      role="button"
      tabIndex={0}
      onClick={handleCreate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCreate();
        }
      }}
      className={cn(
        'group bg-card hover:bg-muted/50 relative h-[calc(var(--calendar-card-h)-8px)] w-full cursor-pointer justify-between shadow-sm select-none',
        'gap-2 p-2',
        queueSlot.isPast && 'opacity-70'
      )}
    >
      <div className="flex w-full items-center justify-between gap-3 transition-opacity duration-150 ease-out group-hover:pointer-events-none group-hover:opacity-0">
        <div className="text-foreground w-16 shrink-0 text-sm font-medium">
          {queueSlot.timeLabel}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <div className="bg-muted border-border text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border">
            {laneIcon(queueSlot.laneKey)}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 ease-out group-hover:pointer-events-auto group-hover:opacity-100">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={queueSlot.isPast}
          onClick={(e: MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            handleCreate();
          }}
        >
          {getLaneCreateLabel(queueSlot.laneKey)}
        </Button>
      </div>
    </Item>
  );
}
