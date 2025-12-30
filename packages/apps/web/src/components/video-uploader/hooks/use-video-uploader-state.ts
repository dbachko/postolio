import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { VideoUploadClient, type UploadProgress } from '@/lib/api/video-client';
import { validateMediaKind } from '@/lib/media-kind-validator';
import { validateInstagramVideo } from '@/lib/instagram-video-validator';

type AllowedAspectRatio = { label: string; width: number; height: number };

type UseVideoUploaderStateParams = {
  value?: string;
  onChange: (url: string, meta?: { assetId?: string; key?: string }) => void;
  brandId: string;
  maxSizeInMB: number;
  acceptedFormats: string[];
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  allowedAspectRatios?: AllowedAspectRatio[];
};

export function useVideoUploaderState({
  value,
  onChange,
  brandId,
  maxSizeInMB,
  acceptedFormats,
  minDurationSeconds,
  maxDurationSeconds,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  allowedAspectRatios,
}: UseVideoUploaderStateParams) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>(value || '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value && !selectedFile) {
      setPreviewUrl(value);
    }
  }, [value, selectedFile]);

  const handleVideoLoad = useCallback(
    (video: HTMLVideoElement | null) => {
      if (!video) return;

      const width = video.videoWidth;
      const height = video.videoHeight;
      const duration = video.duration;

      const blockingErrors: string[] = [];
      const metadataWarnings: string[] = [];

      if (Number.isFinite(duration)) {
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
      }

      if (width > 0 && height > 0) {
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
            metadataWarnings.push(
              `Unusual aspect ratio detected. Instagram works best with ${labels}. Your video is approximately ${(
                width / height
              ).toFixed(2)}:1 (${Math.round(width)}×${Math.round(height)}).`
            );
          }
        }
      }

      if (metadataWarnings.length > 0) {
        toast.warning(metadataWarnings.join(' '));
      }

      if (blockingErrors.length > 0) {
        setError(blockingErrors.join(' '));
        return;
      }

      setError((prev) =>
        prev && prev.toLowerCase().includes('video') && prev.toLowerCase().includes('instagram')
          ? null
          : prev
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
    ]
  );

  const validateFile = useCallback(
    (file: File): string | null => {
      if (!acceptedFormats.includes(file.type)) {
        return `Invalid file type. Accepted formats: ${acceptedFormats
          .map((f) => f.split('/')[1])
          .join(', ')}`;
      }

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

      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      const aspectSpecs = allowedAspectRatios?.map((r) => ({
        label: r.label,
        ratio: r.width / r.height,
      }));

      const validation = await validateInstagramVideo(file, {
        allowedMimeTypes: acceptedFormats,
        minDurationSeconds,
        maxDurationSeconds,
        minWidth,
        minHeight,
        maxWidth,
        maxHeight,
        recommendedAspectRatios: aspectSpecs,
      });

      if (validation.errors.length > 0) {
        setError(validation.errors.join(' '));
        return;
      }

      if (validation.warnings.length > 0) {
        toast.warning(validation.warnings.join(' '));
      }

      const roundedDuration =
        typeof validation.durationSeconds === 'number'
          ? Math.round(validation.durationSeconds)
          : undefined;

      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);
      setSelectedFile(file);

      setIsUploading(true);
      try {
        const { cdnUrl, key, assetId } = await VideoUploadClient.uploadVideo(
          file,
          brandId,
          (progress) => {
            setUploadProgress(progress);
          },
          { durationSeconds: roundedDuration }
        );

        onChange(cdnUrl, { assetId, key });
        setPreviewUrl(cdnUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to upload video');
        setPreviewUrl(value || '');
        setSelectedFile(null);
        URL.revokeObjectURL(objectUrl);
      } finally {
        setIsUploading(false);
        setUploadProgress(null);
      }
    },
    [
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
    ]
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
      if (!files.length) return;

      const kindError = validateMediaKind(files, 'video-only');
      if (kindError) {
        setError(kindError);
        return;
      }

      if (files[0]) {
        void handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || !files.length) return;

      const kindError = validateMediaKind(files, 'video-only');
      if (kindError) {
        setError(kindError);
        return;
      }

      if (files[0]) {
        void handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleRemoveVideo = useCallback(() => {
    if (previewUrl && previewUrl.startsWith('blob:')) {
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
  }, [previewUrl, onChange]);

  const handleClickUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handlePreviewError = useCallback(() => {
    setError('Failed to load video preview');
    setPreviewUrl('');
  }, []);

  return {
    error,
    fileInputRef,
    handleClickUpload,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileSelect,
    handleRemoveVideo,
    handlePreviewError,
    handleVideoLoad,
    isDragging,
    isUploading,
    previewUrl,
    selectedFile,
    uploadProgress,
  };
}
