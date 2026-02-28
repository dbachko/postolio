import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { assetsApi } from '@/features/assets/api/client';

import type { AssetReference, MediaItem } from '../types';

type UseImageFilesHandlerParams = {
  brandId: string;
  maxImages: number;
  maxSizeInMB: number;
  allowMixedMedia: boolean;
  hasVideo: boolean;
  mediaItems: MediaItem[];
  setError: (message: string) => void;
  setMediaItems: Dispatch<SetStateAction<MediaItem[]>>;
  emitChange: (items: MediaItem[]) => void;
  onVideoChange?: (url: string) => void;
};

function isImageFileValid(file: File, maxSizeInMB: number): boolean {
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
}

function toUploadingMediaItems(files: File[]): MediaItem[] {
  return files.map((file) => ({
    url: URL.createObjectURL(file),
    file,
    uploading: true,
    type: 'image',
  }));
}

async function uploadImageAsset(params: {
  brandId: string;
  file: File;
  mediaIndex: number;
  setMediaItems: Dispatch<SetStateAction<MediaItem[]>>;
}): Promise<AssetReference | null> {
  const { brandId, file, mediaIndex, setMediaItems } = params;
  try {
    const uploadInfo = await assetsApi.getUploadUrl({
      brandId,
      fileName: file.name,
      contentType: file.type,
      fileType: 'image',
      fileSize: file.size,
    });

    await assetsApi.uploadToS3(file, uploadInfo.uploadUrl);
    const asset = await assetsApi.createAsset({
      brandId,
      fileName: file.name,
      s3Key: uploadInfo.s3Key,
      fileSize: file.size,
      mimeType: file.type,
      fileType: 'image',
    });

    const uploadedAsset = { id: asset.asset.id, url: asset.asset.url };
    setMediaItems((prev) => {
      const updated = [...prev];
      if (updated[mediaIndex]) {
        updated[mediaIndex] = { ...uploadedAsset, uploading: false, type: 'image' };
      }
      return updated;
    });
    return uploadedAsset;
  } catch (error) {
    console.error('Failed to upload image:', error);
    setMediaItems((prev) => prev.filter((_, index) => index !== mediaIndex));
    return null;
  }
}

export function useImageFilesHandler({
  brandId,
  maxImages,
  maxSizeInMB,
  allowMixedMedia,
  hasVideo,
  mediaItems,
  setError,
  setMediaItems,
  emitChange,
  onVideoChange,
}: UseImageFilesHandlerParams) {
  return useCallback(
    async (files: FileList | File[] | null, options?: { allowMixed?: boolean }) => {
      if (!files || files.length === 0) {
        return;
      }

      // Prevent mixing media types if a video is already selected
      if (!options?.allowMixed && hasVideo) {
        setError('Mixed media is not allowed. Remove the video before adding images.');
        return;
      }

      const fileArray = Array.from(files);
      const validFiles = fileArray.filter((file) => isImageFileValid(file, maxSizeInMB));

      if (mediaItems.length + validFiles.length > maxImages) {
        window.alert(`Maximum ${maxImages} images allowed`);
        return;
      }

      const startIndex = mediaItems.length;
      const newImages = toUploadingMediaItems(validFiles);
      setMediaItems([...mediaItems, ...newImages]);

      const uploadPromises = validFiles.map(async (file, index) => {
        return uploadImageAsset({
          brandId,
          file,
          mediaIndex: startIndex + index,
          setMediaItems,
        });
      });

      const uploadedAssets = await Promise.all(uploadPromises);
      const successfulAssets = uploadedAssets.filter(
        (asset): asset is AssetReference => asset !== null
      );

      const allAssets: MediaItem[] = [
        ...mediaItems.filter((img) => !img.uploading && img.id),
        ...successfulAssets.map((asset) => ({ ...asset, type: 'image' as const })),
      ];
      setMediaItems(allAssets);
      emitChange(allAssets);

      if (!allowMixedMedia && successfulAssets.length > 0 && onVideoChange) {
        onVideoChange('');
      }
    },
    [
      allowMixedMedia,
      brandId,
      emitChange,
      hasVideo,
      maxImages,
      maxSizeInMB,
      mediaItems,
      onVideoChange,
      setError,
      setMediaItems,
    ]
  );
}
