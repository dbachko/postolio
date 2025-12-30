import { Button } from '@/components/ui/button';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { DropdownMenuContent } from '@/components/ui/dropdown-menu';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Plus, X } from 'lucide-react';

import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';
import { laneIcon, sortSlots } from '@/components/social/queue-settings-utils';
import type {
  QueueSlotDraft,
  WeeklyCalendarLaneView,
} from '@/components/social/queue-settings-utils/types';

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
  newSlotEnabled: boolean;
  onNewSlotEnabledChange: (next: boolean) => void;
  newSlotLaneKey: PublishingQueueLaneKey;
  onNewSlotLaneKeyChange: (next: PublishingQueueLaneKey) => void;
  onAddSlot: (dayOfWeek: number, laneKey: PublishingQueueLaneKey) => void;
  onUpdateSlot: (slot: QueueSlotDraft, patch: Partial<QueueSlotDraft>) => void;
  onDeleteSlot: (slot: QueueSlotDraft) => void;
};

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
  newSlotEnabled,
  onNewSlotEnabledChange,
  newSlotLaneKey,
  onNewSlotLaneKeyChange,
  onAddSlot,
  onUpdateSlot,
  onDeleteSlot,
}: QueueSlotsDayColumnProps) {
  const daySlots = laneSlots.filter((s) => s.dayOfWeek === dayOfWeek).sort(sortSlots);
  const popoverOpen = addSlotDay === dayOfWeek;
  const dayLabelShort = dayLabel.slice(0, 3);
  const laneKeyForAdd = laneView === 'all' ? newSlotLaneKey : (laneView as PublishingQueueLaneKey);

  return (
    <div className="bg-muted/20 border-border flex min-h-[160px] flex-col gap-1.5 rounded-lg border p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-foreground text-xs font-semibold tracking-wide uppercase">
          {dayLabelShort}
        </div>
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
                  onChange={(e) => onNewSlotTimeChange(e.target.value)}
                />
              </div>

              {laneView === 'all' ? (
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={newSlotLaneKey}
                    onValueChange={(v) => onNewSlotLaneKeyChange(v as PublishingQueueLaneKey)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">
                        <span className="flex items-center gap-2">
                          {laneIcon('any', 'h-4 w-4')}
                          Any post
                        </span>
                      </SelectItem>
                      <SelectItem value="post">
                        <span className="flex items-center gap-2">
                          {laneIcon('post', 'h-4 w-4')}
                          Posts
                        </span>
                      </SelectItem>
                      <SelectItem value="reel">
                        <span className="flex items-center gap-2">
                          {laneIcon('reel', 'h-4 w-4')}
                          Reels
                        </span>
                      </SelectItem>
                      <SelectItem value="story">
                        <span className="flex items-center gap-2">
                          {laneIcon('story', 'h-4 w-4')}
                          Stories
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Switch checked={newSlotEnabled} onCheckedChange={onNewSlotEnabledChange} />
                  <div className="text-sm">Enabled</div>
                </div>
                <Button type="button" onClick={() => onAddSlot(dayOfWeek, laneKeyForAdd)}>
                  Add
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {daySlots.length === 0 ? (
        <div className="text-muted-foreground text-xs">No slots</div>
      ) : (
        <div className="space-y-1.5">
          {daySlots.map((slot) => (
            <div
              key={`${slot.dayOfWeek}-${slot.localTime}`}
              className={cn(
                'bg-background border-border group flex items-center justify-between gap-1.5 rounded-md border px-2 py-1',
                !slot.enabled && 'opacity-60'
              )}
            >
              <div className="min-w-0">
                <div className="font-mono text-xs">{slot.localTime}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Switch
                  checked={slot.enabled}
                  onCheckedChange={(checked) => onUpdateSlot(slot, { enabled: checked })}
                  className="origin-right scale-[0.7]"
                />

                {laneView === 'all' ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Change slot type"
                        className="text-muted-foreground hover:text-foreground size-6"
                      >
                        {laneIcon(slot.laneKey, 'h-3 w-3')}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onUpdateSlot(slot, { laneKey: 'any' })}>
                        {laneIcon('any')}
                        Any post
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onUpdateSlot(slot, { laneKey: 'post' })}>
                        {laneIcon('post')}
                        Posts
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onUpdateSlot(slot, { laneKey: 'reel' })}>
                        {laneIcon('reel')}
                        Reels
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onUpdateSlot(slot, { laneKey: 'story' })}>
                        {laneIcon('story')}
                        Stories
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete slot"
                  onClick={() => onDeleteSlot(slot)}
                  className="text-muted-foreground hover:text-foreground size-6 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
