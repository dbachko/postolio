import { ChevronDown } from 'lucide-react';

import type { AssetType } from '@/features/assets/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { DerivedAssetDisplay } from '../types';

type AssetDetailsSectionProps = {
  asset: AssetType;
  derivedDisplay: DerivedAssetDisplay;
  detailsOpen: boolean;
  onToggleDetails: () => void;
};

export function AssetDetailsSection({
  asset,
  derivedDisplay,
  detailsOpen,
  onToggleDetails,
}: AssetDetailsSectionProps) {
  return (
    <div className="rounded-lg border">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-between px-4 py-3 text-left"
        onClick={onToggleDetails}
      >
        <span className="text-lg font-semibold">Asset Details</span>
        <ChevronDown
          className={cn('h-4 w-4 transition-transform', detailsOpen ? 'rotate-180' : '')}
        />
      </Button>

      {detailsOpen ? (
        <div className="border-t px-4 pt-2 pb-4">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-1">
              <dt className="text-muted-foreground">Type</dt>
              <dd className="font-medium capitalize">{asset.fileType}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Format</dt>
              <dd className="font-medium">{derivedDisplay.extension}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">MIME Type</dt>
              <dd className="font-medium">{asset.mimeType}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">File Size</dt>
              <dd className="font-medium">{derivedDisplay.fileSize}</dd>
            </div>
            {asset.fileType === 'image' ? (
              <div className="space-y-1">
                <dt className="text-muted-foreground">Dimensions</dt>
                <dd className="font-medium">
                  {asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}
                </dd>
              </div>
            ) : (
              <div className="space-y-1">
                <dt className="text-muted-foreground">Duration</dt>
                <dd className="font-medium">{asset.duration ? `${asset.duration}s` : '—'}</dd>
              </div>
            )}
            <div className="space-y-1">
              <dt className="text-muted-foreground">Uploaded</dt>
              <dd className="font-medium">{derivedDisplay.createdAt}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Last Updated</dt>
              <dd className="font-medium">{derivedDisplay.updatedAt}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
