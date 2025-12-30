import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { formatSocialAccountHandle } from '@/lib/social-account-label';
import type { MetaCandidate } from '../types';

type GroupedCandidates = {
  instagram: MetaCandidate[];
  facebook: MetaCandidate[];
};

type ConnectCandidatesDialogProps = {
  open: boolean;
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

export function ConnectCandidatesDialog({
  open,
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
  const showLoading = isLoading || isFetching;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select accounts to connect</DialogTitle>
          <DialogDescription>
            Choose which Instagram accounts and Facebook Pages to attach to {brandName}. You can
            connect multiple.
          </DialogDescription>
        </DialogHeader>

        {showLoading && <div className="bg-muted h-40 animate-pulse rounded" />}

        {!isLoading && isWaitingForCandidates && (
          <Alert>
            <AlertDescription>
              Finishing Meta connection… If you just completed the pop-up, this can take a few
              seconds.
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !isWaitingForCandidates && isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {errorMessage || 'Failed to load connectable accounts.'}
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !isWaitingForCandidates && !isError && candidates.length === 0 && (
          <Alert>
            <AlertDescription>
              No connectable accounts were found for this Meta login.
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && candidates.length > 0 && (
          <ScrollArea className="h-[420px] pr-4">
            <div className="space-y-6">
              {groupedCandidates.instagram.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Instagram accounts</div>
                  <div className="space-y-2">
                    {groupedCandidates.instagram.map((c) => {
                      const checked = selectedCandidateIds.has(c.candidateId);
                      const title = c.displayName || c.username || c.externalAccountId;
                      const subtitle = c.username
                        ? formatSocialAccountHandle('instagram', c.username)
                        : null;
                      return (
                        <label
                          key={c.candidateId}
                          className="bg-card flex cursor-pointer items-center gap-3 rounded-lg border p-3"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => onToggleCandidate(c.candidateId, v === true)}
                          />
                          <SocialAccountAvatar
                            platform="instagram"
                            name={title}
                            src={c.profilePictureUrl || null}
                            size="md"
                            muted={false}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{title}</div>
                            {subtitle && (
                              <div className="text-muted-foreground truncate text-xs">
                                {subtitle}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {groupedCandidates.facebook.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Facebook Pages</div>
                  <div className="space-y-2">
                    {groupedCandidates.facebook.map((c) => {
                      const checked = selectedCandidateIds.has(c.candidateId);
                      const title = c.displayName || c.externalAccountId;
                      return (
                        <label
                          key={c.candidateId}
                          className="bg-card flex cursor-pointer items-center gap-3 rounded-lg border p-3"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => onToggleCandidate(c.candidateId, v === true)}
                          />
                          <SocialAccountAvatar
                            platform="facebook"
                            name={title}
                            src={c.profilePictureUrl || null}
                            size="md"
                            muted={false}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{title}</div>
                            <div className="text-muted-foreground truncate text-xs">
                              Page ID: {c.externalAccountId}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

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
