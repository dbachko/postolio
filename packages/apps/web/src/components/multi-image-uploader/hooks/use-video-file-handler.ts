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
        return;
      }

      if (validation.warnings.length > 0) {
        toast.warning(validation.warnings.join(' '));
      }

      const roundedDuration =
        typeof validation.durationSeconds === 'number'
          ? Math.round(validation.durationSeconds)
          : undefined;

      if (allowMixedMedia) {
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
            { durationSeconds: roundedDuration }
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
        } catch (err) {
          console.error('Failed to upload video', err);
          setError(
            err instanceof Error ? err.message : 'Failed to upload video. Please try again later.'
          );
          setMediaItems((prev) => prev.filter((item) => item.id !== tempId));
        } finally {
          setIsUploadingVideo(false);
          setVideoUploadProgress(null);
          URL.revokeObjectURL(previewUrl);
        }
        return;
      }

      if (!onVideoChange) {
        setError('Video upload is not enabled in this context.');
        return;
      }

      setIsUploadingVideo(true);
      setVideoUploadProgress(null);

      try {
        const { cdnUrl } = await VideoUploadClient.uploadVideo(
          file,
          brandId,
          (progress) => {
            setVideoUploadProgress(progress);
          },
          { durationSeconds: roundedDuration }
        );

        onVideoChange(cdnUrl);
        setMediaItems([]);
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
