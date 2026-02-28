import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { isMultiDestinationEnabled } from '@/lib/feature-flags';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { useAuthStore } from '@/stores/authStore';

import { ConnectButtons } from './components/connect-buttons';
import { ConnectedAccountsSection } from './components/connected-accounts-section';
import { SocialAccountsManagerView } from './components/social-accounts-manager-view';
import { useSocialAccountsManagerAccounts } from './hooks/use-social-accounts-manager-accounts';
import { useSocialAccountsManagerConnect } from './hooks/use-social-accounts-manager-connect';
import { useSocialAccountsManagerMutations } from './hooks/use-social-accounts-manager-mutations';
import type { ConnectedAccount, SocialAccountsManagerProps } from './types';

function clearConnectDialog(connect: {
  setConnectDialogOpen: (open: boolean) => void;
  setConnectSessionId: (id: string | null) => void;
  setSelectedCandidateIds: (value: Set<string>) => void;
}) {
  connect.setConnectDialogOpen(false);
  connect.setConnectSessionId(null);
  connect.setSelectedCandidateIds(new Set());
}

function buildConnectButtons(args: {
  canConnectInstagram: boolean;
  canConnectFacebook: boolean;
  connectedInstagramCount: number;
  multiDestinationEnabled: boolean;
  connectedAccountsCount: number;
  isConnecting: boolean;
  connectingIntent: 'instagram' | 'facebook' | null;
  isPending: boolean;
  onConnectInstagram: () => void;
  onConnectFacebook: () => void;
}): ReactNode {
  if (!args.canConnectInstagram && !args.canConnectFacebook) {
    return null;
  }

  const actionLabel =
    args.connectedInstagramCount > 0 ||
    (args.multiDestinationEnabled && args.connectedAccountsCount > 0)
      ? 'Add'
      : 'Connect';

  return (
    <ConnectButtons
      actionLabel={actionLabel}
      isConnecting={args.isConnecting}
      connectingIntent={args.connectingIntent}
      isPending={args.isPending}
      instagramColor="#E1306C"
      facebookColor="#1877F2"
      showInstagram={args.canConnectInstagram}
      showFacebook={args.canConnectFacebook}
      onConnectInstagram={args.onConnectInstagram}
      onConnectFacebook={args.onConnectFacebook}
    />
  );
}

function buildConnectedSection(args: {
  connectButtons: ReactNode;
  connectedCount: number;
  multiDestinationEnabled: boolean;
  orderedAccounts: ReturnType<typeof useSocialAccountsManagerAccounts>['orderedAccounts'];
  orderedConnectedIds: ReturnType<typeof useSocialAccountsManagerAccounts>['orderedConnectedIds'];
  setOrderedConnectedIds: (ids: string[]) => void;
  reorder: (ids: string[]) => void;
  primarySocialAccountId: string | null;
  isSyncPending: boolean;
  syncingAccountId: string | null;
  onSyncAccount: (account: ConnectedAccount) => void;
  onQueueSettings: (accountId: string) => void;
  onDisconnect: (account: ConnectedAccount) => void;
  defaultPostSocialAccountOptions: ReturnType<
    typeof useSocialAccountsManagerAccounts
  >['defaultPostSocialAccountOptions'];
  defaultPostSocialAccountIds: ReturnType<
    typeof useSocialAccountsManagerAccounts
  >['defaultPostSocialAccountIds'];
  isSavingDefaults: boolean;
  onDefaultPostSocialAccountIdsChange: (value: string[]) => void;
}) {
  return (
    <ConnectedAccountsSection
      connectButtons={args.connectButtons}
      connectedCount={args.connectedCount}
      multiDestinationEnabled={args.multiDestinationEnabled}
      orderedAccounts={args.orderedAccounts}
      orderedConnectedIds={args.orderedConnectedIds}
      onReorder={(next) => {
        args.setOrderedConnectedIds(next);
        args.reorder(next);
      }}
      primarySocialAccountId={args.primarySocialAccountId}
      isSyncPending={args.isSyncPending}
      syncingAccountId={args.syncingAccountId}
      onSyncAccount={args.onSyncAccount}
      onQueueSettings={args.onQueueSettings}
      onDisconnect={args.onDisconnect}
      defaultPostSocialAccountOptions={args.defaultPostSocialAccountOptions}
      defaultPostSocialAccountIds={args.defaultPostSocialAccountIds}
      isSavingDefaults={args.isSavingDefaults}
      onDefaultPostSocialAccountIdsChange={args.onDefaultPostSocialAccountIdsChange}
    />
  );
}

function buildManagerViewProps(args: {
  brand: SocialAccountsManagerProps['brand'];
  multiDestinationEnabled: boolean;
  accounts: ReturnType<typeof useSocialAccountsManagerAccounts>;
  connect: ReturnType<typeof useSocialAccountsManagerConnect>;
  connectButtons: ReactNode;
  connectedSection: ReactNode;
  disconnectDialogOpen: boolean;
  setDisconnectDialogOpen: (open: boolean) => void;
  disconnectTarget: ConnectedAccount | null;
  mutations: ReturnType<typeof useSocialAccountsManagerMutations>;
}) {
  return {
    brand: args.brand,
    multiDestinationEnabled: args.multiDestinationEnabled,
    accountsLoading: args.accounts.accountsQuery.isLoading,
    connectedAccounts: args.accounts.connectedAccounts,
    connectError: args.connect.connectError,
    connectButtons: args.connectButtons,
    connectedSection: args.connectedSection,
    connectDialogOpen: args.connect.connectDialogOpen,
    candidatesLoading: args.connect.candidatesQuery.isLoading,
    candidatesFetching: args.connect.candidatesQuery.isFetching,
    waitingForCandidates: args.connect.isWaitingForCandidates,
    candidatesErrorMessage: args.connect.candidatesError?.message || null,
    candidates: args.connect.candidates as any,
    groupedCandidates: args.connect.groupedCandidates as any,
    selectedCandidateIds: args.connect.selectedCandidateIds,
    isConfirmingCandidates: args.connect.finalizeConnectMutation.isPending,
    onConnectDialogOpenChange: (open: boolean) => {
      if (open) {
        args.connect.setConnectDialogOpen(true);
        return;
      }
      clearConnectDialog(args.connect);
    },
    onToggleCandidate: args.connect.toggleCandidate,
    onCancelConnect: () => clearConnectDialog(args.connect),
    onConfirmConnect: () => args.connect.finalizeConnectMutation.mutate(),
    disconnectDialogOpen: args.disconnectDialogOpen,
    disconnectPending: args.mutations.disconnectMutation.isPending,
    hasDisconnectTarget: Boolean(args.disconnectTarget),
    onDisconnectDialogOpenChange: args.setDisconnectDialogOpen,
    onKeepImportedPosts: () => {
      if (args.disconnectTarget) {
        args.mutations.disconnectMutation.mutate({
          socialAccountId: args.disconnectTarget.id,
          removeImportedPosts: false,
        });
      }
    },
    onRemoveImportedPosts: () => {
      if (args.disconnectTarget) {
        args.mutations.disconnectMutation.mutate({
          socialAccountId: args.disconnectTarget.id,
          removeImportedPosts: true,
        });
      }
    },
  };
}

export function SocialAccountsManager({ brand, onAccountsChanged }: SocialAccountsManagerProps) {
  const queryClient = useQueryClient();
  const { openSidebar } = useRightSidebarRouter();
  const user = useAuthStore((state) => state.user);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectedAccount | null>(null);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);

  const accounts = useSocialAccountsManagerAccounts({ brandId: brand.id });
  const multiDestinationEnabled = isMultiDestinationEnabled(user);
  const connectedInstagramCount = accounts.connectedAccounts.filter(
    (a) => a.platform === 'instagram'
  ).length;
  const canConnectInstagram = multiDestinationEnabled || connectedInstagramCount === 0;
  const canConnectFacebook = multiDestinationEnabled;

  const connect = useSocialAccountsManagerConnect({
    brandId: brand.id,
    multiDestinationEnabled,
    queryClient,
    onAccountsChanged,
  });

  const mutations = useSocialAccountsManagerMutations({
    brandId: brand.id,
    queryClient,
    onAccountsChanged,
    onDisconnectSuccess: () => {
      setDisconnectDialogOpen(false);
      setDisconnectTarget(null);
    },
    onSyncMutate: (accountId) => setSyncingAccountId(accountId),
    onSyncSettled: () => setSyncingAccountId(null),
  });

  const connectButtons = buildConnectButtons({
    canConnectInstagram,
    canConnectFacebook,
    connectedInstagramCount,
    multiDestinationEnabled,
    connectedAccountsCount: accounts.connectedAccounts.length,
    isConnecting: connect.isConnecting,
    connectingIntent: connect.connectingIntent,
    isPending: connect.startConnectMutation.isPending,
    onConnectInstagram: () => connect.startConnectMutation.mutate('instagram'),
    onConnectFacebook: () => connect.startConnectMutation.mutate('facebook'),
  });

  const connectedSection = buildConnectedSection({
    connectButtons,
    connectedCount: accounts.connectedAccounts.length,
    multiDestinationEnabled,
    orderedAccounts: accounts.orderedAccounts,
    orderedConnectedIds: accounts.orderedConnectedIds,
    setOrderedConnectedIds: accounts.setOrderedConnectedIds,
    reorder: (next) => mutations.reorderAccountsMutation.mutate(next),
    primarySocialAccountId: accounts.primarySocialAccountId,
    isSyncPending: mutations.syncPostsMutation.isPending,
    syncingAccountId,
    onSyncAccount: (account) => mutations.syncPostsMutation.mutate(account),
    onQueueSettings: (accountId) => openSidebar('publishing-schedule', { id: accountId }),
    onDisconnect: (account) => {
      setDisconnectTarget(account);
      setDisconnectDialogOpen(true);
    },
    defaultPostSocialAccountOptions: accounts.defaultPostSocialAccountOptions,
    defaultPostSocialAccountIds: accounts.defaultPostSocialAccountIds,
    isSavingDefaults: mutations.defaultAccountsMutation.isPending,
    onDefaultPostSocialAccountIdsChange: (value) => mutations.defaultAccountsMutation.mutate(value),
  });

  const viewProps = buildManagerViewProps({
    brand,
    multiDestinationEnabled,
    accounts,
    connect,
    connectButtons,
    connectedSection,
    disconnectDialogOpen,
    setDisconnectDialogOpen,
    disconnectTarget,
    mutations,
  });

  return <SocialAccountsManagerView {...viewProps} />;
}
