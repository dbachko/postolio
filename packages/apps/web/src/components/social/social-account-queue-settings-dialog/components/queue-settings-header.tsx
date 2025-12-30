import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { Button } from '@/components/ui/button';
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
import type { PublishingQueueSummary } from '@/lib/api/publishing-queues-client';
import type { Platform } from '@/lib/platform-config';

import type { SocialAccountOption } from '../types';

type QueueSettingsHeaderProps = {
  account: SocialAccountOption;
  accountTitle: string;
  queues: PublishingQueueSummary[];
  queuesLoading: boolean;
  selectedQueueId: string;
  onSelectQueueId: (queueId: string) => void;

  createQueueOpen: boolean;
  onCreateQueueOpenChange: (open: boolean) => void;
  newQueueName: string;
  onNewQueueNameChange: (next: string) => void;
  createQueueDisabled: boolean;
  creatingQueue: boolean;
  onCreateQueue: () => void;
};

export function QueueSettingsHeader({
  account,
  accountTitle,
  queues,
  queuesLoading,
  selectedQueueId,
  onSelectQueueId,
  createQueueOpen,
  onCreateQueueOpenChange,
  newQueueName,
  onNewQueueNameChange,
  createQueueDisabled,
  creatingQueue,
  onCreateQueue,
}: QueueSettingsHeaderProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Social account
          </div>
          <div className="flex items-center gap-2">
            <SocialAccountAvatar
              platform={account.platform as Platform}
              name={accountTitle}
              src={account.profilePictureUrl || null}
              size="sm"
              muted={false}
            />
            <div className="truncate text-sm font-medium">{accountTitle}</div>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          <div className="w-full sm:w-[240px]">
            <Label className="sr-only">Queue</Label>
            <Select
              value={selectedQueueId}
              onValueChange={onSelectQueueId}
              disabled={queuesLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={queuesLoading ? 'Loading…' : 'Select a queue'} />
              </SelectTrigger>
              <SelectContent>
                {queues.map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {q.name}
                    {q.isDefault ? ' (Default)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Popover open={createQueueOpen} onOpenChange={onCreateQueueOpenChange}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={createQueueDisabled || creatingQueue}
              >
                Create queue
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Create queue</div>
                  <div className="text-muted-foreground text-xs">
                    Starts with an empty publishing schedule.
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Queue name</Label>
                  <Input
                    value={newQueueName}
                    onChange={(e) => onNewQueueNameChange(e.target.value)}
                    placeholder="e.g. Evergreen"
                    autoFocus
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onCreateQueueOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={creatingQueue || !newQueueName.trim()}
                    onClick={onCreateQueue}
                  >
                    Create
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
