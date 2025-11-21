import { useState, useRef } from 'react';
import { Upload, X, GripVertical, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { assetsApi } from '@/features/assets/api/client';

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
}: MultiImageUploaderProps) {
  const [images, setImages] = useState<ImageItem[]>(
    value.map((asset) => ({ id: asset.id, url: asset.url }))
  );
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const validFiles = fileArray.filter((file) => {
      if (!file.type.startsWith('image/')) {
        alert(`${file.name} is not an image file`);
        return false;
      }
      const sizeInMB = file.size / (1024 * 1024);
      if (sizeInMB > maxSizeInMB) {
        alert(`${file.name} exceeds ${maxSizeInMB}MB limit`);
        return false;
      }
      return true;
    });

    if (images.length + validFiles.length > maxImages) {
      alert(`Maximum ${maxImages} images allowed`);
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
      {/* Upload Button */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={images.length >= maxImages}
        >
          <Upload className="mr-2 h-4 w-4" />
          Add Images ({images.length}/{maxImages})
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
        />
        {images.length > 0 && (
          <span className="text-muted-foreground text-sm">Drag to reorder</span>
        )}
      </div>

      {/* Image Grid */}
      {images.length > 0 ? (
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
      ) : (
        <div className="border-muted-foreground/25 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center">
          <ImageIcon className="text-muted-foreground mb-2 h-10 w-10" />
          <p className="text-muted-foreground text-sm">No images added yet</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Add 2-{maxImages} images to create a carousel
          </p>
        </div>
      )}
    </div>
  );
}
