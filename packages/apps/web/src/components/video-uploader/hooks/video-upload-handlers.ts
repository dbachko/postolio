import { useCallback, type ChangeEvent, type DragEvent, type RefObject } from 'react';
import { toast } from 'sonner';
import type { UploadProgress } from '@/lib/api/video-client';
import { validateMediaKind } from '@/lib/media-kind-validator';
import type { AllowedAspectRatio } from './video-upload-types';
import {
  executeVideoUploadLifecycle,
  useInstagramVideoValidationRunner,
  useValidatedVideoUploader,
} from './video-upload-workflow';

type VideoValidationRules = {
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  allowedAspectRatios?: AllowedAspectRatio[];
};

function collectDurationErrors(
  duration: number,
  {
    minDurationSeconds,
    maxDurationSeconds,
  }: Pick<VideoValidationRules, 'minDurationSeconds' | 'maxDurationSeconds'>
) {
  const blockingErrors: string[] = [];
  if (!Number.isFinite(duration)) {
    return blockingErrors;
  }
  if (typeof minDurationSeconds === 'number' && duration < minDurationSeconds) {
    blockingErrors.push(
      `Video is too short. Instagram reels require at least ${minDurationSeconds} seconds.`
    );
  }
  if (typeof maxDurationSeconds === 'number' && duration > maxDurationSeconds) {
    blockingErrors.push(
      `Video is too long. Instagram reels support up to ${maxDurationSeconds} seconds.`
    );
  }
  return blockingErrors;
}

function collectDimensionWarnings(
  width: number,
  height: number,
  {
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
  }: Pick<VideoValidationRules, 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight'>
) {
  const metadataWarnings: string[] = [];
  if (width <= 0 || height <= 0) {
    return metadataWarnings;
  }
  if (typeof minWidth === 'number' && width < minWidth) {
    metadataWarnings.push(
      `Video width is too small (${Math.round(width)}px). Minimum recommended width is ${minWidth}px.`
    );
  }
  if (typeof minHeight === 'number' && height < minHeight) {
    metadataWarnings.push(
      `Video height is too small (${Math.round(height)}px). Minimum recommended height is ${minHeight}px.`
    );
  }
  if (typeof maxWidth === 'number' && width > maxWidth) {
    metadataWarnings.push(
      `Video width is too large (${Math.round(width)}px). Maximum supported width is ${maxWidth}px.`
    );
  }
  if (typeof maxHeight === 'number' && height > maxHeight) {
    metadataWarnings.push(
      `Video height is too large (${Math.round(height)}px). Maximum supported height is ${maxHeight}px.`
    );
  }
  return metadataWarnings;
}

function collectAspectRatioWarning(
  width: number,
  height: number,
  allowedAspectRatios: AllowedAspectRatio[] | undefined
) {
  if (!allowedAspectRatios?.length || width <= 0 || height <= 0) {
    return null;
  }
  const ratio = width / height;
  const closestDiff = allowedAspectRatios
    .map((item) => Math.abs(item.width / item.height - ratio))
    .sort((left, right) => left - right)[0];
  if ((closestDiff ?? 0) <= 0.03) {
    return null;
  }
  const labels = allowedAspectRatios.map((item) => item.label).join(', ');
  return `Unusual aspect ratio detected. Instagram works best with ${labels}. Your video is approximately ${ratio.toFixed(2)}:1 (${Math.round(width)}×${Math.round(height)}).`;
}

function collectMetadataIssues({
  video,
  minDurationSeconds,
  maxDurationSeconds,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  allowedAspectRatios,
}: {
  video: HTMLVideoElement;
} & VideoValidationRules) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const duration = video.duration;
  const blockingErrors = collectDurationErrors(duration, {
    minDurationSeconds,
    maxDurationSeconds,
  });
  const metadataWarnings = collectDimensionWarnings(width, height, {
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
  });
  const aspectRatioWarning = collectAspectRatioWarning(width, height, allowedAspectRatios);
  if (aspectRatioWarning) {
    metadataWarnings.push(aspectRatioWarning);
  }
  return { blockingErrors, metadataWarnings };
}

export function useVideoLoadHandler({
  allowedAspectRatios,
  minDurationSeconds,
  maxDurationSeconds,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  setError,
}: {
  allowedAspectRatios?: AllowedAspectRatio[];
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  setError: (value: string | null | ((previous: string | null) => string | null)) => void;
}) {
  return useCallback(
    (video: HTMLVideoElement | null) => {
      if (!video) {
        return;
      }
      const { blockingErrors, metadataWarnings } = collectMetadataIssues({
        video,
        allowedAspectRatios,
        minDurationSeconds,
        maxDurationSeconds,
        minWidth,
        minHeight,
        maxWidth,
        maxHeight,
      });
      if (metadataWarnings.length > 0) {
        toast.warning(metadataWarnings.join(' '));
      }
      if (blockingErrors.length > 0) {
        setError(blockingErrors.join(' '));
        return;
      }
      setError((previous) =>
        previous &&
        previous.toLowerCase().includes('video') &&
        previous.toLowerCase().includes('instagram')
          ? null
          : previous
      );
    },
    [
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

export function useValidateVideoFile({
  acceptedFormats,
  maxSizeInMB,
}: {
  acceptedFormats: string[];
  maxSizeInMB: number;
}) {
  return useCallback(
    (file: File): string | null => {
      if (!acceptedFormats.includes(file.type)) {
        return `Invalid file type. Accepted formats: ${acceptedFormats.map((format) => format.split('/')[1]).join(', ')}`;
      }
      const sizeInMB = file.size / (1024 * 1024);
      if (sizeInMB > maxSizeInMB) {
        return `File size exceeds ${maxSizeInMB}MB limit. Current size: ${sizeInMB.toFixed(2)}MB`;
      }
      return null;
    },
    [acceptedFormats, maxSizeInMB]
  );
}

export function useVideoUploadHandler({
  acceptedFormats,
  allowedAspectRatios,
  brandId,
  maxDurationSeconds,
  maxHeight,
  maxWidth,
  minDurationSeconds,
  minHeight,
  minWidth,
  onChange,
  validateFile,
  value,
  setError,
  setUploadProgress,
  setPreviewUrl,
  setSelectedFile,
  setIsUploading,
}: {
  acceptedFormats: string[];
  allowedAspectRatios?: AllowedAspectRatio[];
  brandId: string;
  maxDurationSeconds?: number;
  maxHeight?: number;
  maxWidth?: number;
  minDurationSeconds?: number;
  minHeight?: number;
  minWidth?: number;
  onChange: (url: string, meta?: { assetId?: string; key?: string }) => void;
  validateFile: (file: File) => string | null;
  value?: string;
  setError: (value: string | null) => void;
  setUploadProgress: (value: UploadProgress | null) => void;
  setPreviewUrl: (value: string) => void;
  setSelectedFile: (file: File | null) => void;
  setIsUploading: (next: boolean) => void;
}) {
  const runInstagramValidation = useInstagramVideoValidationRunner({
    acceptedFormats,
    allowedAspectRatios,
    maxDurationSeconds,
    maxHeight,
    maxWidth,
    minDurationSeconds,
    minHeight,
    minWidth,
    setError,
  });
  const uploadValidatedVideo = useValidatedVideoUploader({ brandId, setUploadProgress });

  return useCallback(
    async (file: File) =>
      await executeVideoUploadLifecycle({
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
      }),
    [
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
    ]
  );
}

export function useVideoDropHandler({
  handleFile,
  setError,
  setIsDragging,
}: {
  handleFile: (file: File) => Promise<void>;
  setError: (value: string | null) => void;
  setIsDragging: (next: boolean) => void;
}) {
  return useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) {
        return;
      }
      const kindError = validateMediaKind(files, 'video-only');
      if (kindError) {
        setError(kindError);
        return;
      }
      if (files[0]) {
        void handleFile(files[0]);
      }
    },
    [handleFile, setError, setIsDragging]
  );
}

export function useVideoFileSelectHandler({
  handleFile,
  setError,
}: {
  handleFile: (file: File) => Promise<void>;
  setError: (value: string | null) => void;
}) {
  return useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files?.length) {
        return;
      }
      const kindError = validateMediaKind(files, 'video-only');
      if (kindError) {
        setError(kindError);
        return;
      }
      if (files[0]) {
        void handleFile(files[0]);
      }
    },
    [handleFile, setError]
  );
}

export function useRemoveVideoHandler({
  previewUrl,
  onChange,
  fileInputRef,
  setPreviewUrl,
  setSelectedFile,
  setError,
  setUploadProgress,
}: {
  previewUrl: string;
  onChange: (url: string, meta?: { assetId?: string; key?: string }) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  setPreviewUrl: (value: string) => void;
  setSelectedFile: (file: File | null) => void;
  setError: (value: string | null) => void;
  setUploadProgress: (value: UploadProgress | null) => void;
}) {
  return useCallback(() => {
    if (previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl('');
    setSelectedFile(null);
    setError(null);
    setUploadProgress(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onChange('');
  }, [
    fileInputRef,
    onChange,
    previewUrl,
    setError,
    setPreviewUrl,
    setSelectedFile,
    setUploadProgress,
  ]);
}
