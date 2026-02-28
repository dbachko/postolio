import { AlertCircle } from 'lucide-react';
import type { ChangeEventHandler, RefObject } from 'react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { UploadProgress } from '@/lib/api/video-client';
import type { VideoUploaderProps } from './types';
import { UploadArea } from './components/upload-area';
import { VideoPreview } from './components/video-preview';
import { useVideoUploaderState } from './hooks/use-video-uploader-state';

function VideoUploaderFileInput({
  fileInputRef,
  acceptedFormats,
  onChange,
  disabled,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  acceptedFormats: string[];
  onChange: ChangeEventHandler<HTMLInputElement>;
  disabled: boolean;
}) {
  return (
    <input
      ref={fileInputRef}
      type="file"
      accept={acceptedFormats.join(',')}
      onChange={onChange}
      className="hidden"
      disabled={disabled}
    />
  );
}

function VideoUploaderError({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function VideoUploaderBody({
  previewUrl,
  isDragging,
  isUploading,
  uploadProgress,
  maxSizeInMB,
  headline,
  subtext,
  selectedFile,
  onClick,
  onRemove,
  onVideoLoaded,
  onVideoError,
}: {
  previewUrl: string | null;
  isDragging: boolean;
  isUploading: boolean;
  uploadProgress: UploadProgress | null;
  maxSizeInMB: number;
  headline?: string;
  subtext?: string;
  selectedFile: File | null;
  onClick: () => void;
  onRemove: () => void;
  onVideoLoaded: (video: HTMLVideoElement | null) => void;
  onVideoError: () => void;
}) {
  if (!previewUrl) {
    return (
      <UploadArea
        isDragging={isDragging}
        isUploading={isUploading}
        uploadProgress={uploadProgress}
        maxSizeInMB={maxSizeInMB}
        headline={headline}
        subtext={subtext}
        onClick={onClick}
      />
    );
  }
  return (
    <VideoPreview
      previewUrl={previewUrl}
      isUploading={isUploading}
      uploadProgress={uploadProgress}
      selectedFile={selectedFile}
      onRemove={onRemove}
      onVideoLoaded={onVideoLoaded}
      onVideoError={onVideoError}
    />
  );
}

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
      <VideoUploaderFileInput
        fileInputRef={fileInputRef}
        acceptedFormats={acceptedFormats}
        onChange={handleFileSelect}
        disabled={isUploading}
      />
      <VideoUploaderError error={error} />
      <VideoUploaderBody
        previewUrl={previewUrl}
        isDragging={isDragging}
        isUploading={isUploading}
        uploadProgress={uploadProgress}
        maxSizeInMB={maxSizeInMB}
        headline={headline}
        subtext={subtext}
        selectedFile={selectedFile}
        onClick={handleClickUpload}
        onRemove={handleRemoveVideo}
        onVideoLoaded={handleVideoLoad}
        onVideoError={handlePreviewError}
      />
    </div>
  );
}
