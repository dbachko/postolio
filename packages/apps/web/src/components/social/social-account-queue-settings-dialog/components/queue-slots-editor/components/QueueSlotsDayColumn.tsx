import { useEffect, useState } from 'react';

import { Plus, Trash2 } from 'lucide-react';

import { sortSlots } from '@/components/social/queue-settings-utils';
import type {
  QueueSlotDraft,
  WeeklyCalendarLaneView,
} from '@/components/social/queue-settings-utils/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';
import { LaneTypeSelect, SlotLaneTypeDropdown } from './queue-slot-lane-controls';

type QueueSlotsDayColumnProps = {
  dayLabel: string;
  dayOfWeek: number;
  selectedQueueId: string;
  laneView: WeeklyCalendarLaneView;
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
};

function SlotTimePopover({
  slot,
  onUpdateSlot,
}: {
  slot: QueueSlotDraft;
  onUpdateSlot: (slot: QueueSlotDraft, patch: Partial<QueueSlotDraft>) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingTime, setEditingTime] = useState(slot.localTime);

  useEffect(() => {
    if (isOpen) {
      setEditingTime(slot.localTime);
    }
  }, [isOpen, slot.localTime]);

  const isTimeValid = /^\d{2}:\d{2}$/.test(editingTime);
  const hasChanges = editingTime !== slot.localTime;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" className="h-6 rounded-sm px-1.5 font-mono text-xs">
          {slot.localTime}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52">
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Time</Label>
            <Input
              type="time"
              value={editingTime}
              onChange={(event) => setEditingTime(event.target.value)}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!isTimeValid || !hasChanges}
              onClick={() => {
                onUpdateSlot(slot, { localTime: editingTime });
                setIsOpen(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function QueueSlotCard({
  laneView,
  slot,
  onUpdateSlot,
  onDeleteSlot,
}: {
  laneView: WeeklyCalendarLaneView;
  slot: QueueSlotDraft;
  onUpdateSlot: (slot: QueueSlotDraft, patch: Partial<QueueSlotDraft>) => void;
  onDeleteSlot: (slot: QueueSlotDraft) => void;
}) {
  return (
    <div className="bg-background border-border group group-hover:bg-muted/40 relative rounded-md border px-2 py-2 transition-colors">
      <div className="flex w-full items-center justify-between gap-2">
        <div className="min-w-0 pr-8">
          <div className="flex items-center gap-1.5">
            {laneView === 'all' ? (
              <SlotLaneTypeDropdown slot={slot} onUpdateSlot={onUpdateSlot} />
            ) : null}
            <SlotTimePopover slot={slot} onUpdateSlot={onUpdateSlot} />
          </div>
        </div>
      </div>

      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Delete slot"
              onClick={() => onDeleteSlot(slot)}
              className="text-muted-foreground hover:text-foreground bg-background/90 pointer-events-none absolute inset-y-0 right-3 z-20 m-auto size-6 rounded-sm opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete slot</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function AddSlotPopover({
  dayLabel,
  dayOfWeek,
  selectedQueueId,
  laneView,
  addSlotDay,
  onAddSlotDayChange,
  newSlotTime,
  onNewSlotTimeChange,
  newSlotLaneKey,
  onNewSlotLaneKeyChange,
  onAddSlot,
}: {
  dayLabel: string;
  dayOfWeek: number;
  selectedQueueId: string;
  laneView: WeeklyCalendarLaneView;
  addSlotDay: number | null;
  onAddSlotDayChange: (next: number | null) => void;
  newSlotTime: string;
  onNewSlotTimeChange: (next: string) => void;
  newSlotLaneKey: PublishingQueueLaneKey;
  onNewSlotLaneKeyChange: (next: PublishingQueueLaneKey) => void;
  onAddSlot: (dayOfWeek: number, laneKey: PublishingQueueLaneKey) => void;
}) {
  const popoverOpen = addSlotDay === dayOfWeek;
  const laneKeyForAdd = laneView === 'all' ? newSlotLaneKey : (laneView as PublishingQueueLaneKey);

  return (
    <Popover
      open={popoverOpen}
      onOpenChange={(open) => onAddSlotDayChange(open ? dayOfWeek : null)}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Add slot for ${dayLabel}`}
          disabled={!selectedQueueId}
          className="size-7"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">Add slot</div>
            <div className="text-muted-foreground text-xs">{dayLabel}</div>
          </div>

          <div className="space-y-2">
            <Label>Time</Label>
            <Input
              type="time"
              value={newSlotTime}
              onChange={(event) => onNewSlotTimeChange(event.target.value)}
            />
          </div>

          {laneView === 'all' ? (
            <div className="space-y-2">
              <Label>Type</Label>
              <LaneTypeSelect value={newSlotLaneKey} onValueChange={onNewSlotLaneKeyChange} />
            </div>
          ) : null}

          <div className="flex items-center justify-end">
            <Button type="button" onClick={() => onAddSlot(dayOfWeek, laneKeyForAdd)}>
              Add
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function QueueSlotsDayColumn({
  dayLabel,
  dayOfWeek,
  selectedQueueId,
  laneView,
  laneSlots,
  addSlotDay,
  onAddSlotDayChange,
  newSlotTime,
  onNewSlotTimeChange,
  newSlotLaneKey,
  onNewSlotLaneKeyChange,
  onAddSlot,
  onUpdateSlot,
  onDeleteSlot,
}: QueueSlotsDayColumnProps) {
  const daySlots = laneSlots.filter((slot) => slot.dayOfWeek === dayOfWeek).sort(sortSlots);

  return (
    <div className="bg-muted/20 border-border flex min-h-[160px] flex-col gap-1.5 rounded-lg border p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-foreground text-xs font-semibold tracking-wide uppercase">
          {dayLabel.slice(0, 3)}
        </div>
        <AddSlotPopover
          dayLabel={dayLabel}
          dayOfWeek={dayOfWeek}
          selectedQueueId={selectedQueueId}
          laneView={laneView}
          addSlotDay={addSlotDay}
          onAddSlotDayChange={onAddSlotDayChange}
          newSlotTime={newSlotTime}
          onNewSlotTimeChange={onNewSlotTimeChange}
          newSlotLaneKey={newSlotLaneKey}
          onNewSlotLaneKeyChange={onNewSlotLaneKeyChange}
          onAddSlot={onAddSlot}
        />
      </div>

      {daySlots.length === 0 ? (
        <div className="text-muted-foreground text-xs">No slots</div>
      ) : (
        <div className="space-y-1.5">
          {daySlots.map((slot) => (
            <QueueSlotCard
              key={`${slot.dayOfWeek}-${slot.localTime}`}
              laneView={laneView}
              slot={slot}
              onUpdateSlot={onUpdateSlot}
              onDeleteSlot={onDeleteSlot}
            />
          ))}
        </div>
      )}
    </div>
  );
}
