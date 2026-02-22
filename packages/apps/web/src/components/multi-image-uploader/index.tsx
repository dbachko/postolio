import { useState, useRef, useCallback, useEffect, type DragEvent } from 'react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChooseFromAssetsButton } from '@/components/choose-from-assets-button';
import type { MediaItem, MultiImageUploaderProps } from './types';
import { MediaUploaderLayout } from './components/media-uploader-layout';
import { useMediaReorder } from './hooks/use-media-reorder';
import { useImageFilesHandler } from './hooks/use-image-files-handler';
import { useVideoFileHandler } from './hooks/use-video-file-handler';

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
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep internal images state in sync with parent value
  useEffect(() => {
    setMediaItems(
      value.map((asset) => ({
        id: asset.id,
        url: asset.url,
        type: asset.type || 'image',
      }))
    );
  }, [value]);

  const hasImages = mediaItems.some((item) => item.type === 'image');
  const hasVideoAsset = mediaItems.some((item) => item.type === 'video');
  const hasVideo = allowMixedMedia ? hasVideoAsset : Boolean(videoUrl) || hasVideoAsset;
  const hasUploadingMedia = mediaItems.some((i) => i.uploading);

  const resetError = useCallback(() => setError(null), []);

  const emitChange = useCallback(
    (items: MediaItem[]) => {
      onChange(
        items
          .filter((item) => item.id && !item.uploading)
          .map((item) => ({ id: item.id!, url: item.url, type: item.type }))
      );
    },
    [onChange]
  );

  const { draggedIndex, handleDragStart, handleDragOver, handleDragEnd } = useMediaReorder({
    setMediaItems,
    onCommit: emitChange,
  });

  const setErrorMessage = useCallback((message: string) => setError(message), []);

  const handleImageFiles = useImageFilesHandler({
    brandId,
    maxImages,
    maxSizeInMB,
    allowMixedMedia,
    hasVideo,
    mediaItems,
    setError: setErrorMessage,
    setMediaItems,
    emitChange,
    onVideoChange,
  });

  const { handleVideoFile, isUploadingVideo, videoUploadProgress } = useVideoFileHandler({
    brandId,
    acceptedVideoFormats,
    maxVideoSizeInMB,
    allowMixedMedia,
    onChange,
    onVideoChange,
    resetError,
    setError: setErrorMessage,
    setMediaItems,
    emitChange,
  });

  const isUploadInProgress = isUploadingVideo || hasUploadingMedia;

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) {
      return;
    }

    resetError();

    const fileArray = Array.from(files);
    const imageFiles = fileArray.filter((f) => f.type.startsWith('image/'));
    const videoFiles = fileArray.filter((f) => f.type.startsWith('video/'));

    if (allowMixedMedia) {
      if (mediaItems.length + fileArray.length > maxImages) {
        window.alert(`Maximum ${maxImages} media items allowed`);
        return;
      }

      if (imageFiles.length > 0) {
        await handleImageFiles(imageFiles, { allowMixed: true });
      }

      for (const videoFile of videoFiles) {
        await handleVideoFile(videoFile);
      }

      return;
    }

    if (imageFiles.length > 0 && videoFiles.length > 0) {
      setError('Mixed media is not allowed. Please upload either images or a video.');
      return;
    }

    if (videoFiles.length > 0) {
      if (hasImages) {
        setError('Mixed media is not allowed. Remove existing images before uploading a video.');
        return;
      }
      if (hasVideo) {
        setError(
          'Only one video is allowed. Remove the existing video before uploading another media file.'
        );
        return;
      }
      // Only support a single video file
      await handleVideoFile(videoFiles[0]);
      return;
    }

    if (imageFiles.length > 0) {
      if (hasVideo) {
        setError('Mixed media is not allowed. Remove the existing video before uploading images.');
        return;
      }
      await handleImageFiles(imageFiles);
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    await handleFiles(files);
  };

  const handleRemove = (index: number) => {
    const newMedia = mediaItems.filter((_, i) => i !== index);
    setMediaItems(newMedia);
    emitChange(newMedia);
  };

  const isUploadDisabled = isUploadInProgress || (!allowMixedMedia && hasVideo) || !enableUpload;

  const handleDropzoneClick = () => {
    if (isUploadDisabled) {
      return;
    }
    fileInputRef.current?.click();
  };

  const handleDropzoneDragOver = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isUploadDisabled) {
      return;
    }
    setIsDragging(true);
  };

  const handleDropzoneDragLeave = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDropzoneDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isUploadDisabled) {
      if (hasVideo) {
        setError(
          'Only one video is allowed. Remove the existing video before uploading another media file.'
        );
      }
      return;
    }
    void handleFiles(e.dataTransfer.files);
  };

  return (
    <div className={cn('space-y-3', className)}>
      {/* Error message */}
      {error && enableUpload && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Hidden file input (images or video) */}
      {enableUpload && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
        />
      )}

      <MediaUploaderLayout
        enableUpload={enableUpload}
        allowMixedMedia={allowMixedMedia}
        maxImages={maxImages}
        maxSizeInMB={maxSizeInMB}
        maxVideoSizeInMB={maxVideoSizeInMB}
        mediaItems={mediaItems}
        hasVideo={hasVideo}
        videoUrl={videoUrl}
        isDragging={isDragging}
        isUploadInProgress={isUploadInProgress}
        isUploadingVideo={isUploadingVideo}
        videoUploadProgress={videoUploadProgress}
        draggedIndex={draggedIndex}
        onDropzoneClick={handleDropzoneClick}
        onDropzoneDragOver={handleDropzoneDragOver}
        onDropzoneDragLeave={handleDropzoneDragLeave}
        onDropzoneDrop={handleDropzoneDrop}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onRemove={handleRemove}
        onVideoChange={onVideoChange}
        onResetError={resetError}
      />

      {enableUpload && onChooseFromAssets && (
        <ChooseFromAssetsButton onClick={onChooseFromAssets} />
      )}
    </div>
  );
}
