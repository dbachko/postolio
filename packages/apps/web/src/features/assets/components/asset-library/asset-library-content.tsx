import type { ReactNode } from 'react';
import { CalendarDays, Loader2, Search, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AssetType, CollectionNode } from '@/features/assets/api/client';

import { AssetCard } from '../AssetCard';
import { DeleteAssetsDialog } from '../DeleteAssetsDialog';
import { FilterPanel } from '../FilterPanel';
import { SelectionBar } from '../SelectionBar';
import { SortControls } from '../SortControls';
import type { AssetTypeFilter } from '../asset-utils';
import { CollectionTree } from './collection-tree';
import type { AssetLibraryAssetsState } from './use-asset-library-assets';
import type { AssetLibraryCollectionsState } from './use-asset-library-collections';
import type { AssetLibraryFiltersState } from './use-asset-library-filters';
import type { AssetLibrarySelectionState } from './use-asset-library-selection';
import { ROOT_COLLECTION_INLINE_PARENT_ID, UNSORTED_COLLECTION_PARAM } from './constants';

type AssetLibraryContentProps = {
  collections: AssetLibraryCollectionsState;
  filters: AssetLibraryFiltersState;
  assets: AssetLibraryAssetsState;
  selection: AssetLibrarySelectionState;
  onUpload: () => void;
  onOpenAsset: (assetId: string) => void;
  onCreatePostForAsset: (assetId: string) => void;
  onResetAllFilters: () => void;
};

function LibraryScopeSummary({
  selectedCollection,
  isUnsortedCollectionSelected,
  labelIds,
}: {
  selectedCollection: CollectionNode | null;
  isUnsortedCollectionSelected: boolean;
  labelIds: string[];
}) {
  let collectionLabel: ReactNode = <span>All collections</span>;

  if (isUnsortedCollectionSelected) {
    collectionLabel = (
      <span>
        In collection <span className="text-foreground">Unsorted</span>
      </span>
    );
  } else if (selectedCollection) {
    collectionLabel = (
      <span>
        In collection <span className="text-foreground">{selectedCollection.name}</span>
      </span>
    );
  }

  return (
    <div className="text-muted-foreground text-xs">
      {collectionLabel}
      {labelIds.length > 0 ? (
        <span>
          {' • '}
          {labelIds.length} label{labelIds.length === 1 ? '' : 's'} selected
        </span>
      ) : null}
    </div>
  );
}

function AssetLibraryToolbarCard({
  selectedCollection,
  isUnsortedCollectionSelected,
  labelIds,
  filters,
  labelOptions,
  onUpload,
}: {
  selectedCollection: CollectionNode | null;
  isUnsortedCollectionSelected: boolean;
  labelIds: string[];
  filters: AssetLibraryFiltersState;
  labelOptions: Array<{ label: string; value: string }>;
  onUpload: () => void;
}) {
  return (
    <div className="bg-card border-border rounded-lg border p-4 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Media Library
            </p>
            <LibraryScopeSummary
              selectedCollection={selectedCollection}
              isUnsortedCollectionSelected={isUnsortedCollectionSelected}
              labelIds={labelIds}
            />
          </div>
          <div className="flex items-center gap-2 self-start">
            <Button onClick={onUpload}>
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </Button>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,_1fr)_auto_auto_auto] xl:items-center">
          <div className="relative min-w-0">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              value={filters.searchInput}
              onChange={(event) => filters.setSearchInput(event.target.value)}
              placeholder="Search assets by title or filename"
              className="pl-9"
            />
          </div>
          <Tabs
            value={filters.typeFilter}
            onValueChange={(value) => filters.setTypeFilter(value as AssetTypeFilter)}
            className="shrink-0"
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="image">Images</TabsTrigger>
              <TabsTrigger value="video">Videos</TabsTrigger>
            </TabsList>
          </Tabs>
          <FilterPanel
            filters={filters.filters}
            labelIds={filters.labelIds}
            labelOptions={labelOptions}
            onLabelIdsChange={filters.setLabelIds}
            onChange={filters.setFilters}
            onReset={filters.resetPanelFilters}
          />
          <SortControls
            field={filters.sortField}
            direction={filters.sortDirection}
            onFieldChange={filters.setSortField}
            onDirectionToggle={() =>
              filters.setSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
            }
            triggerWidthClassName="sm:w-auto"
          />
        </div>
      </div>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="aspect-square rounded-lg" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function EmptyAssetsState({
  onUpload,
  onResetAllFilters,
}: {
  onUpload: () => void;
  onResetAllFilters: () => void;
}) {
  return (
    <div className="rounded-lg border-2 border-dashed py-12 text-center">
      <p className="text-muted-foreground">No assets match these filters</p>
      <p className="text-muted-foreground mt-2 text-sm">
        Try adjusting search or upload your first image or video.
      </p>
      <div className="mt-4 flex justify-center gap-3">
        <Button variant="outline" onClick={onResetAllFilters}>
          Reset filters
        </Button>
        <Button onClick={onUpload}>Upload assets</Button>
      </div>
    </div>
  );
}

function GroupedAssets({
  groupedAssets,
  selected,
  onToggleSelect,
  onOpenAsset,
  onCreatePostForAsset,
}: {
  groupedAssets: Record<string, AssetType[]>;
  selected: Map<string, AssetType>;
  onToggleSelect: AssetLibrarySelectionState['toggleSelect'];
  onOpenAsset: (assetId: string) => void;
  onCreatePostForAsset: (assetId: string) => void;
}) {
  return (
    <div className="space-y-8">
      {Object.entries(groupedAssets).map(([month, assets]) => (
        <div key={month} className="space-y-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="text-muted-foreground h-4 w-4" />
            <h3 className="text-sm font-semibold">{month}</h3>
            <span className="text-muted-foreground text-xs">{assets.length} assets</span>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                selected={selected.has(asset.id)}
                onToggle={(opts) => onToggleSelect(asset, opts)}
                onOpen={() => onOpenAsset(asset.id)}
                onCreatePost={() => onCreatePostForAsset(asset.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AssetResults({
  assets,
  selection,
  onUpload,
  onOpenAsset,
  onCreatePostForAsset,
  onResetAllFilters,
}: {
  assets: AssetLibraryAssetsState;
  selection: AssetLibrarySelectionState;
  onUpload: () => void;
  onOpenAsset: (assetId: string) => void;
  onCreatePostForAsset: (assetId: string) => void;
  onResetAllFilters: () => void;
}) {
  if (assets.isLoading) {
    return <LoadingGrid />;
  }

  if (assets.sortedAssets.length === 0) {
    return <EmptyAssetsState onUpload={onUpload} onResetAllFilters={onResetAllFilters} />;
  }

  return (
    <div className="space-y-8">
      <GroupedAssets
        groupedAssets={assets.groupedAssets}
        selected={selection.selected}
        onToggleSelect={selection.toggleSelect}
        onOpenAsset={onOpenAsset}
        onCreatePostForAsset={onCreatePostForAsset}
      />

      <div ref={assets.loadMoreRef} className="h-1" />
      {assets.isFetchingNextPage ? (
        <div className="text-muted-foreground flex justify-center py-4 text-sm">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading more assets…
        </div>
      ) : null}
    </div>
  );
}

function AssetLibrarySidebar({
  collections,
  selection,
}: {
  collections: AssetLibraryCollectionsState;
  selection: AssetLibrarySelectionState;
}) {
  return (
    <aside className="space-y-6 lg:sticky lg:top-4 lg:self-start">
      <CollectionTree
        collections={collections.collections}
        collectionId={collections.collectionId}
        unsortedAssetCount={collections.unsortedAssetCount}
        expandedCollections={collections.expandedCollections}
        inlineRenameId={collections.inlineRenameId}
        inlineRenameValue={collections.inlineRenameValue}
        inlineCreateParentId={collections.inlineCreateParentId}
        inlineCreateValue={collections.inlineCreateValue}
        isInlineRenameSaving={collections.isInlineRenameSaving}
        isInlineCreateSaving={collections.isInlineCreateSaving}
        selectedAssetsCount={selection.selectedAssets.length}
        rootCollectionInlineParentId={ROOT_COLLECTION_INLINE_PARENT_ID}
        unsortedCollectionParam={UNSORTED_COLLECTION_PARAM}
        onSetInlineRenameValue={collections.setInlineRenameValue}
        onSetInlineCreateValue={collections.setInlineCreateValue}
        onSetCollectionSelection={collections.setCollectionSelection}
        onSetCollectionExpanded={collections.setCollectionExpanded}
        onStartInlineCreateRootCollection={collections.startInlineCreateRootCollection}
        onStartInlineRenameCollection={collections.startInlineRenameCollection}
        onCancelInlineRenameCollection={collections.cancelInlineRenameCollection}
        onSubmitInlineRenameCollection={() => {
          void collections.submitInlineRenameCollection();
        }}
        onStartInlineCreateSubcollection={collections.startInlineCreateSubcollection}
        onCancelInlineCreateCollection={collections.cancelInlineCreateCollection}
        onSubmitInlineCreateCollection={() => {
          void collections.submitInlineCreateCollection();
        }}
        onDeleteCollection={(collection) => {
          void collections.deleteCollection(collection);
        }}
        onMoveSelectedToCollection={(collectionId) => {
          void selection.moveSelectedToCollection(collectionId);
        }}
      />
    </aside>
  );
}

export function AssetLibraryContent({
  collections,
  filters,
  assets,
  selection,
  onUpload,
  onOpenAsset,
  onCreatePostForAsset,
  onResetAllFilters,
}: AssetLibraryContentProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,_1fr)]">
        <AssetLibrarySidebar collections={collections} selection={selection} />

        <div className="min-w-0 space-y-6">
          <AssetLibraryToolbarCard
            selectedCollection={collections.selectedCollection}
            isUnsortedCollectionSelected={collections.isUnsortedCollectionSelected}
            labelIds={filters.labelIds}
            filters={filters}
            labelOptions={collections.labelOptions}
            onUpload={onUpload}
          />

          <div className="relative">
            {assets.isFetching && !assets.isLoading ? (
              <div className="bg-background/80 absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm">
                <div className="bg-background flex items-center gap-2 rounded-lg border px-4 py-3 shadow-lg">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm font-medium">Updating results…</span>
                </div>
              </div>
            ) : null}

            <AssetResults
              assets={assets}
              selection={selection}
              onUpload={onUpload}
              onOpenAsset={onOpenAsset}
              onCreatePostForAsset={onCreatePostForAsset}
              onResetAllFilters={onResetAllFilters}
            />
          </div>
        </div>
      </div>

      <SelectionBar
        count={selection.selectedAssets.length}
        onClear={selection.clearSelection}
        onMoveToCollection={selection.moveSelectedToCollection}
        collectionOptions={collections.selectionCollectionOptions}
        movePending={selection.isMovingSelected}
        onCreatePost={selection.createPostFromSelection}
        onDelete={selection.openDeleteSelectedDialog}
        deletePending={selection.deleteSelectedPending}
        deleteDisabled={Boolean(selection.deleteBlockedReason) || selection.isCheckingUsage}
        deleteTooltip={selection.deleteTooltip}
      />

      <DeleteAssetsDialog
        open={selection.showDeleteDialog}
        onOpenChange={selection.setShowDeleteDialog}
        count={selection.selectedAssets.length}
        isPending={selection.deleteSelectedPending}
        onConfirm={selection.confirmDeleteSelected}
      />
    </div>
  );
}
