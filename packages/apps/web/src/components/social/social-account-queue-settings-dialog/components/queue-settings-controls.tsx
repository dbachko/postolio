import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type {
  PublishingQueueSummary,
  PublishingQueueLaneKey,
} from '@/lib/api/publishing-queues-client';

import { laneIcon } from '@/components/social/queue-settings-utils';

type QueueSettingsControlsProps = {
  selectedQueue: PublishingQueueSummary;
  queueNameDraft: string;
  onQueueNameDraftChange: (next: string) => void;
  onSaveQueueName: () => void;
  savingQueue: boolean;

  newSlotLaneKey: PublishingQueueLaneKey;
  onNewSlotLaneKeyChange: (next: PublishingQueueLaneKey) => void;
  onToggleActive: (active: boolean) => void;
};

export function QueueSettingsControls({
  selectedQueue,
  queueNameDraft,
  onQueueNameDraftChange,
  onSaveQueueName,
  savingQueue,
  newSlotLaneKey,
  onNewSlotLaneKeyChange,
  onToggleActive,
}: QueueSettingsControlsProps) {
  return (
    <div className="bg-muted/30 border-border space-y-4 rounded-lg border p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 lg:col-span-2">
          <Label>Queue name</Label>
          <div className="flex gap-2">
            <Input
              value={queueNameDraft}
              onChange={(e) => onQueueNameDraftChange(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!queueNameDraft.trim() || savingQueue}
              onClick={onSaveQueueName}
            >
              Save
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Queue status</Label>
          <div className="bg-background flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {selectedQueue.paused ? 'Paused' : 'Active'}
              </div>
              <div className="text-muted-foreground text-xs">
                {selectedQueue.paused
                  ? 'Queue items won’t be scheduled.'
                  : 'Queue items can be scheduled into upcoming slots.'}
              </div>
            </div>
            <Switch
              checked={!selectedQueue.paused}
              disabled={savingQueue}
              onCheckedChange={onToggleActive}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Default new slot type</Label>
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
                  {laneIcon('any')}
                  Any post
                </span>
              </SelectItem>
              <SelectItem value="post">
                <span className="flex items-center gap-2">
                  {laneIcon('post')}
                  Posts
                </span>
              </SelectItem>
              <SelectItem value="reel">
                <span className="flex items-center gap-2">
                  {laneIcon('reel')}
                  Reels
                </span>
              </SelectItem>
              <SelectItem value="story">
                <span className="flex items-center gap-2">
                  {laneIcon('story')}
                  Stories
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
          <div className="text-muted-foreground text-xs">
            Used when adding slots from the All tab.
          </div>
        </div>
      </div>
    </div>
  );
}
