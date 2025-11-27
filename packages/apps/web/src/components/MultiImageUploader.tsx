import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { assetsApi } from '@/features/assets/api/client';
import { VideoUploadClient, type UploadProgress } from '@/lib/api/video-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MediaCard } from '@/components/MediaCard';
import { ChooseFromAssetsButton } from '@/components/ChooseFromAssetsButton';

export interface AssetReference {
  id: string; // Asset ID from Assets database
  url: string; // CDN URL
}

interface MultiImageUploaderProps {
  value: AssetReference[]; // Array of asset references
  onChange: (assets: AssetReference[]) => void;
  brandId: string;
  className?: string;
  maxImages?: number;
  maxSizeInMB?: number;
  /** When false, disables direct uploads/dropzones and only renders existing media cards. */
  enableUpload?: boolean;
  /** Optional handler to surface a "Choose from Assets" button under the main dropzone. */
  onChooseFromAssets?: () => void;
  // Optional video support: when provided, users can upload either images OR a single video.
  videoUrl?: string;
  onVideoChange?: (url: string) => void;
  maxVideoSizeInMB?: number;
  acceptedVideoFormats?: string[];
}

interface ImageItem {
  id?: string; // Asset ID (only set after successful upload)
  url: string;
  file?: File;
  uploading?: boolean;
}

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
}: MultiImageUploaderProps) {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const draggedIndexRef = useRef<number | null>(null);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep internal images state in sync with parent value
  useEffect(() => {
    setImages(value.map((asset) => ({ id: asset.id, url: asset.url })));
  }, [value]);

  const hasImages = images.length > 0;
  const hasVideo = Boolean(videoUrl);
  const hasUploadingImages = images.some((i) => i.uploading);
  const isUploadInProgress = isUploadingVideo || hasUploadingImages;

  const resetError = () => setError(null);

  const handleImageFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;

    // Prevent mixing media types if a video is already selected
    if (hasVideo) {
      setError('Mixed media is not allowed. Remove the video before adding images.');
      return;
    }

    const fileArray = Array.from(files);
    const validFiles = fileArray.filter((file) => {
      if (!file.type.startsWith('image/')) {
        window.alert(`${file.name} is not an image file`);
        return false;
      }
      const sizeInMB = file.size / (1024 * 1024);
      if (sizeInMB > maxSizeInMB) {
        window.alert(`${file.name} exceeds ${maxSizeInMB}MB limit`);
        return false;
      }
      return true;
    });

    if (images.length + validFiles.length > maxImages) {
      window.alert(`Maximum ${maxImages} images allowed`);
      return;
    }

    // Add files with preview URLs
    const newImages: ImageItem[] = validFiles.map((file) => ({
      url: URL.createObjectURL(file),
      file,
      uploading: true,
    }));

    setImages([...images, ...newImages]);

    // Upload files
    const uploadPromises = validFiles.map(async (file, index) => {
      try {
        // Step 1: Get presigned upload URL
        const uploadInfo = await assetsApi.getUploadUrl({
          brandId,
          fileName: file.name,
          contentType: file.type,
          fileType: 'image',
          fileSize: file.size,
        });

        // Step 2: Upload to S3
        await assetsApi.uploadToS3(file, uploadInfo.uploadUrl);

        // Step 3: Create asset metadata and get CDN URL
        const asset = await assetsApi.createAsset({
          brandId,
          fileName: file.name,
          s3Key: uploadInfo.s3Key,
          fileSize: file.size,
          mimeType: file.type,
          fileType: 'image',
        });

        const assetId = asset.asset.id;
        const cdnUrl = asset.asset.url;

        // Update the image with the asset ID and CDN URL
        setImages((prev) => {
          const updated = [...prev];
          const imageIndex = images.length + index;
          if (updated[imageIndex]) {
            updated[imageIndex] = { id: assetId, url: cdnUrl, uploading: false };
          }
          return updated;
        });

        return { id: assetId, url: cdnUrl };
      } catch (error) {
        console.error('Failed to upload image:', error);
        // Remove failed upload
        setImages((prev) => prev.filter((_, i) => i !== images.length + index));
        return null;
      }
    });

    const uploadedAssets = await Promise.all(uploadPromises);
    const successfulAssets = uploadedAssets.filter(
      (asset): asset is AssetReference => asset !== null
    );

    // Update parent with all asset references (existing + new)
    const allAssets = [
      ...images
        .filter((img) => !img.uploading && img.id)
        .map((img) => ({ id: img.id!, url: img.url })),
      ...successfulAssets,
    ];
    onChange(allAssets);

    // Clear any existing video when switching to images
    if (successfulAssets.length > 0 && onVideoChange) {
      onVideoChange('');
    }
  };

  const handleVideoFile = useCallback(
    async (file: File) => {
      resetError();

      if (!acceptedVideoFormats.includes(file.type)) {
        setError(
          `Invalid video type. Accepted formats: ${acceptedVideoFormats
            .map((f) => f.split('/')[1])
            .join(', ')}`
        );
        return;
      }

      const sizeInMB = file.size / (1024 * 1024);
      if (sizeInMB > maxVideoSizeInMB) {
        setError(
          `Video size exceeds ${maxVideoSizeInMB}MB limit. Current size: ${sizeInMB.toFixed(2)}MB`
        );
        return;
      }

      if (!onVideoChange) {
        setError('Video upload is not enabled in this context.');
        return;
      }

      setIsUploadingVideo(true);
      setVideoUploadProgress(null);

      try {
        const { cdnUrl } = await VideoUploadClient.uploadVideo(file, brandId, (progress) => {
          setVideoUploadProgress(progress);
        });

        onVideoChange(cdnUrl);
        // Clear images when switching to video
        setImages([]);
        onChange([]);
      } catch (err) {
        console.error('Failed to upload video', err);
        setError(
          err instanceof Error ? err.message : 'Failed to upload video. Please try again later.'
        );
      } finally {
        setIsUploadingVideo(false);
        setVideoUploadProgress(null);
      }
    },
    [acceptedVideoFormats, brandId, hasImages, maxVideoSizeInMB, onChange, onVideoChange]
  );

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;

    resetError();

    const fileArray = Array.from(files);
    const imageFiles = fileArray.filter((f) => f.type.startsWith('image/'));
    const videoFiles = fileArray.filter((f) => f.type.startsWith('video/'));

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
    const newImages = images.filter((_, i) => i !== index);
    setImages(newImages);
    onChange(
      newImages
        .filter((img) => !img.uploading && img.id)
        .map((img) => ({ id: img.id!, url: img.url }))
    );
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    draggedIndexRef.current = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Some browsers require data to be set for drag to start
      e.dataTransfer.setData('text/plain', String(index));
    }
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    const currentIndex = draggedIndexRef.current;
    if (currentIndex === null || currentIndex === index) return;

    setImages((prev) => {
      const updated = [...prev];
      const draggedImage = updated[currentIndex];
      if (!draggedImage) return prev;

      updated.splice(currentIndex, 1);
      updated.splice(index, 0, draggedImage);
      return updated;
    });

    draggedIndexRef.current = index;
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    draggedIndexRef.current = null;
    setImages((prev) => {
      onChange(
        prev.filter((img) => !img.uploading && img.id).map((img) => ({ id: img.id!, url: img.url }))
      );
      return prev;
    });
  };

  const isUploadDisabled = isUploadInProgress || hasVideo || !enableUpload;

  const handleDropzoneClick = () => {
    if (isUploadDisabled) return;
    fileInputRef.current?.click();
  };

  const handleDropzoneDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isUploadDisabled) return;
    setIsDragging(true);
  };

  const handleDropzoneDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDropzoneDrop = (e: React.DragEvent) => {
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

  const renderDropzone = (variant: 'full' | 'card') => {
    const baseClasses =
      'relative cursor-pointer rounded-lg border-2 border-dashed text-center transition-all';
    const activeBorderClasses = isDragging
      ? 'border-ring bg-muted'
      : 'border-border hover:border-foreground/30 border';
    const disabledClasses = isUploadInProgress ? 'cursor-not-allowed opacity-75' : '';

    if (variant === 'full') {
      return (
        <div
          className={cn(baseClasses, activeBorderClasses, disabledClasses, 'p-4')}
          onClick={handleDropzoneClick}
          onDragOver={handleDropzoneDragOver}
          onDragLeave={handleDropzoneDragLeave}
          onDrop={handleDropzoneDrop}
        >
          <div className="flex flex-col items-center space-y-4">
            {isUploadingVideo && videoUploadProgress ? (
              <>
                <div className="border-foreground h-10 w-10 animate-spin rounded-full border-b-2" />
                <p className="text-muted-foreground text-sm">
                  Uploading video... {videoUploadProgress.percentage}%
                </p>
                <div className="w-full max-w-xs">
                  <Progress value={videoUploadProgress.percentage} className="h-2" />
                </div>
              </>
            ) : (
              <>
                <Upload className="text-muted-foreground h-8 w-8" />
                <div>
                  <p className="text-foreground text-sm font-medium">
                    Drop images or a video here, or click to browse
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Images: up to {maxImages} (max {maxSizeInMB}MB each). Video: MP4/MOV/MPEG (max{' '}
                    {maxVideoSizeInMB}MB).
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      );
    }

    // Compact card-style dropzone (used when at least one image exists)
    return (
      <button
        type="button"
        className={cn(
          baseClasses,
          activeBorderClasses,
          disabledClasses,
          'bg-muted flex aspect-square flex-col items-center justify-center border text-xs'
        )}
        onClick={handleDropzoneClick}
        onDragOver={handleDropzoneDragOver}
        onDragLeave={handleDropzoneDragLeave}
        onDrop={handleDropzoneDrop}
      >
        <Upload className="text-muted-foreground mb-1 h-6 w-6" />
        <span className="text-foreground font-medium">Add media</span>
        <span className="text-muted-foreground mt-0.5 text-[10px]">
          Images only · {images.length}/{maxImages}
        </span>
      </button>
    );
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

      {/* Media layout */}
      {/* Case 1: No media yet -> full-width dropzone */}
      {!hasImages && !hasVideo && enableUpload && renderDropzone('full')}

      {/* Case 2: Video selected -> single card with controls, upload disabled */}
      {hasVideo && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <MediaCard
            type="video"
            src={videoUrl ?? ''}
            index={0}
            showOrderBadge
            draggable={false}
            onRemove={
              onVideoChange
                ? () => {
                    onVideoChange('');
                    resetError();
                  }
                : undefined
            }
            isUploading={isUploadingVideo}
            progressPercent={videoUploadProgress?.percentage}
            showDragHandle={false}
          />
        </div>
      )}

      {/* Case 3: One or more images -> grid of images plus compact upload card */}
      {hasImages && !hasVideo && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {images.map((image, index) => (
            <MediaCard
              key={`${image.url}-${index}`}
              type="image"
              src={image.url}
              index={index}
              alt={`Upload ${index + 1}`}
              draggable={!image.uploading}
              onDragStart={(event) => handleDragStart(event, index)}
              onDragOver={(event) => handleDragOver(event, index)}
              onDragEnd={handleDragEnd}
              onRemove={!image.uploading ? () => handleRemove(index) : undefined}
              isUploading={image.uploading}
              className={cn(draggedIndex === index && 'opacity-50')}
            />
          ))}

          {/* Upload card as the last item when more images are allowed */}
          {enableUpload && images.length < maxImages && renderDropzone('card')}
        </div>
      )}

      {enableUpload && onChooseFromAssets && (
        <ChooseFromAssetsButton onClick={onChooseFromAssets} />
      )}
    </div>
  );
}
