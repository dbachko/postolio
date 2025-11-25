import { useState, useRef, useCallback } from 'react';
import { Upload, X, GripVertical, Video as VideoIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { assetsApi } from '@/features/assets/api/client';
import { VideoUploadClient, type UploadProgress } from '@/lib/api/video-client';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
  videoUrl,
  onVideoChange,
  maxVideoSizeInMB = 300,
  acceptedVideoFormats = ['video/mp4', 'video/quicktime', 'video/mpeg'],
}: MultiImageUploaderProps) {
  const [images, setImages] = useState<ImageItem[]>(
    value.map((asset) => ({ id: asset.id, url: asset.url }))
  );
  const [isDragging, setIsDragging] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetError = () => setError(null);

  const handleImageFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;

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
    [acceptedVideoFormats, brandId, maxVideoSizeInMB, onChange, onVideoChange]
  );

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const imageFiles = fileArray.filter((f) => f.type.startsWith('image/'));
    const videoFiles = fileArray.filter((f) => f.type.startsWith('video/'));

    if (imageFiles.length > 0 && videoFiles.length > 0) {
      setError('Please upload either images or a video, not both at the same time.');
      return;
    }

    if (videoFiles.length > 0) {
      if (images.length > 0) {
        setError('Remove existing images before uploading a video.');
        return;
      }
      // Only support a single video file
      await handleVideoFile(videoFiles[0]);
      return;
    }

    if (imageFiles.length > 0) {
      if (videoUrl) {
        setError('Remove the existing video before uploading images.');
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

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newImages = [...images];
    const draggedImage = newImages[draggedIndex];
    newImages.splice(draggedIndex, 1);
    newImages.splice(index, 0, draggedImage);

    setImages(newImages);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    onChange(
      images.filter((img) => !img.uploading && img.id).map((img) => ({ id: img.id!, url: img.url }))
    );
  };

  return (
    <div className={cn('space-y-3', className)}>
      {/* Error message */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Hidden file input (images or video) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files)}
      />

      {/* Unified dropzone / click area */}
      <div
        className={cn(
          'relative cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-all',
          isDragging ? 'border-ring bg-muted' : 'border-border hover:border-foreground/30 border',
          (isUploadingVideo || images.some((i) => i.uploading)) && 'cursor-not-allowed opacity-75'
        )}
        onClick={() => {
          if (isUploadingVideo || images.some((i) => i.uploading)) return;
          fileInputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isUploadingVideo || images.some((i) => i.uploading)) return;
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
          if (isUploadingVideo || images.some((i) => i.uploading)) return;
          void handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="flex flex-col items-center space-y-2">
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
        </div>
      </div>

      {/* Video preview */}
      {videoUrl && (
        <div className="space-y-2">
          <div className="bg-muted relative overflow-hidden rounded-lg">
            {isUploadingVideo && videoUploadProgress && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 text-white">
                <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-white" />
                <p className="text-sm">Uploading video... {videoUploadProgress.percentage}%</p>
              </div>
            )}
            <video src={videoUrl} controls className="h-full w-full object-contain" />
          </div>
          <div className="flex justify-between gap-2">
            <div className="text-muted-foreground flex items-center text-xs">
              <VideoIcon className="mr-1 h-3 w-3" />
              <span>Video selected</span>
            </div>
            {onVideoChange && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => {
                  onVideoChange('');
                  resetError();
                }}
                disabled={isUploadingVideo}
              >
                <X className="mr-1 h-4 w-4" />
                Remove video
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Image Grid */}
      {!videoUrl && images.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image, index) => (
            <div
              key={`${image.url}-${index}`}
              draggable={!image.uploading}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={cn(
                'group bg-muted relative aspect-square overflow-hidden rounded-lg border',
                !image.uploading && 'cursor-move',
                draggedIndex === index && 'opacity-50'
              )}
            >
              {/* Order Badge */}
              <div className="absolute top-2 left-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-medium text-white">
                {index + 1}
              </div>

              {/* Drag Handle */}
              {!image.uploading && (
                <div className="absolute top-2 right-2 z-10 rounded bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <GripVertical className="h-4 w-4 text-white" />
                </div>
              )}

              {/* Remove Button */}
              {!image.uploading && (
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="absolute right-2 bottom-2 z-10 rounded-full bg-red-500 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}

              {/* Image */}
              <img
                src={image.url}
                alt={`Upload ${index + 1}`}
                className="h-full w-full object-cover"
              />

              {/* Uploading Overlay */}
              {image.uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-white border-t-transparent" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
