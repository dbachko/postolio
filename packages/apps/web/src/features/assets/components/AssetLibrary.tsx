import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Loader2, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { assetsApi, type AssetType } from '@/features/assets/api/client';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { AppEmptyState } from '@/components/AppEmptyState';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { AssetCard } from './AssetCard';
import { SortControls } from './SortControls';
import { SelectionBar } from './SelectionBar';
import { DeleteAssetsDialog } from './DeleteAssetsDialog';
import { groupByMonth, sortAssets, useDebouncedValue } from './asset-utils';
import type { AssetTypeFilter, SortDirection, SortField } from './asset-utils';

export interface AssetLibraryProps {
  brandId?: string;
}

export default function AssetLibrary({ brandId }: AssetLibraryProps) {
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>('all');
  const [sortField, setSortField] = useState<SortField>('created');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selected, setSelected] = useState<Map<string, AssetType>>(new Map());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const search = useDebouncedValue(searchInput, 350);
  const { openSidebar } = useRightSidebarRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['assets', brandId, search, typeFilter],
      queryFn: ({ pageParam = 1 }) =>
        assetsApi.listAssets({
          brandId,
          page: pageParam,
          limit: 30,
          search,
          type: typeFilter === 'all' ? undefined : typeFilter,
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

  const allAssets = useMemo(() => data?.pages.flatMap((page) => page.assets) ?? [], [data?.pages]);
  const sortedAssets = useMemo(
    () => sortAssets(allAssets, sortField, sortDirection),
    [allAssets, sortField, sortDirection]
  );
  const groupedAssets = useMemo(() => groupByMonth(sortedAssets), [sortedAssets]);

  const clearSelection = useCallback(() => {
    setSelected(new Map());
    setLastSelectedId(null);
  }, []);

  const toggleSelect = useCallback(
    (asset: AssetType, opts?: { shiftKey?: boolean }) => {
      if (opts?.shiftKey && lastSelectedId && sortedAssets.length > 0) {
        const start = sortedAssets.findIndex((a) => a.id === lastSelectedId);
        const end = sortedAssets.findIndex((a) => a.id === asset.id);
        if (start !== -1 && end !== -1) {
          const [from, to] = start < end ? [start, end] : [end, start];
          setSelected((prev) => {
            const next = new Map(prev);
            for (let i = from; i <= to; i += 1) {
              const current = sortedAssets[i];
              if (current) next.set(current.id, current);
            }
            return next;
          });
          setLastSelectedId(asset.id);
          return;
        }
      }

      setSelected((prev) => {
        const next = new Map(prev);
        if (next.has(asset.id)) next.delete(asset.id);
        else next.set(asset.id, asset);
        return next;
      });
      setLastSelectedId(asset.id);
    },
    [lastSelectedId, sortedAssets]
  );

  const selectedAssets = useMemo(() => Array.from(selected.values()), [selected]);

  const deleteSelected = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await assetsApi.deleteAsset(id);
      }
    },
    onSuccess: (_data, ids) => {
      setSelected((prev) => {
        const next = new Map(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setShowDeleteDialog(false);
      toast.success(ids.length === 1 ? 'Asset deleted' : `${ids.length} assets deleted`);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to delete assets';
      toast.error(message);
    },
  });

  const handleDeleteSelected = () => {
    if (selectedAssets.length === 0) return;
    setShowDeleteDialog(true);
  };

  const handleCreatePostFromSelection = () => {
    if (selectedAssets.length === 0) return;
    const images = selectedAssets.filter((a) => a.fileType === 'image');
    const videos = selectedAssets.filter((a) => a.fileType === 'video');

    if (videos.length > 0 && images.length === 0) {
      if (videos.length > 1) {
        toast.info('Only one video can be attached; using the first video selected.');
      }
      openSidebar('post-create', { params: { assetId: videos[0].id, assetIds: null } });
      clearSelection();
      return;
    }

    if (images.length > 0) {
      const imageIds = images.map((a) => a.id);
      if (videos.length > 0) {
        toast.info('Videos cannot be combined with images; only images were attached.');
      }
      openSidebar('post-create', { params: { assetIds: imageIds.join(','), assetId: null } });
      clearSelection();
      return;
    }
  };

  const handleOpenAsset = useCallback(
    (assetId: string) => {
      openSidebar('asset', { id: assetId });
    },
    [openSidebar]
  );

  const resetFilters = useCallback(() => {
    setSearchInput('');
    setTypeFilter('all');
    setSortField('created');
    setSortDirection('desc');
    clearSelection();
  }, [clearSelection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selected.size > 0) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection, selected.size]);

  if (!brandId) {
    return (
      <AppEmptyState
        variant="minimal"
        title="Select a brand to browse assets"
        description="Asset searches, uploads, and folders are scoped to an individual brand."
        actions={[{ label: 'Choose Brand', to: '/brands' }]}
        className="min-h-[360px]"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search assets by title or filename"
              className="pl-9"
            />
          </div>
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
          <div className="flex items-center gap-2">
            <SortControls
              field={sortField}
              direction={sortDirection}
              onFieldChange={(field) => setSortField(field)}
              onDirectionToggle={() =>
                setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
              }
            />
            <Button onClick={() => openSidebar('asset-upload', { id: brandId })}>
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </Button>
          </div>
        </div>
      </div>

      {isFetching && (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Updating results…
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, idx) => (
            <div key={idx} className="space-y-2">
              <Skeleton className="aspect-square rounded-lg" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : sortedAssets.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed py-12 text-center">
          <p className="text-muted-foreground">No assets match these filters</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Try adjusting search or upload your first image or video.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Button variant="outline" onClick={resetFilters}>
              Reset filters
            </Button>
            <Button onClick={() => openSidebar('asset-upload', { id: brandId })}>
              Upload assets
            </Button>
          </div>
        </div>
      ) : (
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
                    onToggle={(opts) => toggleSelect(asset, opts)}
                    onOpen={() => handleOpenAsset(asset.id)}
                    onCreatePost={() =>
                      openSidebar('post-create', { params: { assetId: asset.id, assetIds: null } })
                    }
                  />
                ))}
              </div>
            </div>
          ))}

          {hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading more…
                  </>
                ) : (
                  'Load more'
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      <SelectionBar
        count={selectedAssets.length}
        onClear={clearSelection}
        onCreatePost={handleCreatePostFromSelection}
        onDelete={handleDeleteSelected}
        deletePending={deleteSelected.isPending}
      />

      <DeleteAssetsDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        count={selectedAssets.length}
        isPending={deleteSelected.isPending}
        onConfirm={() => deleteSelected.mutate(selectedAssets.map((asset) => asset.id))}
      />
    </div>
  );
}
