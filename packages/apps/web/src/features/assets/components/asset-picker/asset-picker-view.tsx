import { Image as ImageIcon, Loader2, Play, Video, type LucideIcon } from 'lucide-react';
import type { ChangeEvent, DragEvent, RefObject } from 'react';
import type { AssetType } from '@/features/assets/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dropzone } from '@/components/multi-image-uploader/components/dropzone';
import {
  formatBytes,
  type AssetTypeFilter,
  type SortDirection,
  type SortField,
} from '../asset-utils';
import type { AssetFilters } from '../FilterPanel';
import { AssetPickerFooter, AssetPickerHeader } from './asset-picker-chrome';
import { AssetPickerUploadOverlay, AssetPickerUploadStatus } from './asset-picker-upload-state';

interface AssetPickerViewProps {
  type?: 'image' | 'video';
  onClose: () => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  typeFilter: AssetTypeFilter;
  onTypeFilterChange: (value: AssetTypeFilter) => void;
  filters: AssetFilters;
  onFiltersChange: (next: AssetFilters) => void;
  onFiltersReset: () => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onSortFieldChange: (field: SortField) => void;
  onSortDirectionToggle: () => void;
  selected: Map<string, AssetType>;
  selectedAssetsCount: number;
  sortedAssets: AssetType[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  isDraggingFiles: boolean;
  isUploading: boolean;
  uploadError: string | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDropzoneClick: () => void;
  onSelectAsset: (asset: AssetType) => void;
  onDoubleClickAsset: (asset: AssetType) => void;
  onConfirm: () => void;
}

function assetPickerAcceptType(type?: 'image' | 'video') {
  if (type === 'video') {
    return 'video/*';
  }
  if (type === 'image') {
    return 'image/*';
  }
  return 'image/*,video/*';
}

function AssetPickerLoadingState() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
    </div>
  );
}

function AssetPickerEmptyState({
  type,
  isDraggingFiles,
  isUploading,
  onDropzoneClick,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  type?: 'image' | 'video';
  isDraggingFiles: boolean;
  isUploading: boolean;
  onDropzoneClick: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl py-8">
      <Dropzone
        variant="full"
        allowMixedMedia
        maxImages={10}
        maxSizeInMB={10}
        maxVideoSizeInMB={500}
        mediaItemCount={0}
        isDragging={isDraggingFiles}
        isUploadInProgress={isUploading}
        isUploadingVideo={false}
        videoUploadProgress={null}
        onClick={onDropzoneClick}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />
      {type ? (
        <p className="text-muted-foreground mt-2 text-center text-xs">
          This picker accepts {type} files only.
        </p>
      ) : null}
    </div>
  );
}

function AssetTypeBadge({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <Badge variant="secondary" className="flex items-center gap-1">
      <Icon className="h-3 w-3" />
      <span className="capitalize">{label}</span>
    </Badge>
  );
}

function AssetPickerTile({
  asset,
  selected,
  onSelect,
  onDoubleClick,
}: {
  asset: AssetType;
  selected: boolean;
  onSelect: (asset: AssetType) => void;
  onDoubleClick: (asset: AssetType) => void;
}) {
  const previewUrl = asset.thumbnailUrl || asset.url;
  const isVideo = asset.fileType === 'video';

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onSelect(asset)}
      onDoubleClick={() => onDoubleClick(asset)}
      className={`group relative aspect-square h-auto overflow-hidden rounded-lg border p-0 transition hover:bg-transparent ${selected ? 'ring-primary border-primary ring-2 ring-offset-2' : 'hover:border-border/80'}`}
    >
      <div className="bg-card/80 absolute top-2 left-2 z-10 rounded-md px-1 py-1 shadow-sm backdrop-blur">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onSelect(asset)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={selected ? 'Deselect asset' : 'Select asset'}
        />
      </div>
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        <AssetTypeBadge icon={isVideo ? Video : ImageIcon} label={asset.fileType} />
      </div>
      {isVideo ? (
        <div className="relative h-full w-full">
          <video src={previewUrl} className="h-full w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-black/60 p-2">
              <Play className="h-4 w-4 text-white" />
            </div>
          </div>
        </div>
      ) : (
        <img
          src={previewUrl}
          alt={asset.altText || asset.fileName}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-black/60 to-transparent px-3 pt-12 pb-3 text-white opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex min-w-0 flex-col gap-1 text-left">
          <div className="line-clamp-1 text-sm font-semibold">{asset.title || asset.fileName}</div>
          <div className="text-xs text-white/80">{formatBytes(asset.fileSize)}</div>
        </div>
      </div>
    </Button>
  );
}

function AssetPickerGrid({
  isLoading,
  sortedAssets,
  selected,
  onSelectAsset,
  onDoubleClickAsset,
  type,
  isDraggingFiles,
  isUploading,
  onDropzoneClick,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  isLoading: boolean;
  sortedAssets: AssetType[];
  selected: Map<string, AssetType>;
  onSelectAsset: (asset: AssetType) => void;
  onDoubleClickAsset: (asset: AssetType) => void;
  type?: 'image' | 'video';
  isDraggingFiles: boolean;
  isUploading: boolean;
  onDropzoneClick: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  if (isLoading) {
    return <AssetPickerLoadingState />;
  }
  if (sortedAssets.length === 0) {
    return (
      <AssetPickerEmptyState
        type={type}
        isDraggingFiles={isDraggingFiles}
        isUploading={isUploading}
        onDropzoneClick={onDropzoneClick}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {sortedAssets.map((asset) => (
        <AssetPickerTile
          key={asset.id}
          asset={asset}
          selected={selected.has(asset.id)}
          onSelect={onSelectAsset}
          onDoubleClick={onDoubleClickAsset}
        />
      ))}
    </div>
  );
}

type AssetPickerBodyProps = Pick<
  AssetPickerViewProps,
  | 'type'
  | 'sortedAssets'
  | 'isLoading'
  | 'selected'
  | 'onSelectAsset'
  | 'onDoubleClickAsset'
  | 'isDraggingFiles'
  | 'isUploading'
  | 'uploadError'
  | 'fileInputRef'
  | 'onFileInputChange'
  | 'onDragEnter'
  | 'onDragOver'
  | 'onDragLeave'
  | 'onDrop'
  | 'onDropzoneClick'
  | 'loadMoreRef'
  | 'isFetchingNextPage'
>;

function AssetPickerBody(props: AssetPickerBodyProps) {
  const {
    type,
    sortedAssets,
    isLoading,
    selected,
    onSelectAsset,
    onDoubleClickAsset,
    isDraggingFiles,
    isUploading,
    uploadError,
    fileInputRef,
    onFileInputChange,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onDropzoneClick,
    loadMoreRef,
    isFetchingNextPage,
  } = props;

  return (
    <div
      className="relative overflow-y-auto px-4 pt-2 pb-4"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={assetPickerAcceptType(type)}
        multiple
        className="hidden"
        onChange={onFileInputChange}
        disabled={isUploading}
      />
      <div className="h-2" />
      <AssetPickerUploadStatus uploadError={uploadError} isUploading={isUploading} />
      <AssetPickerGrid
        isLoading={isLoading}
        sortedAssets={sortedAssets}
        selected={selected}
        onSelectAsset={onSelectAsset}
        onDoubleClickAsset={onDoubleClickAsset}
        type={type}
        isDraggingFiles={isDraggingFiles}
        isUploading={isUploading}
        onDropzoneClick={onDropzoneClick}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />
      <AssetPickerUploadOverlay
        isDraggingFiles={isDraggingFiles}
        sortedAssetsCount={sortedAssets.length}
        isUploading={isUploading}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />
      <div ref={loadMoreRef} className="h-1" />
      {isFetchingNextPage ? (
        <div className="text-muted-foreground flex justify-center py-3 text-sm">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading more assets…
        </div>
      ) : null}
    </div>
  );
}

export function AssetPickerView(props: AssetPickerViewProps) {
  return (
    <div className="pl-assets">
      <div
        className="pointer-events-auto fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        data-pl-asset-picker="open"
      >
        <div className="bg-background flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col rounded-lg border shadow-lg">
          <AssetPickerHeader {...props} />
          <AssetPickerBody {...props} />
          <AssetPickerFooter {...props} />
        </div>
      </div>
    </div>
  );
}
