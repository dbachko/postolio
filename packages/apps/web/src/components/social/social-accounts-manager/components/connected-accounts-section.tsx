import type { ReactNode } from 'react';
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SocialAccountsPicker } from '@/components/social/social-accounts-picker';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import { SortableAccountRow } from './sortable-account-row';
import type { ConnectedAccount } from '../types';

type ConnectedAccountsSectionProps = {
  connectButtons: ReactNode;
  connectedCount: number;
  multiDestinationEnabled: boolean;
  orderedAccounts: ConnectedAccount[];
  orderedConnectedIds: string[];
  onReorder: (nextIds: string[]) => void;
  primarySocialAccountId: string | null;
  isSyncPending: boolean;
  syncingAccountId: string | null;
  onSyncAccount: (account: ConnectedAccount) => void;
  onQueueSettings: (accountId: string) => void;
  onDisconnect: (account: ConnectedAccount) => void;
  defaultPostSocialAccountOptions: SocialAccountsPickerOption[];
  defaultPostSocialAccountIds: string[];
  isSavingDefaults: boolean;
  onDefaultPostSocialAccountIdsChange: (ids: string[]) => void;
};

function moveId(list: string[], activeId: string, overId: string): string[] {
  const from = list.indexOf(activeId);
  const to = list.indexOf(overId);
  if (from === -1 || to === -1 || from === to) {
    return list;
  }
  const next = list.slice();
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed);
  return next;
}

export function ConnectedAccountsSection({
  connectButtons,
  connectedCount,
  multiDestinationEnabled,
  orderedAccounts,
  orderedConnectedIds,
  onReorder,
  primarySocialAccountId,
  isSyncPending,
  syncingAccountId,
  onSyncAccount,
  onQueueSettings,
  onDisconnect,
  defaultPostSocialAccountOptions,
  defaultPostSocialAccountIds,
  isSavingDefaults,
  onDefaultPostSocialAccountIdsChange,
}: ConnectedAccountsSectionProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-muted-foreground text-sm">
          Connected: <span className="text-foreground font-medium">{connectedCount}</span>
        </div>
        {connectButtons}
      </div>

      <div className="text-muted-foreground text-xs">
        Drag to reorder. The top account is used as the default for new posts when no defaults are
        set.
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(event) => {
          const overId = event.over?.id;
          const activeId = event.active?.id;
          if (typeof overId !== 'string' || typeof activeId !== 'string') {
            return;
          }
          if (overId === activeId) {
            return;
          }
          const next = moveId(orderedConnectedIds, activeId, overId);
          onReorder(next);
        }}
      >
        <div className="space-y-2">
          {orderedAccounts.map((account) => {
            const canSync = account.platform === 'instagram' || account.platform === 'facebook';
            const isSyncing = isSyncPending && syncingAccountId === account.id;
            return (
              <SortableAccountRow
                key={account.id}
                account={account}
                isPrimary={primarySocialAccountId === account.id}
                isSyncing={isSyncing}
                onSync={canSync ? () => onSyncAccount(account) : null}
                onQueueSettings={() => onQueueSettings(account.id)}
                onDisconnect={() => onDisconnect(account)}
              />
            );
          })}
        </div>
      </DndContext>

      <div className="space-y-2">
        {multiDestinationEnabled ? (
          <>
            <div className="text-sm font-medium">Defaults for new posts</div>
            <div className="space-y-1">
              <div className="text-muted-foreground text-xs">Destinations</div>
              <SocialAccountsPicker
                options={defaultPostSocialAccountOptions}
                value={defaultPostSocialAccountIds}
                onChange={onDefaultPostSocialAccountIdsChange}
                disabled={isSavingDefaults}
                addLabel="Add destination"
                addTooltip="Add destination"
                addButtonText="Add destination"
                addButtonTextMode="always"
                searchPlaceholder="Search accounts…"
              />
              {defaultPostSocialAccountIds.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No defaults set — new posts will auto-select the top account.
                </p>
              ) : (
                <p className="text-muted-foreground text-xs">
                  These accounts will be pre-selected when you create a new post.
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="text-sm font-medium">Defaults for new posts</div>
            <p className="text-muted-foreground text-xs">
              Single-destination mode is enabled. New posts automatically target your Instagram
              account.
            </p>
          </>
        )}
      </div>

      {multiDestinationEnabled ? (
        <Alert variant="info">
          <AlertDescription className="text-sm">
            Tip: Default accounts are optional. When none are set, new posts auto-select the top
            account.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
