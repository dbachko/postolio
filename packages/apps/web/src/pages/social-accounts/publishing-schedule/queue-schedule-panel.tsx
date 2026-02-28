import { Link } from 'react-router-dom';
import { Star, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SocialAccountQueueSettingsPanel } from '@/components/social/social-account-queue-settings-dialog/components/queue-settings-panel';
import type { AccountOption } from './types';
import type { PublishingQueueSummary } from '@/lib/api/publishing-queues-client';

interface QueueSchedulePanelProps {
  selectedQueue: PublishingQueueSummary | null;
  selectedQueueId: string | null;
  selectedAccount: AccountOption | null;
  allAccountOptions: AccountOption[];
  setPostingGoalPending: boolean;
  setDefaultQueuePending: boolean;
  onOpenPostingGoal: () => void;
  onSetDefaultQueue: () => void;
  onSelectedQueueIdChange: (queueId: string | null) => void;
}

export function QueueSchedulePanel({
  selectedQueue,
  selectedQueueId,
  selectedAccount,
  allAccountOptions,
  setPostingGoalPending,
  setDefaultQueuePending,
  onOpenPostingGoal,
  onSetDefaultQueue,
  onSelectedQueueIdChange,
}: QueueSchedulePanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Queue schedule</h2>
          <p className="text-muted-foreground text-sm">
            Manage weekly publishing slots for the selected queue.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings/social-accounts">Manage connections</Link>
          </Button>
          {selectedQueue ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={setPostingGoalPending}
              onClick={onOpenPostingGoal}
            >
              <Target className="h-3.5 w-3.5" />
              Plan cadence
            </Button>
          ) : null}
          {selectedQueue && !selectedQueue.isDefault ? (
            <Button
              size="sm"
              className="gap-1.5"
              disabled={setDefaultQueuePending}
              onClick={onSetDefaultQueue}
            >
              <Star className="h-3.5 w-3.5" />
              Set default
            </Button>
          ) : null}
        </div>
      </div>
      <SocialAccountQueueSettingsPanel
        account={selectedAccount}
        allAccounts={allAccountOptions}
        hideHeader
        selectedQueueId={selectedQueueId}
        onSelectedQueueIdChange={onSelectedQueueIdChange}
      />
    </div>
  );
}
