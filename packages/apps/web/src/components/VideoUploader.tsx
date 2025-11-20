import React, { useState, useCallback, useRef } from 'react';
import { Upload, X, Video as VideoIcon, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { VideoUploadClient, type UploadProgress } from '@/lib/api/video-client';

interface VideoUploaderProps {
  value?: string;
  onChange: (url: string) => void;
  brandId: string;
  className?: string;
  maxSizeInMB?: number;
  acceptedFormats?: string[];
}

export function VideoUploader({
  value,
  onChange,
  brandId,
  className,
  maxSizeInMB = 300, // Instagram limit
  acceptedFormats = ['video/mp4', 'video/quicktime', 'video/mpeg'],
}: VideoUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>(value || '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Update preview when value changes
  React.useEffect(() => {
    if (value && !selectedFile) {
      setPreviewUrl(value);
    }
  }, [value, selectedFile]);

  // Extract video duration when video loads
  const handleVideoLoad = useCallback(() => {
    if (videoRef.current) {
      setVideoDuration(videoRef.current.duration);
    }
  }, []);

  const validateFile = useCallback(
    (file: File): string | null => {
      // Check file type
      if (!acceptedFormats.includes(file.type)) {
        return `Invalid file type. Accepted formats: ${acceptedFormats.map((f) => f.split('/')[1]).join(', ')}`;
      }

      // Check file size
      const sizeInMB = file.size / (1024 * 1024);
      if (sizeInMB > maxSizeInMB) {
        return `File size exceeds ${maxSizeInMB}MB limit. Current size: ${sizeInMB.toFixed(2)}MB`;
      }

      return null;
    },
    [acceptedFormats, maxSizeInMB]
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setUploadProgress(null);

      // Validate file
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      // Create preview URL
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);
      setSelectedFile(file);

      // Upload the video using multipart upload
      setIsUploading(true);
      try {
        const { cdnUrl } = await VideoUploadClient.uploadVideo(file, brandId, (progress) => {
          setUploadProgress(progress);
        });

        // Pass the CDN URL back to parent
        onChange(cdnUrl);
        setPreviewUrl(cdnUrl); // Update preview to use CDN URL
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to upload video');
        // Revert preview on error
        setPreviewUrl(value || '');
        setSelectedFile(null);
        URL.revokeObjectURL(objectUrl);
      } finally {
        setIsUploading(false);
        setUploadProgress(null);
      }
    },
    [brandId, value, onChange, validateFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0 && files[0]) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0 && files[0]) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleRemoveVideo = useCallback(() => {
    // Revoke object URL to prevent memory leaks
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }

    // Clear all state
    setPreviewUrl('');
    setSelectedFile(null);
    setError(null);
    setVideoDuration(null);
    setUploadProgress(null);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Notify parent component
    onChange('');
  }, [previewUrl, onChange]);

  const handleClickUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={cn('space-y-4', className)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedFormats.join(',')}
        onChange={handleFileSelect}
        className="hidden"
        disabled={isUploading}
      />

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Upload Area */}
      {!previewUrl ? (
        <div
          onClick={handleClickUpload}
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
                <p className="text-muted-foreground text-sm">
                  Uploading video... {uploadProgress?.percentage || 0}%
                </p>
                {uploadProgress && (
                  <div className="w-full max-w-xs">
                    <Progress value={uploadProgress.percentage} className="h-2" />
                    <p className="text-muted-foreground mt-2 text-xs">
                      Part {uploadProgress.uploadedParts} of {uploadProgress.totalParts}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <Upload className="text-muted-foreground h-12 w-12" />
                <div>
                  <p className="text-foreground text-sm font-medium">
                    Drop your video here or click to browse
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Supports: MP4, MOV, MPEG (max {maxSizeInMB}MB)
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* Video Preview */
        <div className="group relative">
          {/* Drag overlay when dragging over existing video */}
          {isDragging && (
            <div className="bg-primary/90 absolute inset-0 z-20 flex items-center justify-center rounded-lg">
              <div className="text-center text-white">
                <Upload className="mx-auto mb-2 h-12 w-12" />
                <p className="text-sm font-medium">Drop to replace video</p>
              </div>
            </div>
          )}

          <div className="bg-muted relative aspect-video overflow-hidden rounded-lg">
            {/* Loading state for upload progress */}
            {isUploading && uploadProgress && (
              <div className="bg-opacity-50 absolute inset-0 z-10 flex flex-col items-center justify-center bg-black">
                <div className="text-center text-white">
                  <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-white" />
                  <p className="text-sm">Uploading... {uploadProgress.percentage}%</p>
                  <Progress value={uploadProgress.percentage} className="mt-2 h-2 w-48" />
                </div>
              </div>
            )}

            {/* Video */}
            <video
              ref={videoRef}
              src={previewUrl}
              controls
              className="h-full w-full object-contain"
              onLoadedMetadata={handleVideoLoad}
              onError={() => {
                setError('Failed to load video preview');
                if (!selectedFile) {
                  setPreviewUrl('');
                }
              }}
            />

            {/* Actions Overlay */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto space-x-2 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleClickUpload}
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
                  onClick={handleRemoveVideo}
                  disabled={isUploading}
                  className="shadow-lg"
                >
                  <X className="mr-1 h-4 w-4" />
                  Remove
                </Button>
              </div>
            </div>
          </div>

          {/* Video Info */}
          <div className="text-muted-foreground mt-2 text-xs">
            {selectedFile && (
              <>
                <p>File: {selectedFile.name}</p>
                <p>Size: {(selectedFile.size / (1024 * 1024)).toFixed(2)}MB</p>
              </>
            )}
            {videoDuration !== null && <p>Duration: {formatDuration(videoDuration)}</p>}
          </div>
        </div>
      )}

      {/* Status indicator when video is ready */}
      {previewUrl && !isUploading && (
        <div className="text-muted-foreground flex items-center justify-center text-sm">
          <VideoIcon className="mr-1 h-4 w-4" />
          <span>Video ready for post</span>
        </div>
      )}
    </div>
  );
}
