import { useCallback } from 'react';
import { toast } from 'sonner';
import { VideoUploadClient, type UploadProgress } from '@/lib/api/video-client';
import { validateInstagramVideo } from '@/lib/instagram-video-validator';
import type { AllowedAspectRatio } from './video-upload-types';

export type VideoUploadValidation = Awaited<ReturnType<typeof validateInstagramVideo>>;

export function useInstagramVideoValidationRunner({
  acceptedFormats,
  allowedAspectRatios,
  maxDurationSeconds,
  maxHeight,
  maxWidth,
  minDurationSeconds,
  minHeight,
  minWidth,
  setError,
}: {
  acceptedFormats: string[];
  allowedAspectRatios?: AllowedAspectRatio[];
  maxDurationSeconds?: number;
  maxHeight?: number;
  maxWidth?: number;
  minDurationSeconds?: number;
  minHeight?: number;
  minWidth?: number;
  setError: (value: string | null) => void;
}) {
  return useCallback(
    async (file: File): Promise<VideoUploadValidation | null> => {
      const validation = await validateInstagramVideo(file, {
        allowedMimeTypes: acceptedFormats,
        minDurationSeconds,
        maxDurationSeconds,
        minWidth,
        minHeight,
        maxWidth,
        maxHeight,
        recommendedAspectRatios: allowedAspectRatios?.map((ratio) => ({
          label: ratio.label,
          ratio: ratio.width / ratio.height,
        })),
      });
      if (validation.errors.length > 0) {
        setError(validation.errors.join(' '));
        return null;
      }
      if (validation.warnings.length > 0) {
        toast.warning(validation.warnings.join(' '));
      }
      return validation;
    },
    [
      acceptedFormats,
      allowedAspectRatios,
      maxDurationSeconds,
      maxHeight,
      maxWidth,
      minDurationSeconds,
      minHeight,
      minWidth,
      setError,
    ]
  );
}

export function useValidatedVideoUploader({
  brandId,
  setUploadProgress,
}: {
  brandId: string;
  setUploadProgress: (value: UploadProgress | null) => void;
}) {
  return useCallback(
    async (file: File, validation: VideoUploadValidation) => {
      const roundedDuration =
        typeof validation.durationSeconds === 'number'
          ? Math.round(validation.durationSeconds)
          : undefined;
      return await VideoUploadClient.uploadVideo(file, brandId, setUploadProgress, {
        durationSeconds: roundedDuration,
      });
    },
    [brandId, setUploadProgress]
  );
}

export async function executeVideoUploadLifecycle({
  file,
  onChange,
  runInstagramValidation,
  setError,
  setIsUploading,
  setPreviewUrl,
  setSelectedFile,
  setUploadProgress,
  uploadValidatedVideo,
  validateFile,
  value,
}: {
  file: File;
  onChange: (url: string, meta?: { assetId?: string; key?: string }) => void;
  runInstagramValidation: (selectedFile: File) => Promise<VideoUploadValidation | null>;
  setError: (value: string | null) => void;
  setIsUploading: (next: boolean) => void;
  setPreviewUrl: (value: string) => void;
  setSelectedFile: (file: File | null) => void;
  setUploadProgress: (value: UploadProgress | null) => void;
  uploadValidatedVideo: (
    selectedFile: File,
    validation: VideoUploadValidation
  ) => Promise<{ assetId?: string; cdnUrl: string; key?: string }>;
  validateFile: (file: File) => string | null;
  value?: string;
}) {
  setError(null);
  setUploadProgress(null);
  const validationError = validateFile(file);
  if (validationError) {
    setError(validationError);
    return;
  }
  const validation = await runInstagramValidation(file);
  if (!validation) {
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  setPreviewUrl(objectUrl);
  setSelectedFile(file);
  setIsUploading(true);
  try {
    const { cdnUrl, key, assetId } = await uploadValidatedVideo(file, validation);
    onChange(cdnUrl, { assetId, key });
    setPreviewUrl(cdnUrl);
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Failed to upload video');
    setPreviewUrl(value || '');
    setSelectedFile(null);
    URL.revokeObjectURL(objectUrl);
  } finally {
    setIsUploading(false);
    setUploadProgress(null);
  }
}
