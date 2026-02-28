import type { ReactNode } from 'react';
import { CardContent } from '@/components/ui/card';
import { AccountQueuesPanel } from './account-queues-panel';
import { QueueSchedulePanel } from './queue-schedule-panel';
import type { AccountOption, QueueToDelete } from './types';
import type { PublishingQueueSummary } from '@/lib/api/publishing-queues-client';

export interface PublishingScheduleContentProps {
  accountsLoading: boolean;
  allAccountOptions: AccountOption[];
  selectedAccountId: string;
  selectedQueueIdsByAccount: Record<string, string | null>;
  selectedAccountQueues: PublishingQueueSummary[];
  selectedAccountQueuesLoading: boolean;
  createQueueOpen: boolean;
  createQueuePending: boolean;
  newQueueName: string;
  deleteQueuePending: boolean;
  selectedQueue: PublishingQueueSummary | null;
  selectedQueueId: string | null;
  selectedAccount: AccountOption | null;
  setPostingGoalPending: boolean;
  setDefaultQueuePending: boolean;
  onSelectAccount: (accountId: string) => void;
  onSelectQueueForAccount: (accountId: string, queueId: string) => void;
  onCreateQueueOpenChange: (open: boolean) => void;
  onNewQueueNameChange: (value: string) => void;
  onCreateQueue: () => void;
  onRequestDeleteQueue: (queue: QueueToDelete) => void;
  onOpenPostingGoal: () => void;
  onSetDefaultQueue: () => void;
  onSelectedQueueIdChange: (queueId: string | null) => void;
}

export function PublishingScheduleContent({
  accountsLoading,
  allAccountOptions,
  selectedAccountId,
  selectedQueueIdsByAccount,
  selectedAccountQueues,
  selectedAccountQueuesLoading,
  createQueueOpen,
  createQueuePending,
  newQueueName,
  deleteQueuePending,
  selectedQueue,
  selectedQueueId,
  selectedAccount,
  setPostingGoalPending,
  setDefaultQueuePending,
  onSelectAccount,
  onSelectQueueForAccount,
  onCreateQueueOpenChange,
  onNewQueueNameChange,
  onCreateQueue,
  onRequestDeleteQueue,
  onOpenPostingGoal,
  onSetDefaultQueue,
  onSelectedQueueIdChange,
}: PublishingScheduleContentProps) {
  let body: ReactNode;
  if (accountsLoading) {
    body = <div className="bg-muted h-20 animate-pulse rounded" />;
  } else if (allAccountOptions.length === 0) {
    body = (
      <div className="text-muted-foreground text-sm">
        No connected accounts yet. Add one in Settings {'>'} Social Accounts first.
      </div>
    );
  } else {
    body = (
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <AccountQueuesPanel
          allAccountOptions={allAccountOptions}
          selectedAccountId={selectedAccountId}
          selectedQueueIdsByAccount={selectedQueueIdsByAccount}
          selectedAccountQueues={selectedAccountQueues}
          selectedAccountQueuesLoading={selectedAccountQueuesLoading}
          createQueueOpen={createQueueOpen}
          createQueuePending={createQueuePending}
          newQueueName={newQueueName}
          deleteQueuePending={deleteQueuePending}
          onSelectAccount={onSelectAccount}
          onSelectQueueForAccount={onSelectQueueForAccount}
          onCreateQueueOpenChange={onCreateQueueOpenChange}
          onNewQueueNameChange={onNewQueueNameChange}
          onCreateQueue={onCreateQueue}
          onRequestDeleteQueue={onRequestDeleteQueue}
        />
        <QueueSchedulePanel
          selectedQueue={selectedQueue}
          selectedQueueId={selectedQueueId}
          selectedAccount={selectedAccount}
          allAccountOptions={allAccountOptions}
          setPostingGoalPending={setPostingGoalPending}
          setDefaultQueuePending={setDefaultQueuePending}
          onOpenPostingGoal={onOpenPostingGoal}
          onSetDefaultQueue={onSetDefaultQueue}
          onSelectedQueueIdChange={onSelectedQueueIdChange}
        />
      </div>
    );
  }

  return <CardContent className="space-y-4 pt-6">{body}</CardContent>;
}
