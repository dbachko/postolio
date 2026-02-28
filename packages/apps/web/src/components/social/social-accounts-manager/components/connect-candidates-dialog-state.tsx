import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { formatSocialAccountHandle } from '@/lib/social-account-label';
import type { MetaCandidate } from '../types';

export type GroupedCandidates = {
  instagram: MetaCandidate[];
  facebook: MetaCandidate[];
};

function CandidateRow({
  candidate,
  checked,
  platform,
  subtitle,
  onToggleCandidate,
}: {
  candidate: MetaCandidate;
  checked: boolean;
  platform: 'instagram' | 'facebook';
  subtitle: string | null;
  onToggleCandidate: (candidateId: string, checked: boolean) => void;
}) {
  const title =
    platform === 'instagram'
      ? candidate.displayName || candidate.username || candidate.externalAccountId
      : candidate.displayName || candidate.externalAccountId;
  return (
    <label className="bg-card flex cursor-pointer items-center gap-3 rounded-lg border p-3">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onToggleCandidate(candidate.candidateId, value === true)}
      />
      <SocialAccountAvatar
        platform={platform}
        name={title}
        src={candidate.profilePictureUrl || null}
        size="md"
        muted={false}
      />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        {subtitle ? <div className="text-muted-foreground truncate text-xs">{subtitle}</div> : null}
      </div>
    </label>
  );
}

function CandidateSection({
  title,
  candidates,
  selectedCandidateIds,
  platform,
  onToggleCandidate,
}: {
  title: string;
  candidates: MetaCandidate[];
  selectedCandidateIds: Set<string>;
  platform: 'instagram' | 'facebook';
  onToggleCandidate: (candidateId: string, checked: boolean) => void;
}) {
  const getCandidateSubtitle = (candidate: MetaCandidate): string | null => {
    if (platform !== 'instagram') {
      return `Page ID: ${candidate.externalAccountId}`;
    }
    if (!candidate.username) {
      return null;
    }
    return formatSocialAccountHandle('instagram', candidate.username);
  };
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      <div className="space-y-2">
        {candidates.map((candidate) => {
          const subtitle = getCandidateSubtitle(candidate);
          return (
            <CandidateRow
              key={candidate.candidateId}
              candidate={candidate}
              checked={selectedCandidateIds.has(candidate.candidateId)}
              platform={platform}
              subtitle={subtitle}
              onToggleCandidate={onToggleCandidate}
            />
          );
        })}
      </div>
    </div>
  );
}

function ConnectCandidatesStatusAlert({
  isLoading,
  isWaitingForCandidates,
  isError,
  errorMessage,
  candidates,
}: {
  isLoading: boolean;
  isWaitingForCandidates: boolean;
  isError: boolean;
  errorMessage: string | null;
  candidates: MetaCandidate[];
}) {
  if (isLoading) {
    return null;
  }
  if (isWaitingForCandidates) {
    return (
      <Alert>
        <AlertDescription>
          Finishing Meta connection… If you just completed the pop-up, this can take a few seconds.
        </AlertDescription>
      </Alert>
    );
  }
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {errorMessage || 'Failed to load connectable accounts.'}
        </AlertDescription>
      </Alert>
    );
  }
  if (candidates.length === 0) {
    return (
      <Alert>
        <AlertDescription>No connectable accounts were found for this Meta login.</AlertDescription>
      </Alert>
    );
  }
  return null;
}

function ConnectCandidatesList({
  isLoading,
  candidates,
  groupedCandidates,
  multiDestinationEnabled,
  selectedCandidateIds,
  onToggleCandidate,
}: {
  isLoading: boolean;
  candidates: MetaCandidate[];
  groupedCandidates: GroupedCandidates;
  multiDestinationEnabled: boolean;
  selectedCandidateIds: Set<string>;
  onToggleCandidate: (candidateId: string, checked: boolean) => void;
}) {
  if (isLoading || candidates.length === 0) {
    return null;
  }
  return (
    <ScrollArea className="h-[420px] pr-4">
      <div className="space-y-6">
        {groupedCandidates.instagram.length > 0 ? (
          <CandidateSection
            title="Instagram accounts"
            candidates={groupedCandidates.instagram}
            selectedCandidateIds={selectedCandidateIds}
            platform="instagram"
            onToggleCandidate={onToggleCandidate}
          />
        ) : null}
        {multiDestinationEnabled && groupedCandidates.facebook.length > 0 ? (
          <CandidateSection
            title="Facebook Pages"
            candidates={groupedCandidates.facebook}
            selectedCandidateIds={selectedCandidateIds}
            platform="facebook"
            onToggleCandidate={onToggleCandidate}
          />
        ) : null}
      </div>
    </ScrollArea>
  );
}

export function ConnectCandidatesState({
  isLoading,
  isFetching,
  isWaitingForCandidates,
  isError,
  errorMessage,
  candidates,
  groupedCandidates,
  multiDestinationEnabled,
  selectedCandidateIds,
  onToggleCandidate,
}: {
  isLoading: boolean;
  isFetching: boolean;
  isWaitingForCandidates: boolean;
  isError: boolean;
  errorMessage: string | null;
  candidates: MetaCandidate[];
  groupedCandidates: GroupedCandidates;
  multiDestinationEnabled: boolean;
  selectedCandidateIds: Set<string>;
  onToggleCandidate: (candidateId: string, checked: boolean) => void;
}) {
  const showLoading = isLoading || isFetching;
  return (
    <>
      {showLoading ? <div className="bg-muted h-40 animate-pulse rounded" /> : null}
      <ConnectCandidatesStatusAlert
        isLoading={isLoading}
        isWaitingForCandidates={isWaitingForCandidates}
        isError={isError}
        errorMessage={errorMessage}
        candidates={candidates}
      />
      <ConnectCandidatesList
        isLoading={isLoading}
        candidates={candidates}
        groupedCandidates={groupedCandidates}
        multiDestinationEnabled={multiDestinationEnabled}
        selectedCandidateIds={selectedCandidateIds}
        onToggleCandidate={onToggleCandidate}
      />
    </>
  );
}
