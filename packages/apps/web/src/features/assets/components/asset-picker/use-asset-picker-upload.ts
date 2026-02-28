import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { assetsApi } from '@/features/assets/api/client';

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;

interface UseAssetPickerUploadArgs {
  brandId: string;
  type?: 'image' | 'video';
  queryClient: QueryClient;
}

function isFilesDragEvent(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

function validateUploadFile(file: File, pickerType?: 'image' | 'video'): string | null {
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');

  if (!isImage && !isVideo) {
    return `${file.name} is not a supported image or video file.`;
  }
  if (pickerType && pickerType !== (isVideo ? 'video' : 'image')) {
    return `This picker accepts ${pickerType} files only.`;
  }
  if (isImage && file.size > MAX_IMAGE_SIZE_BYTES) {
    return `${file.name} exceeds the 10MB image upload limit.`;
  }
  if (isVideo && file.size > MAX_VIDEO_SIZE_BYTES) {
    return `${file.name} exceeds the 500MB video upload limit.`;
  }
  return null;
}

function probeImageDimensions(file: File): Promise<{ width?: number; height?: number }> {
  if (!file.type.startsWith('image/')) {
    return Promise.resolve({});
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.width, height: image.height });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({});
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

async function uploadSingleAsset(file: File, brandId: string) {
  const fileType = file.type.startsWith('video/') ? 'video' : 'image';
  const uploadInfo = await assetsApi.getUploadUrl({
    brandId,
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    fileType,
    fileSize: file.size,
  });

  await assetsApi.uploadToS3(file, uploadInfo.uploadUrl);
  const dimensions = await probeImageDimensions(file);

  return assetsApi.createAsset({
    brandId,
    fileName: file.name,
    s3Key: uploadInfo.s3Key,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
    fileType,
    width: dimensions.width,
    height: dimensions.height,
  });
}

async function runUploadBatch({
  files,
  brandId,
  type,
}: {
  files: File[];
  brandId: string;
  type?: 'image' | 'video';
}) {
  return Promise.allSettled(
    files.map(async (file) => {
      const validationError = validateUploadFile(file, type);
      if (validationError) {
        throw new Error(validationError);
      }
      return uploadSingleAsset(file, brandId);
    })
  );
}

function resolveUploadErrorMessage(result: PromiseRejectedResult | undefined): string {
  if (result?.reason instanceof Error) {
    return result.reason.message;
  }
  return 'Failed to upload one or more files.';
}

function useAssetPickerDragUploadUI({
  uploadFiles,
  isUploading,
}: {
  uploadFiles: (files: FileList | File[] | null) => Promise<void>;
  isUploading: boolean;
}) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  const handleDropzoneClick = useCallback(() => {
    if (isUploading) {
      return;
    }
    fileInputRef.current?.click();
  }, [isUploading]);

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      void uploadFiles(event.target.files);
      event.target.value = '';
    },
    [uploadFiles]
  );

  const handleDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFilesDragEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFilesDragEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setIsDraggingFiles(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
      if (event.dataTransfer.files.length === 0) {
        return;
      }
      void uploadFiles(event.dataTransfer.files);
    },
    [uploadFiles]
  );

  return {
    fileInputRef,
    isDraggingFiles,
    handleDropzoneClick,
    handleFileInputChange,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}

export function useAssetPickerUpload({ brandId, type, queryClient }: UseAssetPickerUploadArgs) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || files.length === 0) {
        return;
      }
      const fileArray = Array.from(files);
      setUploadError(null);
      setIsUploading(true);
      const results = await runUploadBatch({ files: fileArray, brandId, type });
      const failed = results.filter((result) => result.status === 'rejected');
      const successCount = results.length - failed.length;
      if (successCount > 0) {
        toast.success(
          successCount === 1 ? '1 asset uploaded.' : `${successCount} assets uploaded.`
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['assets-picker', brandId] }),
          queryClient.invalidateQueries({ queryKey: ['assets', brandId] }),
        ]);
      }
      if (failed.length > 0) {
        const message = resolveUploadErrorMessage(failed[0] as PromiseRejectedResult | undefined);
        setUploadError(message);
        toast.error(
          failed.length === 1 ? message : `${failed.length} files failed to upload. ${message}`
        );
      }
      setIsUploading(false);
    },
    [brandId, queryClient, type]
  );

  const dragUploadUi = useAssetPickerDragUploadUI({ uploadFiles, isUploading });

  return {
    ...dragUploadUi,
    isUploading,
    uploadError,
  };
}
