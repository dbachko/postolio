import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MetaCandidate } from '../types';
import { ConnectCandidatesState, type GroupedCandidates } from './connect-candidates-dialog-state';

type ConnectCandidatesDialogProps = {
  open: boolean;
  multiDestinationEnabled: boolean;
  brandName: string;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  isFetching: boolean;
  isWaitingForCandidates: boolean;
  isError: boolean;
  errorMessage: string | null;
  candidates: MetaCandidate[];
  groupedCandidates: GroupedCandidates;
  selectedCandidateIds: Set<string>;
  onToggleCandidate: (candidateId: string, checked: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isConfirming: boolean;
};

function getConnectDialogDescription({
  multiDestinationEnabled,
  brandName,
}: Pick<ConnectCandidatesDialogProps, 'multiDestinationEnabled' | 'brandName'>) {
  if (multiDestinationEnabled) {
    return `Choose which Instagram accounts and Facebook Pages to attach to ${brandName}. You can connect multiple.`;
  }
  return `Choose the Instagram account to attach to ${brandName}.`;
}

export function ConnectCandidatesDialog({
  open,
  multiDestinationEnabled,
  brandName,
  onOpenChange,
  isLoading,
  isFetching,
  isWaitingForCandidates,
  isError,
  errorMessage,
  candidates,
  groupedCandidates,
  selectedCandidateIds,
  onToggleCandidate,
  onCancel,
  onConfirm,
  isConfirming,
}: ConnectCandidatesDialogProps) {
  const selectedCount = selectedCandidateIds.size;
  const dialogDescription = getConnectDialogDescription({ multiDestinationEnabled, brandName });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select accounts to connect</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        <ConnectCandidatesState
          isLoading={isLoading}
          isFetching={isFetching}
          isWaitingForCandidates={isWaitingForCandidates}
          isError={isError}
          errorMessage={errorMessage}
          candidates={candidates}
          groupedCandidates={groupedCandidates}
          multiDestinationEnabled={multiDestinationEnabled}
          selectedCandidateIds={selectedCandidateIds}
          onToggleCandidate={onToggleCandidate}
        />
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isConfirming || selectedCount === 0}>
            {isConfirming ? 'Connecting…' : `Connect selected (${selectedCount})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
