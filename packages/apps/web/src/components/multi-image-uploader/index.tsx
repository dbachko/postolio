import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChooseFromAssetsButton } from '@/components/choose-from-assets-button';

import type { MultiImageUploaderProps } from './types';
import { MediaUploaderLayout } from './components/media-uploader-layout';
import { useMultiImageUploaderController } from './hooks/use-multi-image-uploader-controller';

export function MultiImageUploader({
  value,
  onChange,
  brandId,
  className,
  maxImages = 10,
  maxSizeInMB = 10,
  enableUpload = true,
  onChooseFromAssets,
  videoUrl,
  onVideoChange,
  maxVideoSizeInMB = 300,
  acceptedVideoFormats = ['video/mp4', 'video/quicktime', 'video/mpeg'],
  allowMixedMedia = false,
}: MultiImageUploaderProps) {
  const controller = useMultiImageUploaderController({
    value,
    onChange,
    brandId,
    maxImages,
    maxSizeInMB,
    allowMixedMedia,
    videoUrl,
    onVideoChange,
    maxVideoSizeInMB,
    acceptedVideoFormats,
    enableUpload,
  });

  return (
    <div className={cn('space-y-3', className)}>
      {controller.error && enableUpload ? (
        <Alert variant="destructive">
          <AlertDescription>{controller.error}</AlertDescription>
        </Alert>
      ) : null}

      {enableUpload ? (
        <input
          ref={controller.fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void controller.handleFileSelect(event.target.files);
          }}
        />
      ) : null}

      <MediaUploaderLayout
        enableUpload={enableUpload}
        allowMixedMedia={allowMixedMedia}
        maxImages={maxImages}
        maxSizeInMB={maxSizeInMB}
        maxVideoSizeInMB={maxVideoSizeInMB}
        mediaItems={controller.mediaItems}
        hasVideo={controller.hasVideo}
        videoUrl={videoUrl}
        isDragging={controller.isDragging}
        isUploadInProgress={controller.isUploadInProgress}
        isUploadingVideo={controller.isUploadingVideo}
        videoUploadProgress={controller.videoUploadProgress}
        draggedIndex={controller.draggedIndex}
        onDropzoneClick={controller.handleDropzoneClick}
        onDropzoneDragOver={controller.handleDropzoneDragOver}
        onDropzoneDragLeave={controller.handleDropzoneDragLeave}
        onDropzoneDrop={controller.handleDropzoneDrop}
        onDragStart={controller.handleDragStart}
        onDragOver={controller.handleDragOver}
        onDragEnd={controller.handleDragEnd}
        onRemove={controller.handleRemove}
        onVideoChange={onVideoChange}
        onResetError={controller.resetError}
      />

      {enableUpload && onChooseFromAssets ? (
        <ChooseFromAssetsButton onClick={onChooseFromAssets} />
      ) : null}
    </div>
  );
}
