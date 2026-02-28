import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { cn } from '@/lib/utils';
import type { Platform } from '@/lib/platform-config';
import type { PublishingQueueSummary } from '@/lib/api/publishing-queues-client';
import { accountSubtitle, accountTitle, type AccountOption, type QueueToDelete } from './types';

interface AccountQueuesPanelProps {
  allAccountOptions: AccountOption[];
  selectedAccountId: string;
  selectedQueueIdsByAccount: Record<string, string | null>;
  selectedAccountQueues: PublishingQueueSummary[];
  selectedAccountQueuesLoading: boolean;
  createQueueOpen: boolean;
  createQueuePending: boolean;
  newQueueName: string;
  deleteQueuePending: boolean;
  onSelectAccount: (accountId: string) => void;
  onSelectQueueForAccount: (accountId: string, queueId: string) => void;
  onCreateQueueOpenChange: (open: boolean) => void;
  onNewQueueNameChange: (value: string) => void;
  onCreateQueue: () => void;
  onRequestDeleteQueue: (queue: QueueToDelete) => void;
}

function CreateQueuePopover({
  createQueueOpen,
  onCreateQueueOpenChange,
  createQueuePending,
  newQueueName,
  onNewQueueNameChange,
  onCreateQueue,
}: {
  createQueueOpen: boolean;
  onCreateQueueOpenChange: (open: boolean) => void;
  createQueuePending: boolean;
  newQueueName: string;
  onNewQueueNameChange: (value: string) => void;
  onCreateQueue: () => void;
}) {
  return (
    <Popover open={createQueueOpen} onOpenChange={onCreateQueueOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5"
          disabled={createQueuePending}
        >
          <Plus className="h-3.5 w-3.5" />
          Create queue
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Create queue</div>
            <div className="text-muted-foreground text-xs">Starts with an empty schedule.</div>
          </div>
          <div className="space-y-2">
            <Label>Queue name</Label>
            <Input
              value={newQueueName}
              onChange={(event) => onNewQueueNameChange(event.target.value)}
              placeholder="e.g. Evergreen"
              autoFocus
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || createQueuePending || !newQueueName.trim()) {
                  return;
                }
                event.preventDefault();
                onCreateQueue();
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onCreateQueueOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={createQueuePending || !newQueueName.trim()}
              onClick={onCreateQueue}
            >
              Create
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function QueueRow({
  accountId,
  queue,
  queueSelected,
  deleteQueuePending,
  onSelectQueueForAccount,
  onRequestDeleteQueue,
}: {
  accountId: string;
  queue: PublishingQueueSummary;
  queueSelected: boolean;
  deleteQueuePending: boolean;
  onSelectQueueForAccount: (accountId: string, queueId: string) => void;
  onRequestDeleteQueue: (queue: QueueToDelete) => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-md border border-transparent px-1',
        queueSelected ? 'bg-accent border-primary/50 ring-primary/20 ring-1' : ''
      )}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={() => onSelectQueueForAccount(accountId, queue.id)}
        className="h-auto flex-1 justify-between rounded-md border-0 px-1 py-1.5 text-left hover:bg-transparent"
      >
        <span className="truncate text-sm">{queue.name}</span>
        {queue.isDefault ? (
          <Badge variant="secondary" className="text-[10px]">
            Default
          </Badge>
        ) : null}
      </Button>
      {queue.isDefault ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive h-7 w-7 shrink-0"
          aria-label={`Delete queue ${queue.name}`}
          title="Delete queue"
          disabled={deleteQueuePending}
          onClick={() =>
            onRequestDeleteQueue({ accountId, queueId: queue.id, queueName: queue.name })
          }
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function SelectedAccountQueuesSection({
  accountId,
  activeQueueId,
  selectedAccountQueuesLoading,
  selectedAccountQueues,
  createQueueOpen,
  onCreateQueueOpenChange,
  createQueuePending,
  newQueueName,
  onNewQueueNameChange,
  onCreateQueue,
  deleteQueuePending,
  onSelectQueueForAccount,
  onRequestDeleteQueue,
}: {
  accountId: string;
  activeQueueId: string | null;
  selectedAccountQueuesLoading: boolean;
  selectedAccountQueues: PublishingQueueSummary[];
  createQueueOpen: boolean;
  onCreateQueueOpenChange: (open: boolean) => void;
  createQueuePending: boolean;
  newQueueName: string;
  onNewQueueNameChange: (value: string) => void;
  onCreateQueue: () => void;
  deleteQueuePending: boolean;
  onSelectQueueForAccount: (accountId: string, queueId: string) => void;
  onRequestDeleteQueue: (queue: QueueToDelete) => void;
}) {
  if (selectedAccountQueuesLoading) {
    return (
      <div className="space-y-1 px-2 py-1">
        <div className="bg-muted h-7 animate-pulse rounded" />
        <div className="bg-muted h-7 animate-pulse rounded" />
      </div>
    );
  }
  return (
    <>
      {selectedAccountQueues.map((queue) => (
        <QueueRow
          key={queue.id}
          accountId={accountId}
          queue={queue}
          queueSelected={queue.id === activeQueueId}
          deleteQueuePending={deleteQueuePending}
          onSelectQueueForAccount={onSelectQueueForAccount}
          onRequestDeleteQueue={onRequestDeleteQueue}
        />
      ))}
      <CreateQueuePopover
        createQueueOpen={createQueueOpen}
        onCreateQueueOpenChange={onCreateQueueOpenChange}
        createQueuePending={createQueuePending}
        newQueueName={newQueueName}
        onNewQueueNameChange={onNewQueueNameChange}
        onCreateQueue={onCreateQueue}
      />
    </>
  );
}

function SelectedAccountQueuesBlock({
  selected,
  accountId,
  activeQueueId,
  selectedAccountQueuesLoading,
  selectedAccountQueues,
  createQueueOpen,
  onCreateQueueOpenChange,
  createQueuePending,
  newQueueName,
  onNewQueueNameChange,
  onCreateQueue,
  deleteQueuePending,
  onSelectQueueForAccount,
  onRequestDeleteQueue,
}: {
  selected: boolean;
  accountId: string;
  activeQueueId: string | null;
  selectedAccountQueuesLoading: boolean;
  selectedAccountQueues: PublishingQueueSummary[];
  createQueueOpen: boolean;
  onCreateQueueOpenChange: (open: boolean) => void;
  createQueuePending: boolean;
  newQueueName: string;
  onNewQueueNameChange: (value: string) => void;
  onCreateQueue: () => void;
  deleteQueuePending: boolean;
  onSelectQueueForAccount: (accountId: string, queueId: string) => void;
  onRequestDeleteQueue: (queue: QueueToDelete) => void;
}) {
  if (!selected) {
    return null;
  }
  return (
    <div className="border-border space-y-1 border-t p-2">
      <div className="text-muted-foreground px-2 text-[11px] font-medium tracking-wide uppercase">
        Queues
      </div>
      <SelectedAccountQueuesSection
        accountId={accountId}
        activeQueueId={activeQueueId}
        selectedAccountQueuesLoading={selectedAccountQueuesLoading}
        selectedAccountQueues={selectedAccountQueues}
        createQueueOpen={createQueueOpen}
        onCreateQueueOpenChange={onCreateQueueOpenChange}
        createQueuePending={createQueuePending}
        newQueueName={newQueueName}
        onNewQueueNameChange={onNewQueueNameChange}
        onCreateQueue={onCreateQueue}
        deleteQueuePending={deleteQueuePending}
        onSelectQueueForAccount={onSelectQueueForAccount}
        onRequestDeleteQueue={onRequestDeleteQueue}
      />
    </div>
  );
}

function AccountCard({
  account,
  selected,
  activeQueueId,
  selectedAccountQueuesLoading,
  selectedAccountQueues,
  createQueueOpen,
  onCreateQueueOpenChange,
  createQueuePending,
  newQueueName,
  onNewQueueNameChange,
  onCreateQueue,
  deleteQueuePending,
  onSelectAccount,
  onSelectQueueForAccount,
  onRequestDeleteQueue,
}: {
  account: AccountOption;
  selected: boolean;
  activeQueueId: string | null;
  selectedAccountQueuesLoading: boolean;
  selectedAccountQueues: PublishingQueueSummary[];
  createQueueOpen: boolean;
  onCreateQueueOpenChange: (open: boolean) => void;
  createQueuePending: boolean;
  newQueueName: string;
  onNewQueueNameChange: (value: string) => void;
  onCreateQueue: () => void;
  deleteQueuePending: boolean;
  onSelectAccount: (accountId: string) => void;
  onSelectQueueForAccount: (accountId: string, queueId: string) => void;
  onRequestDeleteQueue: (queue: QueueToDelete) => void;
}) {
  const title = accountTitle(account);
  const subtitle = accountSubtitle(account);
  return (
    <div className="bg-card border-border rounded-lg border">
      <Button
        type="button"
        onClick={() => onSelectAccount(account.id)}
        variant="ghost"
        className="h-auto w-full justify-start gap-3 rounded-lg p-3 text-left"
      >
        <SocialAccountAvatar
          platform={account.platform as Platform}
          name={title}
          src={account.profilePictureUrl}
          size="sm"
          selected={false}
          muted={false}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle ? (
            <div className="text-muted-foreground truncate text-xs">{subtitle}</div>
          ) : null}
        </div>
      </Button>
      <SelectedAccountQueuesBlock
        selected={selected}
        accountId={account.id}
        activeQueueId={activeQueueId}
        selectedAccountQueuesLoading={selectedAccountQueuesLoading}
        selectedAccountQueues={selectedAccountQueues}
        createQueueOpen={createQueueOpen}
        onCreateQueueOpenChange={onCreateQueueOpenChange}
        createQueuePending={createQueuePending}
        newQueueName={newQueueName}
        onNewQueueNameChange={onNewQueueNameChange}
        onCreateQueue={onCreateQueue}
        deleteQueuePending={deleteQueuePending}
        onSelectQueueForAccount={onSelectQueueForAccount}
        onRequestDeleteQueue={onRequestDeleteQueue}
      />
    </div>
  );
}

export function AccountQueuesPanel({
  allAccountOptions,
  selectedAccountId,
  selectedQueueIdsByAccount,
  selectedAccountQueues,
  selectedAccountQueuesLoading,
  createQueueOpen,
  createQueuePending,
  newQueueName,
  deleteQueuePending,
  onSelectAccount,
  onSelectQueueForAccount,
  onCreateQueueOpenChange,
  onNewQueueNameChange,
  onCreateQueue,
  onRequestDeleteQueue,
}: AccountQueuesPanelProps) {
  return (
    <div className="space-y-2">
      {allAccountOptions.map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          selected={account.id === selectedAccountId}
          activeQueueId={selectedQueueIdsByAccount[account.id] || null}
          selectedAccountQueuesLoading={selectedAccountQueuesLoading}
          selectedAccountQueues={selectedAccountQueues}
          createQueueOpen={createQueueOpen}
          onCreateQueueOpenChange={onCreateQueueOpenChange}
          createQueuePending={createQueuePending}
          newQueueName={newQueueName}
          onNewQueueNameChange={onNewQueueNameChange}
          onCreateQueue={onCreateQueue}
          deleteQueuePending={deleteQueuePending}
          onSelectAccount={onSelectAccount}
          onSelectQueueForAccount={onSelectQueueForAccount}
          onRequestDeleteQueue={onRequestDeleteQueue}
        />
      ))}
    </div>
  );
}
