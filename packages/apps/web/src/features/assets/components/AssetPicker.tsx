import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { assetsApi, type AssetType } from '@/features/assets/api/client';

export interface AssetPickerProps {
  onSelect: (asset: AssetType) => void;
  onClose: () => void;
  brandId: string;
  type?: 'image' | 'video';
}

export default function AssetPicker({ onSelect, onClose, brandId, type }: AssetPickerProps) {
  const [selectedAsset, setSelectedAsset] = useState<AssetType | null>(null);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['assets-picker', brandId, search, type],
    queryFn: () => assetsApi.listAssets({ brandId, limit: 50, search, type }),
  });

  const assets = data?.assets || [];

  useEffect(() => {
    if (selectedAsset) onSelect(selectedAsset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAsset]);

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

  return (
    <div className="pl-assets">
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        data-pl-asset-picker="open"
      >
        <div className="bg-background flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col rounded-lg border shadow-lg">
          <div className="flex shrink-0 items-center justify-between border-b p-4">
            <h2 className="text-2xl font-bold">Choose Asset</h2>
            <button
              onClick={onClose}
              className="ring-offset-background focus-visible:ring-ring hover:bg-accent hover:text-accent-foreground inline-flex h-8 items-center justify-center rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Close
            </button>
          </div>

          <div className="overflow-y-auto p-4">
            <input
              type="text"
              placeholder="Search assets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring mb-4 flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            />

            {/* Assets Grid */}
            {isLoading ? (
              <div className="flex h-64 items-center justify-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
              </div>
            ) : assets.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed py-12 text-center">
                <p className="text-muted-foreground">No assets found</p>
                <p className="text-muted-foreground mt-2 text-sm">
                  Upload images or videos to your asset library first
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {assets.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => setSelectedAsset(asset)}
                    className={
                      'group relative aspect-square overflow-hidden rounded-lg border transition-all ' +
                      (selectedAsset?.id === asset.id
                        ? 'ring-primary ring-2'
                        : 'hover:ring-primary hover:ring-2')
                    }
                  >
                    {asset.fileType === 'video' ? (
                      <div className="relative h-full w-full">
                        <video
                          src={asset.thumbnailUrl || asset.url}
                          className="h-full w-full object-cover"
                          muted
                          playsInline
                        />
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <div className="rounded-full bg-black/60 p-2">
                            <span className="text-sm font-semibold text-white">▶</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <img
                        src={asset.thumbnailUrl || asset.url}
                        alt={asset.altText || asset.fileName}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    )}
                    <div className="absolute inset-0 flex items-end bg-black/60 p-3 opacity-0 transition-opacity group-hover:opacity-100">
                      <div className="w-full truncate text-sm text-white">
                        {asset.title || asset.fileName}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t p-4">
            <button
              onClick={onClose}
              className="ring-offset-background focus-visible:ring-ring border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Cancel
            </button>
            <button
              onClick={() => selectedAsset && onSelect(selectedAsset)}
              disabled={!selectedAsset}
              className="ring-offset-background focus-visible:ring-ring bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
