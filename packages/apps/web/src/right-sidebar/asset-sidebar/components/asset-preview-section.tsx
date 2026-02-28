import type { ChangeEvent, RefObject } from 'react';
import { Loader2, Trash2, Upload } from 'lucide-react';

import type { AssetType } from '@/features/assets/api/client';
import { Button } from '@/components/ui/button';

type AssetPreviewSectionProps = {
  asset: AssetType;
  assetPreviewUrl: string;
  previewAlt: string;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  onUploadTrigger: () => void;
  onDeleteAsset: () => void;
  isReplacing: boolean;
  isDeleting: boolean;
};

type PreviewActionsProps = {
  isReplacing: boolean;
  isDeleting: boolean;
  onUploadTrigger: () => void;
  onDeleteAsset: () => void;
};

function AssetPreviewMedia({
  asset,
  assetPreviewUrl,
  previewAlt,
}: Pick<AssetPreviewSectionProps, 'asset' | 'assetPreviewUrl' | 'previewAlt'>) {
  if (asset.fileType === 'video') {
    return (
      <video
        key={assetPreviewUrl}
        controls
        className="h-full w-full object-contain"
        src={assetPreviewUrl}
      />
    );
  }

  return <img src={assetPreviewUrl} alt={previewAlt} className="h-full w-full object-contain" />;
}

function ReplacingOverlay({ isReplacing }: { isReplacing: boolean }) {
  if (!isReplacing) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 text-white">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="mt-2 text-sm">Uploading…</span>
    </div>
  );
}

function PreviewActions({
  isReplacing,
  isDeleting,
  onUploadTrigger,
  onDeleteAsset,
}: PreviewActionsProps) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="pointer-events-auto flex flex-wrap justify-center gap-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onUploadTrigger}
          disabled={isReplacing || isDeleting}
          className="shadow-lg"
        >
          {isReplacing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onDeleteAsset}
          disabled={isDeleting || isReplacing}
          className="shadow-lg"
        >
          {isDeleting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Deleting…
            </>
          ) : (
            <>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export function AssetPreviewSection({
  asset,
  assetPreviewUrl,
  previewAlt,
  uploadInputRef,
  onFileSelection,
  onUploadTrigger,
  onDeleteAsset,
  isReplacing,
  isDeleting,
}: AssetPreviewSectionProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Preview</h3>
        <p className="text-muted-foreground text-sm">
          Replace the source file to update this asset
        </p>
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={onFileSelection}
      />

      <div className="border-border bg-muted/20 group relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-lg border">
        <AssetPreviewMedia
          asset={asset}
          assetPreviewUrl={assetPreviewUrl}
          previewAlt={previewAlt}
        />
        <ReplacingOverlay isReplacing={isReplacing} />
        <PreviewActions
          isReplacing={isReplacing}
          isDeleting={isDeleting}
          onUploadTrigger={onUploadTrigger}
          onDeleteAsset={onDeleteAsset}
        />
      </div>
    </div>
  );
}
