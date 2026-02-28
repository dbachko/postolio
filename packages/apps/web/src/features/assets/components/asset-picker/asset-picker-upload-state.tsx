import { Loader2 } from 'lucide-react';
import type { DragEvent } from 'react';
import { Dropzone } from '@/components/multi-image-uploader/components/dropzone';

export function AssetPickerUploadStatus({
  uploadError,
  isUploading,
}: {
  uploadError: string | null;
  isUploading: boolean;
}) {
  return (
    <>
      {uploadError ? (
        <div className="border-destructive/50 bg-destructive/10 text-destructive mb-3 rounded-md border px-3 py-2 text-sm">
          {uploadError}
        </div>
      ) : null}
      {isUploading ? (
        <div className="text-muted-foreground mb-3 flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Uploading files...
        </div>
      ) : null}
    </>
  );
}

export function AssetPickerUploadOverlay({
  isDraggingFiles,
  sortedAssetsCount,
  isUploading,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  isDraggingFiles: boolean;
  sortedAssetsCount: number;
  isUploading: boolean;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  if (!isDraggingFiles) {
    return null;
  }
  return (
    <div className="bg-background/85 pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl">
        <Dropzone
          variant="full"
          allowMixedMedia
          maxImages={10}
          maxSizeInMB={10}
          maxVideoSizeInMB={500}
          mediaItemCount={sortedAssetsCount}
          isDragging
          isUploadInProgress={isUploading}
          isUploadingVideo={false}
          videoUploadProgress={null}
          onClick={() => {}}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        />
      </div>
    </div>
  );
}
