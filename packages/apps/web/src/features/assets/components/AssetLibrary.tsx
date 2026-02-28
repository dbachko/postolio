import { useCallback } from 'react';

import { AppEmptyState } from '@/components/app-empty-state';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';

import { AssetLibraryContent } from './asset-library/asset-library-content';
import { useAssetLibraryAssetsState } from './asset-library/use-asset-library-assets';
import { useAssetLibraryCollectionsState } from './asset-library/use-asset-library-collections';
import { useAssetLibraryFiltersState } from './asset-library/use-asset-library-filters';
import { useAssetLibrarySelectionState } from './asset-library/use-asset-library-selection';

export interface AssetLibraryProps {
  brandId?: string;
}

export default function AssetLibrary({ brandId }: AssetLibraryProps) {
  const filtersState = useAssetLibraryFiltersState();
  const collectionsState = useAssetLibraryCollectionsState({ brandId });
  const assetsState = useAssetLibraryAssetsState({
    brandId,
    search: filtersState.search,
    typeFilter: filtersState.typeFilter,
    filters: filtersState.filters,
    collectionId: collectionsState.collectionId,
    labelIds: filtersState.labelIds,
    sortField: filtersState.sortField,
    sortDirection: filtersState.sortDirection,
  });

  const { openSidebar } = useRightSidebarRouter();
  const openPostCreateSidebar = useCallback(
    (
      panel: 'post-create',
      options: { params: { assetId: string | null; assetIds: string | null } }
    ) => openSidebar(panel, options),
    [openSidebar]
  );
  const selectionState = useAssetLibrarySelectionState({
    brandId,
    sortedAssets: assetsState.sortedAssets,
    openSidebar: openPostCreateSidebar,
  });

  const handleUpload = useCallback(() => {
    if (!brandId) {
      return;
    }
    openSidebar('asset-upload', { id: brandId });
  }, [brandId, openSidebar]);
  const handleOpenAsset = useCallback(
    (assetId: string) => {
      openSidebar('asset', { id: assetId });
    },
    [openSidebar]
  );
  const handleCreatePostForAsset = useCallback(
    (assetId: string) => {
      openSidebar('post-create', { params: { assetId, assetIds: null } });
    },
    [openSidebar]
  );
  const handleResetAllFilters = useCallback(() => {
    filtersState.resetAllFilters();
    collectionsState.setCollectionSelection(null);
    selectionState.clearSelection();
  }, [collectionsState, filtersState, selectionState]);

  if (!brandId) {
    return (
      <AppEmptyState
        variant="minimal"
        title="Select a brand to browse assets"
        description="Asset searches, uploads, and collections are scoped to an individual brand."
        actions={[{ label: 'Choose Brand', to: '/brands' }]}
        className="min-h-[360px]"
      />
    );
  }

  return (
    <AssetLibraryContent
      collections={collectionsState}
      filters={filtersState}
      assets={assetsState}
      selection={selectionState}
      onUpload={handleUpload}
      onOpenAsset={handleOpenAsset}
      onCreatePostForAsset={handleCreatePostForAsset}
      onResetAllFilters={handleResetAllFilters}
    />
  );
}
