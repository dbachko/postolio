import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, useCallback } from 'react';
import { assetsApi, type AssetType } from '@/features/assets/api/client';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { AppEmptyState } from '@/components/AppEmptyState';

export interface AssetLibraryProps {
  brandId?: string;
}

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced as T;
}

export default function AssetLibrary({ brandId }: AssetLibraryProps) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const { openSidebar } = useRightSidebarRouter();

  const handleAssetOpen = useCallback(
    (assetId: string) => {
      openSidebar('asset', { id: assetId });
    },
    [openSidebar]
  );

  // Reset pagination when search changes
  useEffect(() => {
    setPage(1);
  }, [search]);

  const { data, isFetching, error } = useQuery({
    queryKey: ['assets', brandId, page, search],
    queryFn: () => assetsApi.listAssets({ brandId, page, limit: 20, search }),
    enabled: !!brandId,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev, // keep previous page’s data while fetching
    staleTime: 5_000,
  });

  if (!brandId) {
    return (
      <AppEmptyState
        title="Select a brand to browse assets"
        description="Asset searches, uploads, and folders are scoped to an individual brand."
        actions={[{ label: 'Choose Brand', to: '/brands' }]}
        className="min-h-[360px]"
      />
    );
  }

  if (error) {
    return (
      <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-6">
        <h3 className="text-destructive mb-2 font-semibold">Error Loading Assets</h3>
        <p className="text-muted-foreground text-sm">
          {error instanceof Error ? error.message : 'Failed to load assets'}
        </p>
      </div>
    );
  }

  const assets = data?.assets || [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Search assets..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          onClick={() => openSidebar('asset-upload', { id: brandId })}
          className="ring-offset-background focus-visible:ring-ring bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          Upload
        </button>
      </div>

      {isFetching && <div className="text-muted-foreground text-sm">Searching…</div>}

      {assets.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed py-12 text-center">
          <p className="text-muted-foreground">No assets found</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Upload your first image or video to get started
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {assets.map((asset: AssetType) => (
              <div
                key={asset.id}
                onClick={() => handleAssetOpen(asset.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleAssetOpen(asset.id);
                  }
                }}
                role="button"
                tabIndex={0}
                className="bg-muted hover:ring-primary focus-visible:ring-primary group relative aspect-square cursor-pointer overflow-hidden rounded-lg border transition-all hover:ring-2 focus-visible:outline-none focus-visible:ring-2"
              >
                <img
                  src={asset.thumbnailUrl || asset.url}
                  alt={asset.altText || asset.fileName}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 flex items-end bg-black/60 p-3 opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="w-full truncate text-sm text-white">
                    {asset.title || asset.fileName}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="ring-offset-background focus-visible:ring-ring border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-muted-foreground text-sm">
                Page {page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                className="ring-offset-background focus-visible:ring-ring border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
