import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { assetsApi, type AssetType } from '@/features/assets/api/client';
import { X, Loader2, Search, Video, Image as ImageIcon, Play } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  formatBytes,
  sortAssets,
  useDebouncedValue,
  type AssetTypeFilter,
  type SortDirection,
  type SortField,
} from './asset-utils';
import { SortControls } from './SortControls';
import { FilterPanel, type AssetFilters } from './FilterPanel';

export interface AssetPickerProps {
  onSelect?: (asset: AssetType) => void;
  onClose: () => void;
  brandId: string;
  type?: 'image' | 'video';
  onSelectMany?: (assets: AssetType[]) => void;
}

export default function AssetPicker({
  onSelect,
  onClose,
  brandId,
  type,
  onSelectMany,
}: AssetPickerProps) {
  const [selected, setSelected] = useState<Map<string, AssetType>>(new Map());
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>(type ?? 'all');
  const [sortField, setSortField] = useState<SortField>('created');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filters, setFilters] = useState<AssetFilters>({
    aspectRatios: [],
    orientationTypes: [],
    usageStatuses: [],
    recentOnly: false,
  });
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ['assets-picker', brandId, debouncedSearch, type ?? typeFilter, filters],
    queryFn: ({ pageParam = 1 }) =>
      assetsApi.listAssets({
        brandId,
        page: pageParam,
        limit: 30,
        search: debouncedSearch,
        type: type ?? (typeFilter === 'all' ? undefined : typeFilter),
        aspectRatios: filters.aspectRatios.length > 0 ? filters.aspectRatios : undefined,
        orientationTypes:
          filters.orientationTypes.length > 0 ? filters.orientationTypes : undefined,
        uploadedAfter: filters.recentOnly
          ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
        usage: filters.usageStatuses.length === 1 ? filters.usageStatuses[0] : undefined,
      }),
    enabled: !!brandId,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page < lastPage.pagination.totalPages
        ? lastPage.pagination.page + 1
        : undefined,
    initialPageParam: 1,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const assets = useMemo(() => data?.pages.flatMap((page) => page.assets) ?? [], [data?.pages]);
  const sortedAssets = useMemo(
    () => sortAssets(assets, sortField, sortDirection),
    [assets, sortField, sortDirection]
  );

  const selectedAssets = useMemo(() => Array.from(selected.values()), [selected]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      onClose();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '320px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, assets.length]);

  const handleConfirm = (assetsOverride?: AssetType[]) => {
    const assetsToSend = assetsOverride ?? selectedAssets;
    if (assetsToSend.length === 0) return;
    if (onSelectMany) {
      onSelectMany(assetsToSend);
    } else if (onSelect) {
      assetsToSend.forEach((asset) => onSelect(asset));
    }
    setSelected(new Map());
    onClose();
  };

  const handleSelectAsset = (asset: AssetType) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(asset.id)) next.delete(asset.id);
      else next.set(asset.id, asset);
      return next;
    });
  };

  const handleResetFilters = () => {
    setFilters({
      aspectRatios: [],
      orientationTypes: [],
      usageStatuses: [],
      recentOnly: false,
    });
  };

  return (
    <div className="pl-assets">
      <div
        className="pointer-events-auto fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        data-pl-asset-picker="open"
      >
        <div className="bg-background flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col rounded-lg border shadow-lg">
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b p-4 lg:flex-nowrap lg:justify-between">
            <div className="relative min-w-[240px] flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search assets by title or filename"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              />
            </div>
            {!type && (
              <Tabs
                value={typeFilter}
                onValueChange={(value) => setTypeFilter(value as AssetTypeFilter)}
                className="shrink-0"
              >
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="image">Images</TabsTrigger>
                  <TabsTrigger value="video">Videos</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            <div className="flex items-center gap-2">
              <FilterPanel filters={filters} onChange={setFilters} onReset={handleResetFilters} />
              <SortControls
                field={sortField}
                direction={sortDirection}
                onFieldChange={(field) => setSortField(field)}
                onDirectionToggle={() =>
                  setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                }
              />
              <div className="text-muted-foreground text-sm whitespace-nowrap">
                {selectedAssets.length > 0 ? `${selectedAssets.length} selected` : ''}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close"
              className="text-muted-foreground h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="overflow-y-auto px-4 pt-2 pb-4">
            <div className="h-2" />

            {/* Assets Grid */}
            {(() => {
              if (isLoading) {
                return (
                  <div className="flex h-64 items-center justify-center">
                    <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
                  </div>
                );
              }

              if (sortedAssets.length === 0) {
                return (
                  <div className="rounded-lg border-2 border-dashed py-12 text-center">
                    <p className="text-muted-foreground">No assets found</p>
                    <p className="text-muted-foreground mt-2 text-sm">
                      Upload images or videos to your asset library first
                    </p>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                  {sortedAssets.map((asset) => {
                    const isSelected = selected.has(asset.id);
                    const previewUrl = asset.thumbnailUrl || asset.url;
                    const isVideo = asset.fileType === 'video';
                    return (
                      <Button
                        key={asset.id}
                        type="button"
                        onClick={() => handleSelectAsset(asset)}
                        onDoubleClick={() => {
                          setSelected(new Map([[asset.id, asset]]));
                          handleConfirm([asset]);
                        }}
                        variant="ghost"
                        className={`group relative aspect-square h-auto overflow-hidden rounded-lg border p-0 transition hover:bg-transparent ${
                          isSelected
                            ? 'ring-primary border-primary ring-2 ring-offset-2'
                            : 'hover:border-border/80'
                        }`}
                      >
                        <div className="bg-card/80 absolute top-2 left-2 z-10 rounded-md px-1 py-1 shadow-sm backdrop-blur">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => handleSelectAsset(asset)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            aria-label={isSelected ? 'Deselect asset' : 'Select asset'}
                          />
                        </div>

                        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                          <Badge variant="secondary" className="flex items-center gap-1">
                            {isVideo ? (
                              <Video className="h-3 w-3" />
                            ) : (
                              <ImageIcon className="h-3 w-3" />
                            )}
                            <span className="capitalize">{asset.fileType}</span>
                          </Badge>
                        </div>

                        {isVideo ? (
                          <div className="relative h-full w-full">
                            <video
                              src={previewUrl}
                              className="h-full w-full object-cover"
                              muted
                              playsInline
                            />
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
                            <div className="line-clamp-1 text-sm font-semibold">
                              {asset.title || asset.fileName}
                            </div>
                            <div className="text-xs text-white/80">
                              {formatBytes(asset.fileSize)}
                            </div>
                          </div>
                        </div>
                      </Button>
                    );
                  })}
                </div>
              );
            })()}
            <div ref={loadMoreRef} className="h-1" />
            {isFetchingNextPage && (
              <div className="text-muted-foreground flex justify-center py-3 text-sm">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading more assets…
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t p-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => handleConfirm()}
              disabled={selectedAssets.length === 0}
            >
              Attach {selectedAssets.length > 0 ? `(${selectedAssets.length})` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
