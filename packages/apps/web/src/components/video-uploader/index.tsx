import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { VideoUploaderProps } from './types';
import { UploadArea } from './components/upload-area';
import { VideoPreview } from './components/video-preview';
import { useVideoUploaderState } from './hooks/use-video-uploader-state';

export function VideoUploader({
  value,
  onChange,
  brandId,
  className,
  maxSizeInMB = 300,
  acceptedFormats = ['video/mp4', 'video/quicktime', 'video/mpeg'],
  minDurationSeconds,
  maxDurationSeconds,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  allowedAspectRatios,
  headline,
  subtext,
}: VideoUploaderProps) {
  const {
    error,
    fileInputRef,
    handleClickUpload,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileSelect,
    handlePreviewError,
    handleRemoveVideo,
    handleVideoLoad,
    isDragging,
    isUploading,
    previewUrl,
    selectedFile,
    uploadProgress,
  } = useVideoUploaderState({
    value,
    onChange,
    brandId,
    maxSizeInMB,
    acceptedFormats,
    minDurationSeconds,
    maxDurationSeconds,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    allowedAspectRatios,
  });

  return (
    <div
      className={cn('space-y-3', className)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedFormats.join(',')}
        onChange={handleFileSelect}
        className="hidden"
        disabled={isUploading}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!previewUrl ? (
        <UploadArea
          isDragging={isDragging}
          isUploading={isUploading}
          uploadProgress={uploadProgress}
          maxSizeInMB={maxSizeInMB}
          headline={headline}
          subtext={subtext}
          onClick={handleClickUpload}
        />
      ) : (
        <VideoPreview
          previewUrl={previewUrl}
          isUploading={isUploading}
          uploadProgress={uploadProgress}
          selectedFile={selectedFile}
          onRemove={handleRemoveVideo}
          onVideoLoaded={handleVideoLoad}
          onVideoError={handlePreviewError}
        />
      )}
    </div>
  );
}
