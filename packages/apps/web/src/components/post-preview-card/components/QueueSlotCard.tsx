import type { MouseEvent } from 'react';
import { Item } from '@/components/ui/item';
import { Button } from '@/components/ui/button';
import {
  getLaneCreateLabel,
  laneIcon,
} from '@/components/calendar/QueueSchedules/queue-schedules-utils';
import type { QueueSlotMeta } from '../types';
import { cn } from '@/lib/utils';

interface QueueSlotCardProps {
  meta: QueueSlotMeta;
  onOpen: () => void;
}

/**
 * Renders a queue slot placeholder card.
 * Shows time and lane icon, with a "Create" button on hover.
 */
export function QueueSlotCard({ meta, onOpen }: QueueSlotCardProps) {
  const handleCreate = () => {
    if (meta.isPast) return;
    onOpen();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCreate();
    }
  };

  const handleButtonClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    handleCreate();
  };

  return (
    <Item
      variant="outline"
      size="sm"
      role="button"
      tabIndex={0}
      onClick={handleCreate}
      onKeyDown={handleKeyDown}
      className={cn(
        'group bg-card hover:bg-muted/50 relative h-[calc(var(--calendar-card-h)-8px)] w-full cursor-pointer justify-between shadow-sm select-none',
        'gap-2 p-2',
        meta.isPast && 'opacity-70'
      )}
    >
      {/* Default content (hidden on hover) */}
      <div className="flex w-full items-center justify-between gap-3 transition-opacity duration-150 ease-out group-hover:pointer-events-none group-hover:opacity-0">
        <div className="text-foreground w-16 shrink-0 text-sm font-medium">{meta.timeLabel}</div>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <div className="bg-muted border-border text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border">
            {laneIcon(meta.laneKey)}
          </div>
        </div>
      </div>

      {/* Hover state: center Create button */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 ease-out group-hover:pointer-events-auto group-hover:opacity-100">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={meta.isPast}
          onClick={handleButtonClick}
        >
          {getLaneCreateLabel(meta.laneKey)}
        </Button>
      </div>
    </Item>
  );
}
