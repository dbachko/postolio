import type { ReactNode } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { ConnectCandidatesDialog } from './connect-candidates-dialog';
import { DisconnectAccountDialog } from './disconnect-account-dialog';
import type { ConnectedAccount, SocialAccountsManagerProps } from '../types';

function AccountsContent(props: {
  isLoading: boolean;
  connectError: string | null;
  connectedAccounts: ConnectedAccount[];
  connectButtons: ReactNode;
  connectedSection: ReactNode;
}) {
  if (props.isLoading) {
    return <div className="bg-muted h-20 animate-pulse rounded" />;
  }

  return (
    <>
      {props.connectError ? (
        <Alert variant="destructive">
          <AlertDescription>{props.connectError}</AlertDescription>
        </Alert>
      ) : null}

      {props.connectedAccounts.length === 0 ? (
        <div className="space-y-3">
          <Alert>
            <AlertDescription>No social accounts connected yet.</AlertDescription>
          </Alert>
          <div className="flex justify-end">{props.connectButtons}</div>
        </div>
      ) : (
        props.connectedSection
      )}
    </>
  );
}

interface SocialAccountsManagerViewProps {
  brand: SocialAccountsManagerProps['brand'];
  multiDestinationEnabled: boolean;
  accountsLoading: boolean;
  connectedAccounts: ConnectedAccount[];
  connectError: string | null;
  connectButtons: ReactNode;
  connectedSection: ReactNode;
  connectDialogOpen: boolean;
  candidatesLoading: boolean;
  candidatesFetching: boolean;
  waitingForCandidates: boolean;
  candidatesErrorMessage: string | null;
  candidates: ConnectedAccount[];
  groupedCandidates: {
    instagram: Array<{ candidateId: string; platform: 'instagram' | 'facebook'; label: string }>;
    facebook: Array<{ candidateId: string; platform: 'instagram' | 'facebook'; label: string }>;
  };
  selectedCandidateIds: Set<string>;
  isConfirmingCandidates: boolean;
  onConnectDialogOpenChange: (open: boolean) => void;
  onToggleCandidate: (candidateId: string, checked: boolean) => void;
  onCancelConnect: () => void;
  onConfirmConnect: () => void;
  disconnectDialogOpen: boolean;
  disconnectPending: boolean;
  hasDisconnectTarget: boolean;
  onDisconnectDialogOpenChange: (open: boolean) => void;
  onKeepImportedPosts: () => void;
  onRemoveImportedPosts: () => void;
}

export function SocialAccountsManagerView(props: SocialAccountsManagerViewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Social accounts</CardTitle>
        <CardDescription>
          {props.multiDestinationEnabled
            ? `Connect Instagram Business/Creator accounts and Facebook Pages to ${props.brand.name}.`
            : `Connect an Instagram Business/Creator account to ${props.brand.name}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <AccountsContent
          isLoading={props.accountsLoading}
          connectError={props.connectError}
          connectedAccounts={props.connectedAccounts}
          connectButtons={props.connectButtons}
          connectedSection={props.connectedSection}
        />

        <ConnectCandidatesDialog
          open={props.connectDialogOpen}
          multiDestinationEnabled={props.multiDestinationEnabled}
          brandName={props.brand.name}
          onOpenChange={props.onConnectDialogOpenChange}
          isLoading={props.candidatesLoading}
          isFetching={props.candidatesFetching}
          isWaitingForCandidates={props.waitingForCandidates}
          isError={Boolean(props.candidatesErrorMessage)}
          errorMessage={props.candidatesErrorMessage}
          candidates={props.candidates as any}
          groupedCandidates={props.groupedCandidates as any}
          selectedCandidateIds={props.selectedCandidateIds}
          onToggleCandidate={props.onToggleCandidate}
          onCancel={props.onCancelConnect}
          onConfirm={props.onConfirmConnect}
          isConfirming={props.isConfirmingCandidates}
        />

        <DisconnectAccountDialog
          open={props.disconnectDialogOpen}
          onOpenChange={props.onDisconnectDialogOpenChange}
          isPending={props.disconnectPending}
          hasTarget={props.hasDisconnectTarget}
          onKeepImportedPosts={props.onKeepImportedPosts}
          onRemoveImportedPosts={props.onRemoveImportedPosts}
        />
      </CardContent>
    </Card>
  );
}
