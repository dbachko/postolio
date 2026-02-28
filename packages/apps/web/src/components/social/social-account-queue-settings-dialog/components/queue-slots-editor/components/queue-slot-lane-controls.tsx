import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { laneIcon } from '@/components/social/queue-settings-utils';
import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';
import type { QueueSlotDraft } from '@/components/social/queue-settings-utils/types';

const LANE_OPTIONS: Array<{ key: PublishingQueueLaneKey; label: string }> = [
  { key: 'any', label: 'Any post' },
  { key: 'post', label: 'Posts' },
  { key: 'reel', label: 'Reels' },
  { key: 'story', label: 'Stories' },
];

export function LaneTypeSelect({
  value,
  onValueChange,
}: {
  value: PublishingQueueLaneKey;
  onValueChange: (value: PublishingQueueLaneKey) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as PublishingQueueLaneKey)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LANE_OPTIONS.map((lane) => (
          <SelectItem key={lane.key} value={lane.key}>
            <span className="flex items-center gap-2">
              {laneIcon(lane.key, 'h-4 w-4')}
              {lane.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SlotLaneTypeDropdown({
  slot,
  onUpdateSlot,
}: {
  slot: QueueSlotDraft;
  onUpdateSlot: (slot: QueueSlotDraft, patch: Partial<QueueSlotDraft>) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Change slot type"
          className="text-muted-foreground hover:text-foreground size-6 rounded-sm"
        >
          {laneIcon(slot.laneKey, 'h-3 w-3')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LANE_OPTIONS.map((lane) => (
          <DropdownMenuItem
            key={lane.key}
            onSelect={() => onUpdateSlot(slot, { laneKey: lane.key })}
          >
            {laneIcon(lane.key)}
            {lane.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
