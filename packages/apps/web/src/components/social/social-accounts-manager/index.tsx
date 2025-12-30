import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getPlatformConfig } from '@/lib/platform-config';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';

import { ConnectButtons } from './components/connect-buttons';
import { ConnectCandidatesDialog } from './components/connect-candidates-dialog';
import { ConnectedAccountsSection } from './components/connected-accounts-section';
import { DisconnectAccountDialog } from './components/disconnect-account-dialog';
import { useSocialAccountsManagerAccounts } from './hooks/use-social-accounts-manager-accounts';
import { useSocialAccountsManagerConnect } from './hooks/use-social-accounts-manager-connect';
import { useSocialAccountsManagerMutations } from './hooks/use-social-accounts-manager-mutations';
import type { ConnectedAccount, SocialAccountsManagerProps } from './types';

export function SocialAccountsManager({ brand, onAccountsChanged }: SocialAccountsManagerProps) {
  const queryClient = useQueryClient();
  const { openSidebar } = useRightSidebarRouter();
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectedAccount | null>(null);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);

  const {
    accountsQuery,
    connectedAccounts,
    defaultPostSocialAccountIds,
    defaultPostSocialAccountOptions,
    orderedAccounts,
    orderedConnectedIds,
    primarySocialAccountId,
    setOrderedConnectedIds,
  } = useSocialAccountsManagerAccounts({ brandId: brand.id });

  const connect = useSocialAccountsManagerConnect({
    brandId: brand.id,
    queryClient,
    onAccountsChanged,
  });

  const {
    defaultAccountsMutation,
    disconnectMutation,
    reorderAccountsMutation,
    syncPostsMutation,
  } = useSocialAccountsManagerMutations({
    brandId: brand.id,
    queryClient,
    onAccountsChanged,
    onDisconnectSuccess: () => {
      setDisconnectDialogOpen(false);
      setDisconnectTarget(null);
    },
    onSyncMutate: (accountId) => {
      setSyncingAccountId(accountId);
    },
    onSyncSettled: () => {
      setSyncingAccountId(null);
    },
  });

  const handleDisconnect = (account: ConnectedAccount) => {
    setDisconnectTarget(account);
    setDisconnectDialogOpen(true);
  };

  const instagramPlatform = getPlatformConfig('instagram');
  const facebookPlatform = getPlatformConfig('facebook');
  const connectActionLabel = connectedAccounts.length > 0 ? 'Add' : 'Connect';

  const connectButtons = (
    <ConnectButtons
      actionLabel={connectActionLabel}
      isConnecting={connect.isConnecting}
      connectingIntent={connect.connectingIntent}
      isPending={connect.startConnectMutation.isPending}
      instagramColor={instagramPlatform.color}
      facebookColor={facebookPlatform.color}
      onConnectInstagram={() => connect.startConnectMutation.mutate('instagram')}
      onConnectFacebook={() => connect.startConnectMutation.mutate('facebook')}
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Social accounts</CardTitle>
        <CardDescription>
          Connect Instagram Business/Creator accounts and Facebook Pages to {brand.name}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {accountsQuery.isLoading && <div className="bg-muted h-20 animate-pulse rounded" />}

        {!accountsQuery.isLoading && connect.connectError && (
          <Alert variant="destructive">
            <AlertDescription>{connect.connectError}</AlertDescription>
          </Alert>
        )}

        {!accountsQuery.isLoading && connectedAccounts.length === 0 && (
          <div className="space-y-3">
            <Alert>
              <AlertDescription>No social accounts connected yet.</AlertDescription>
            </Alert>
            <div className="flex justify-end">{connectButtons}</div>
          </div>
        )}

        {!accountsQuery.isLoading && connectedAccounts.length > 0 && (
          <ConnectedAccountsSection
            connectButtons={connectButtons}
            connectedCount={connectedAccounts.length}
            orderedAccounts={orderedAccounts}
            orderedConnectedIds={orderedConnectedIds}
            onReorder={(next) => {
              setOrderedConnectedIds(next);
              reorderAccountsMutation.mutate(next);
            }}
            primarySocialAccountId={primarySocialAccountId}
            isSyncPending={syncPostsMutation.isPending}
            syncingAccountId={syncingAccountId}
            onSyncAccount={(account) => syncPostsMutation.mutate(account)}
            onQueueSettings={(accountId) => openSidebar('publishing-schedule', { id: accountId })}
            onDisconnect={handleDisconnect}
            defaultPostSocialAccountOptions={defaultPostSocialAccountOptions}
            defaultPostSocialAccountIds={defaultPostSocialAccountIds}
            isSavingDefaults={defaultAccountsMutation.isPending}
            onDefaultPostSocialAccountIdsChange={(value) => defaultAccountsMutation.mutate(value)}
          />
        )}

        <ConnectCandidatesDialog
          open={connect.connectDialogOpen}
          brandName={brand.name}
          onOpenChange={(open) => {
            connect.setConnectDialogOpen(open);
            if (!open) {
              connect.setConnectSessionId(null);
              connect.setSelectedCandidateIds(new Set());
            }
          }}
          isLoading={connect.candidatesQuery.isLoading}
          isFetching={connect.candidatesQuery.isFetching}
          isWaitingForCandidates={connect.isWaitingForCandidates}
          isError={connect.candidatesQuery.isError}
          errorMessage={connect.candidatesError?.message || null}
          candidates={connect.candidates}
          groupedCandidates={connect.groupedCandidates}
          selectedCandidateIds={connect.selectedCandidateIds}
          onToggleCandidate={connect.toggleCandidate}
          onCancel={() => {
            connect.setConnectDialogOpen(false);
            connect.setConnectSessionId(null);
            connect.setSelectedCandidateIds(new Set());
          }}
          onConfirm={() => connect.finalizeConnectMutation.mutate()}
          isConfirming={connect.finalizeConnectMutation.isPending}
        />

        {/* Disconnect dialog */}
        <DisconnectAccountDialog
          open={disconnectDialogOpen}
          onOpenChange={setDisconnectDialogOpen}
          isPending={disconnectMutation.isPending}
          hasTarget={Boolean(disconnectTarget)}
          onKeepImportedPosts={() => {
            if (!disconnectTarget) return;
            disconnectMutation.mutate({
              socialAccountId: disconnectTarget.id,
              removeImportedPosts: false,
            });
          }}
          onRemoveImportedPosts={() => {
            if (!disconnectTarget) return;
            disconnectMutation.mutate({
              socialAccountId: disconnectTarget.id,
              removeImportedPosts: true,
            });
          }}
        />
      </CardContent>
    </Card>
  );
}
