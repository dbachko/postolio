import React, { useState, useCallback, useRef } from 'react';
import { Upload, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { VideoUploadClient, type UploadProgress } from '@/lib/api/video-client';
import { MediaCard } from '@/components/MediaCard';

interface VideoUploaderProps {
  value?: string;
  onChange: (url: string) => void;
  brandId: string;
  className?: string;
  maxSizeInMB?: number;
  acceptedFormats?: string[];
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  allowedAspectRatios?: { label: string; width: number; height: number }[];
}

export function VideoUploader({
  value,
  onChange,
  brandId,
  className,
  maxSizeInMB = 300, // Instagram limit
  acceptedFormats = ['video/mp4', 'video/quicktime', 'video/mpeg'],
  minDurationSeconds,
  maxDurationSeconds,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  allowedAspectRatios,
}: VideoUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>(value || '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update preview when value changes
  React.useEffect(() => {
    if (value && !selectedFile) {
      setPreviewUrl(value);
    }
  }, [value, selectedFile]);

  // Extract video duration when video loads
  const handleVideoLoad = useCallback(
    (video: HTMLVideoElement | null) => {
      if (!video) return;

      const width = video.videoWidth;
      const height = video.videoHeight;
      const duration = video.duration;

      const metadataErrors: string[] = [];

      if (Number.isFinite(duration)) {
        if (typeof minDurationSeconds === 'number' && duration < minDurationSeconds) {
          metadataErrors.push(
            `Video is too short. Instagram reels require at least ${minDurationSeconds} seconds.`
          );
        }
        if (typeof maxDurationSeconds === 'number' && duration > maxDurationSeconds) {
          metadataErrors.push(
            `Video is too long. Instagram reels support up to ${maxDurationSeconds} seconds.`
          );
        }
      }

      if (width > 0 && height > 0) {
        if (typeof minWidth === 'number' && width < minWidth) {
          metadataErrors.push(
            `Video width is too small (${Math.round(width)}px). Minimum recommended width is ${minWidth}px.`
          );
        }
        if (typeof minHeight === 'number' && height < minHeight) {
          metadataErrors.push(
            `Video height is too small (${Math.round(height)}px). Minimum recommended height is ${minHeight}px.`
          );
        }
        if (typeof maxWidth === 'number' && width > maxWidth) {
          metadataErrors.push(
            `Video width is too large (${Math.round(width)}px). Maximum supported width is ${maxWidth}px.`
          );
        }
        if (typeof maxHeight === 'number' && height > maxHeight) {
          metadataErrors.push(
            `Video height is too large (${Math.round(height)}px). Maximum supported height is ${maxHeight}px.`
          );
        }

        if (allowedAspectRatios && allowedAspectRatios.length > 0) {
          const ratio = width / height;
          const normalized = allowedAspectRatios.map((r) => ({
            label: r.label,
            value: r.width / r.height,
          }));
          const closest = normalized.reduce<{ label: string; value: number; diff: number }>(
            (best, current) => {
              const diff = Math.abs(current.value - ratio);
              return diff < best.diff ? { ...current, diff } : best;
            },
            { label: normalized[0].label, value: normalized[0].value, diff: Infinity }
          );

          const tolerance = 0.03;
          if (closest.diff > tolerance) {
            const labels = allowedAspectRatios.map((r) => r.label).join(', ');
            metadataErrors.push(
              `Unusual aspect ratio detected. Instagram works best with ${labels}. Your video is approximately ${(
                width / height
              ).toFixed(2)}:1 (${Math.round(width)}×${Math.round(height)}).`
            );
          }
        }
      }

      if (metadataErrors.length > 0) {
        setError(metadataErrors.join(' '));
      } else {
        setError((prev) =>
          prev && prev.toLowerCase().includes('video') && prev.toLowerCase().includes('instagram')
            ? null
            : prev
        );
      }
    },
    [
      allowedAspectRatios,
      maxDurationSeconds,
      maxHeight,
      maxWidth,
      minDurationSeconds,
      minHeight,
      minWidth,
    ]
  );

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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MediaCard
            type="video"
            src={previewUrl}
            index={0}
            showOrderBadge
            draggable={false}
            onRemove={handleRemoveVideo}
            isUploading={isUploading}
            progressPercent={uploadProgress?.percentage}
            showDragHandle={false}
            onVideoLoaded={handleVideoLoad}
            onVideoError={() => {
              if (!selectedFile) {
                // eslint-disable-next-line no-console
                console.error('Failed to load existing video preview', previewUrl);
                return;
              }

              setError('Failed to load video preview');
              setPreviewUrl('');
            }}
          />
        </div>
      )}
    </div>
  );
}
