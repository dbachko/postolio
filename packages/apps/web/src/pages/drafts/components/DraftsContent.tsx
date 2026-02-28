import { CalendarDays, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { AssetsById } from '@/features/assets/hooks/useAssetsByIds';
import type { Content } from '@/lib/api';

import type { DraftGroup } from '../types';
import { DraftCard } from './DraftCard';

function DraftsLoadingState() {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="aspect-square rounded-lg" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function DraftsErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-lg border p-6">
      <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-4">
        <h3 className="text-destructive mb-2 font-semibold">Failed to load drafts</h3>
        <p className="text-muted-foreground text-sm">
          Please try again in a moment or refresh the page.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyDraftsState({
  onResetFilters,
  onCreateDraft,
}: {
  onResetFilters: () => void;
  onCreateDraft: () => void;
}) {
  return (
    <div className="rounded-lg border-2 border-dashed py-12 text-center">
      <p className="text-muted-foreground">No drafts match these filters</p>
      <p className="text-muted-foreground mt-2 text-sm">
        Try adjusting your search, filters, or create a new draft.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        <Button variant="outline" onClick={onResetFilters}>
          Reset filters
        </Button>
        <Button onClick={onCreateDraft}>Create draft</Button>
      </div>
    </div>
  );
}

function DraftGroupsList({
  groupedDrafts,
  assetsById,
  onOpenDraft,
}: {
  groupedDrafts: DraftGroup[];
  assetsById: AssetsById;
  onOpenDraft: (draft: Content) => void;
}) {
  return (
    <div className="space-y-8">
      {groupedDrafts.map((group) => (
        <div key={group.key} className="space-y-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="text-muted-foreground h-4 w-4" />
            <h3 className="text-sm font-semibold">{group.label}</h3>
            <span className="text-muted-foreground text-xs">{group.drafts.length} drafts</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {group.drafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                primaryAsset={
                  draft.primaryAssetId ? (assetsById[draft.primaryAssetId] ?? null) : null
                }
                onOpen={() => onOpenDraft(draft)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DraftsContent({
  isLoading,
  isFetching,
  isError,
  groupedDrafts,
  filteredDraftsCount,
  assetsById,
  onRetry,
  onResetFilters,
  onCreateDraft,
  onOpenDraft,
}: {
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  groupedDrafts: DraftGroup[];
  filteredDraftsCount: number;
  assetsById: AssetsById;
  onRetry: () => void;
  onResetFilters: () => void;
  onCreateDraft: () => void;
  onOpenDraft: (draft: Content) => void;
}) {
  return (
    <div className="relative">
      {isFetching && !isLoading ? (
        <div className="bg-background/80 absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-background flex items-center gap-2 rounded-lg border px-4 py-3 shadow-lg">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">Updating results…</span>
          </div>
        </div>
      ) : null}

      {isLoading ? <DraftsLoadingState /> : null}
      {!isLoading && isError ? <DraftsErrorState onRetry={onRetry} /> : null}
      {!isLoading && !isError && filteredDraftsCount === 0 ? (
        <EmptyDraftsState onResetFilters={onResetFilters} onCreateDraft={onCreateDraft} />
      ) : null}
      {!isLoading && !isError && filteredDraftsCount > 0 ? (
        <DraftGroupsList
          groupedDrafts={groupedDrafts}
          assetsById={assetsById}
          onOpenDraft={onOpenDraft}
        />
      ) : null}
    </div>
  );
}
