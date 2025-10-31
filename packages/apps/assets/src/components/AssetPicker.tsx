import { useQuery } from '@tanstack/react-query';
import { assetsApi, type Asset } from '../lib/api';
import { useState } from 'react';

interface AssetPickerProps {
  onSelect: (asset: Asset) => void;
  onClose: () => void;
  brandId: string;
}

export default function AssetPicker({ onSelect, onClose, brandId }: AssetPickerProps) {
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['assets-picker', brandId, search],
    queryFn: () => assetsApi.listAssets({ brandId, limit: 50, search, type: 'image' }),
    enabled: !!brandId,
  });

  const assets = data?.assets || [];

  const handleSelect = () => {
    if (selectedAsset) {
      onSelect(selectedAsset);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-background mx-4 flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Choose Asset</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center text-2xl"
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search assets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          />
        </div>

        {/* Assets Grid */}
        <div className="mb-4 flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
            </div>
          ) : assets.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed py-12 text-center">
              <p className="text-muted-foreground">No images found</p>
              <p className="text-muted-foreground mt-2 text-sm">
                Upload images to your asset library first
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => setSelectedAsset(asset)}
                  className={`aspect-square overflow-hidden rounded-lg transition-all ${
                    selectedAsset?.id === asset.id
                      ? 'ring-primary ring-4'
                      : 'hover:ring-primary/50 hover:ring-2'
                  }`}
                >
                  <img
                    src={asset.thumbnailUrl || asset.url}
                    alt={asset.altText || asset.fileName}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t pt-4">
          <button
            onClick={onClose}
            className="ring-offset-background focus-visible:ring-ring border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            onClick={handleSelect}
            disabled={!selectedAsset}
            className="ring-offset-background focus-visible:ring-ring bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
}
