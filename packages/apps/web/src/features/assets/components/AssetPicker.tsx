import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { AssetType } from '@/features/assets/api/client';
import {
  useDebouncedValue,
  type AssetTypeFilter,
  type SortDirection,
  type SortField,
} from './asset-utils';
import type { AssetFilters } from './FilterPanel';
import { AssetPickerView } from './asset-picker/asset-picker-view';
import { useAssetPickerSelection } from './asset-picker/use-asset-picker-selection';
import { useAssetPickerUpload } from './asset-picker/use-asset-picker-upload';
import { useCloseOnEscape } from './asset-picker/use-close-on-escape';
import { useInfiniteScrollSentinel } from './asset-picker/use-infinite-scroll-sentinel';
import { useAssetPickerQuery } from './asset-picker/use-asset-picker-query';

export interface AssetPickerProps {
  onSelect?: (asset: AssetType) => void;
  onClose: () => void;
  brandId: string;
  type?: 'image' | 'video';
  onSelectMany?: (assets: AssetType[]) => void;
}

const INITIAL_FILTERS: AssetFilters = {
  aspectRatios: [],
  orientationTypes: [],
  usageStatuses: [],
  recentOnly: false,
};

export default function AssetPicker({
  onSelect,
  onClose,
  brandId,
  type,
  onSelectMany,
}: AssetPickerProps) {
  const queryClient = useQueryClient();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>(type ?? 'all');
  const [sortField, setSortField] = useState<SortField>('created');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filters, setFilters] = useState<AssetFilters>(INITIAL_FILTERS);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const { assets, sortedAssets, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useAssetPickerQuery({
      brandId,
      debouncedSearch,
      type,
      typeFilter,
      filters,
      sortField,
      sortDirection,
    });

  const { selected, selectedAssets, handleConfirm, handleSelectAsset, handleAssetDoubleClick } =
    useAssetPickerSelection({ onSelect, onSelectMany, onClose });

  const upload = useAssetPickerUpload({ brandId, type, queryClient });

  useCloseOnEscape(onClose);
  useInfiniteScrollSentinel({
    loadMoreRef,
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
    fetchNextPage: async () => {
      await fetchNextPage();
    },
    dependency: assets.length,
  });

  return (
    <AssetPickerView
      type={type}
      onClose={onClose}
      searchInput={searchInput}
      onSearchInputChange={setSearchInput}
      typeFilter={typeFilter}
      onTypeFilterChange={setTypeFilter}
      filters={filters}
      onFiltersChange={setFilters}
      onFiltersReset={() => setFilters(INITIAL_FILTERS)}
      sortField={sortField}
      sortDirection={sortDirection}
      onSortFieldChange={setSortField}
      onSortDirectionToggle={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
      selected={selected}
      selectedAssetsCount={selectedAssets.length}
      sortedAssets={sortedAssets}
      isLoading={isLoading}
      isFetchingNextPage={isFetchingNextPage}
      loadMoreRef={loadMoreRef}
      isDraggingFiles={upload.isDraggingFiles}
      isUploading={upload.isUploading}
      uploadError={upload.uploadError}
      fileInputRef={upload.fileInputRef}
      onFileInputChange={upload.handleFileInputChange}
      onDragEnter={upload.handleDragEnter}
      onDragOver={upload.handleDragOver}
      onDragLeave={upload.handleDragLeave}
      onDrop={upload.handleDrop}
      onDropzoneClick={upload.handleDropzoneClick}
      onSelectAsset={handleSelectAsset}
      onDoubleClickAsset={handleAssetDoubleClick}
      onConfirm={() => handleConfirm()}
    />
  );
}
