import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { VideoUploadClient, type UploadProgress } from '@/lib/api/video-client';
import { validateInstagramVideo } from '@/lib/instagram-video-validator';

import type { AssetReference, MediaItem } from '../types';

type UseVideoFileHandlerParams = {
  brandId: string;
  acceptedVideoFormats: string[];
  maxVideoSizeInMB: number;
  allowMixedMedia: boolean;
  onChange: (value: AssetReference[]) => void;
  onVideoChange?: (url: string) => void;
  resetError: () => void;
  setError: (message: string) => void;
  setMediaItems: Dispatch<SetStateAction<MediaItem[]>>;
  emitChange: (items: MediaItem[]) => void;
};

type VideoValidationResult = {
  durationSeconds?: number;
};

function getAcceptedVideoFormatsLabel(acceptedVideoFormats: string[]): string {
  return acceptedVideoFormats.map((format) => format.split('/')[1]).join(', ');
}

function ensureBasicVideoConstraints(params: {
  file: File;
  acceptedVideoFormats: string[];
  maxVideoSizeInMB: number;
  setError: (message: string) => void;
}): boolean {
  const { file, acceptedVideoFormats, maxVideoSizeInMB, setError } = params;
  if (!acceptedVideoFormats.includes(file.type)) {
    setError(
      `Invalid video type. Accepted formats: ${getAcceptedVideoFormatsLabel(acceptedVideoFormats)}`
    );
    return false;
  }

  const sizeInMB = file.size / (1024 * 1024);
  if (sizeInMB > maxVideoSizeInMB) {
    setError(
      `Video size exceeds ${maxVideoSizeInMB}MB limit. Current size: ${sizeInMB.toFixed(2)}MB`
    );
    return false;
  }
  return true;
}

async function validateVideoWithInstagramRules(params: {
  file: File;
  acceptedVideoFormats: string[];
  setError: (message: string) => void;
}): Promise<VideoValidationResult | null> {
  const { file, acceptedVideoFormats, setError } = params;
  const validation = await validateInstagramVideo(file, {
    minDurationSeconds: 3,
    maxDurationSeconds: 90,
    minWidth: 540,
    minHeight: 960,
    recommendedAspectRatios: [
      { label: '9:16', ratio: 9 / 16 },
      { label: '4:5', ratio: 4 / 5 },
    ],
    allowedMimeTypes: acceptedVideoFormats,
  });

  if (validation.errors.length > 0) {
    setError(validation.errors.join(' '));
    return null;
  }
  if (validation.warnings.length > 0) {
    toast.warning(validation.warnings.join(' '));
  }
  return {
    durationSeconds:
      typeof validation.durationSeconds === 'number'
        ? Math.round(validation.durationSeconds)
        : undefined,
  };
}

async function uploadVideoInMixedMode(params: {
  file: File;
  brandId: string;
  durationSeconds?: number;
  emitChange: (items: MediaItem[]) => void;
  setError: (message: string) => void;
  setIsUploadingVideo: (uploading: boolean) => void;
  setMediaItems: Dispatch<SetStateAction<MediaItem[]>>;
  setVideoUploadProgress: (progress: UploadProgress | null) => void;
}): Promise<void> {
  const {
    file,
    brandId,
    durationSeconds,
    emitChange,
    setError,
    setIsUploadingVideo,
    setMediaItems,
    setVideoUploadProgress,
  } = params;
  const tempId = `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const previewUrl = URL.createObjectURL(file);

  setMediaItems((prev) => [
    ...prev,
    { id: tempId, url: previewUrl, uploading: true, type: 'video' },
  ]);
  setIsUploadingVideo(true);
  setVideoUploadProgress(null);

  try {
    const { cdnUrl, assetId } = await VideoUploadClient.uploadVideo(
      file,
      brandId,
      (progress) => {
        setVideoUploadProgress(progress);
        setMediaItems((prev) =>
          prev.map((item) =>
            item.id === tempId ? { ...item, progressPercent: progress.percentage } : item
          )
        );
      },
      { durationSeconds }
    );

    setMediaItems((prev) => {
      const next = prev.map(
        (item): MediaItem =>
          item.id === tempId
            ? {
                id: assetId || tempId,
                url: cdnUrl,
                uploading: false,
                type: 'video',
                progressPercent: undefined,
              }
            : item
      );
      emitChange(next);
      return next;
    });
  } catch (error) {
    console.error('Failed to upload video', error);
    setError(
      error instanceof Error ? error.message : 'Failed to upload video. Please try again later.'
    );
    setMediaItems((prev) => prev.filter((item) => item.id !== tempId));
  } finally {
    setIsUploadingVideo(false);
    setVideoUploadProgress(null);
    URL.revokeObjectURL(previewUrl);
  }
}

async function uploadVideoInSingleMode(params: {
  file: File;
  brandId: string;
  durationSeconds?: number;
  onVideoChange: (url: string) => void;
  onChange: (value: AssetReference[]) => void;
  setError: (message: string) => void;
  setIsUploadingVideo: (uploading: boolean) => void;
  setMediaItems: Dispatch<SetStateAction<MediaItem[]>>;
  setVideoUploadProgress: (progress: UploadProgress | null) => void;
}): Promise<void> {
  const {
    file,
    brandId,
    durationSeconds,
    onVideoChange,
    onChange,
    setError,
    setIsUploadingVideo,
    setMediaItems,
    setVideoUploadProgress,
  } = params;
  setIsUploadingVideo(true);
  setVideoUploadProgress(null);

  try {
    const { cdnUrl } = await VideoUploadClient.uploadVideo(
      file,
      brandId,
      (progress) => {
        setVideoUploadProgress(progress);
      },
      { durationSeconds }
    );

    onVideoChange(cdnUrl);
    setMediaItems([]);
    onChange([]);
  } catch (error) {
    console.error('Failed to upload video', error);
    setError(
      error instanceof Error ? error.message : 'Failed to upload video. Please try again later.'
    );
  } finally {
    setIsUploadingVideo(false);
    setVideoUploadProgress(null);
  }
}

export function useVideoFileHandler({
  brandId,
  acceptedVideoFormats,
  maxVideoSizeInMB,
  allowMixedMedia,
  onChange,
  onVideoChange,
  resetError,
  setError,
  setMediaItems,
  emitChange,
}: UseVideoFileHandlerParams) {
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState<UploadProgress | null>(null);

  const handleVideoFile = useCallback(
    async (file: File) => {
      resetError();

      const passesBasicChecks = ensureBasicVideoConstraints({
        file,
        acceptedVideoFormats,
        maxVideoSizeInMB,
        setError,
      });
      if (!passesBasicChecks) {
        return;
      }

      const validation = await validateVideoWithInstagramRules({
        file,
        acceptedVideoFormats,
        setError,
      });
      if (!validation) {
        return;
      }

      if (allowMixedMedia) {
        await uploadVideoInMixedMode({
          file,
          brandId,
          durationSeconds: validation.durationSeconds,
          emitChange,
          setError,
          setIsUploadingVideo,
          setMediaItems,
          setVideoUploadProgress,
        });
        return;
      }

      if (!onVideoChange) {
        setError('Video upload is not enabled in this context.');
        return;
      }

      await uploadVideoInSingleMode({
        file,
        brandId,
        durationSeconds: validation.durationSeconds,
        onVideoChange,
        onChange,
        setError,
        setIsUploadingVideo,
        setMediaItems,
        setVideoUploadProgress,
      });
    },
    [
      acceptedVideoFormats,
      allowMixedMedia,
      brandId,
      emitChange,
      maxVideoSizeInMB,
      onChange,
      onVideoChange,
      resetError,
      setError,
      setMediaItems,
    ]
  );

  return { handleVideoFile, isUploadingVideo, videoUploadProgress };
}
