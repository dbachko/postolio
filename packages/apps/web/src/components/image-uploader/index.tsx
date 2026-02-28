import { AlertCircle, Image as ImageIcon, Upload, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useImageUploader } from './hooks/use-image-uploader';
import type { ImageUploaderProps } from './types';

function UploaderDropzone({
  isDragging,
  isUploading,
  maxSizeInMB,
  onClick,
}: {
  isDragging: boolean;
  isUploading: boolean;
  maxSizeInMB: number;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-all',
        isDragging ? 'border-ring bg-muted' : 'border-border hover:border-foreground/30 border',
        isUploading && 'cursor-not-allowed opacity-50'
      )}
    >
      <div className="flex flex-col items-center space-y-4">
        {isUploading ? (
          <>
            <div className="border-foreground h-12 w-12 animate-spin rounded-full border-b-2" />
            <p className="text-muted-foreground text-sm">Uploading image...</p>
          </>
        ) : (
          <>
            <Upload className="text-muted-foreground h-12 w-12" />
            <div>
              <p className="text-foreground text-sm font-medium">
                Drop your image here or click to browse
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Supports: JPEG, PNG, WebP, GIF (max {maxSizeInMB}MB)
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReplaceImageOverlay({ isDragging }: { isDragging: boolean }) {
  if (!isDragging) {
    return null;
  }

  return (
    <div className="bg-primary/90 absolute inset-0 z-20 flex items-center justify-center rounded-lg">
      <div className="text-center text-white">
        <Upload className="mx-auto mb-2 h-12 w-12" />
        <p className="text-sm font-medium">Drop to replace image</p>
      </div>
    </div>
  );
}

function UploadingOverlay({ isUploading }: { isUploading: boolean }) {
  if (!isUploading) {
    return null;
  }

  return (
    <div className="bg-opacity-50 absolute inset-0 z-10 flex items-center justify-center bg-black">
      <div className="text-center text-white">
        <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-white" />
        <p className="text-sm">Uploading...</p>
      </div>
    </div>
  );
}

function PreviewActions({
  isUploading,
  onReplace,
  onRemove,
}: {
  isUploading: boolean;
  onReplace: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="pointer-events-auto space-x-2 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onReplace}
          disabled={isUploading}
          className="shadow-lg"
        >
          <Upload className="mr-1 h-4 w-4" />
          Replace
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onRemove}
          disabled={isUploading}
          className="shadow-lg"
        >
          <X className="mr-1 h-4 w-4" />
          Remove
        </Button>
      </div>
    </div>
  );
}

function ImagePreview({
  previewUrl,
  selectedFile,
  isDragging,
  isUploading,
  onPreviewError,
  onClickUpload,
  onRemoveImage,
}: {
  previewUrl: string;
  selectedFile: File | null;
  isDragging: boolean;
  isUploading: boolean;
  onPreviewError: () => void;
  onClickUpload: () => void;
  onRemoveImage: () => void;
}) {
  return (
    <div className="group relative">
      <ReplaceImageOverlay isDragging={isDragging} />
      <div className="bg-muted relative aspect-square overflow-hidden rounded-lg">
        <UploadingOverlay isUploading={isUploading} />
        <img
          src={previewUrl}
          alt="Preview"
          className="h-full w-full object-cover"
          onError={onPreviewError}
        />
        <PreviewActions
          isUploading={isUploading}
          onReplace={onClickUpload}
          onRemove={onRemoveImage}
        />
      </div>

      {selectedFile ? (
        <div className="text-muted-foreground mt-2 text-xs">
          <p>File: {selectedFile.name}</p>
          <p>Size: {(selectedFile.size / (1024 * 1024)).toFixed(2)}MB</p>
        </div>
      ) : null}
    </div>
  );
}

export function ImageUploader({
  value,
  onChange,
  onUpload,
  className,
  maxSizeInMB = 10,
  acceptedFormats = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
}: ImageUploaderProps) {
  const {
    error,
    fileInputRef,
    handleClickUpload,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileSelect,
    handlePreviewError,
    handleRemoveImage,
    isDragging,
    isUploading,
    previewUrl,
    selectedFile,
  } = useImageUploader({
    value,
    onChange,
    onUpload,
    maxSizeInMB,
    acceptedFormats,
  });

  return (
    <div
      className={cn('space-y-4', className)}
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

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!previewUrl ? (
        <UploaderDropzone
          isDragging={isDragging}
          isUploading={isUploading}
          maxSizeInMB={maxSizeInMB}
          onClick={handleClickUpload}
        />
      ) : (
        <ImagePreview
          previewUrl={previewUrl}
          selectedFile={selectedFile}
          isDragging={isDragging}
          isUploading={isUploading}
          onPreviewError={handlePreviewError}
          onClickUpload={handleClickUpload}
          onRemoveImage={handleRemoveImage}
        />
      )}

      {previewUrl && !isUploading ? (
        <div className="text-muted-foreground flex items-center justify-center text-sm">
          <ImageIcon className="mr-1 h-4 w-4" />
          <span>Image ready for post</span>
        </div>
      ) : null}
    </div>
  );
}
