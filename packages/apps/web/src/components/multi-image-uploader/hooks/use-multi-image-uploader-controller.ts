import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';

import type { MediaItem, MultiImageUploaderProps } from '../types';
import { useImageFilesHandler } from './use-image-files-handler';
import { useMediaReorder } from './use-media-reorder';
import { useVideoFileHandler } from './use-video-file-handler';

type ControllerArgs = {
  value: MultiImageUploaderProps['value'];
  onChange: MultiImageUploaderProps['onChange'];
  brandId: string;
  maxImages: number;
  maxSizeInMB: number;
  allowMixedMedia: boolean;
  videoUrl?: string;
  onVideoChange?: MultiImageUploaderProps['onVideoChange'];
  maxVideoSizeInMB: number;
  acceptedVideoFormats: string[];
  enableUpload: boolean;
};

type MediaItemsStateArgs = {
  value: MultiImageUploaderProps['value'];
  onChange: MultiImageUploaderProps['onChange'];
  allowMixedMedia: boolean;
  videoUrl?: string;
};

type ProcessMixedModeArgs = {
  files: File[];
  mediaItems: MediaItem[];
  maxImages: number;
  handleImageFiles: (files: File[], options?: { allowMixed?: boolean }) => Promise<void>;
  handleVideoFile: (file: File) => Promise<void>;
};

async function processMixedModeFiles(args: ProcessMixedModeArgs) {
  if (args.mediaItems.length + args.files.length > args.maxImages) {
    window.alert(`Maximum ${args.maxImages} media items allowed`);
    return;
  }

  const imageFiles = args.files.filter((file) => file.type.startsWith('image/'));
  const videoFiles = args.files.filter((file) => file.type.startsWith('video/'));

  if (imageFiles.length > 0) {
    await args.handleImageFiles(imageFiles, { allowMixed: true });
  }

  for (const videoFile of videoFiles) {
    await args.handleVideoFile(videoFile);
  }
}

type ProcessSingleModeArgs = {
  imageFiles: File[];
  videoFiles: File[];
  hasImages: boolean;
  hasVideo: boolean;
  setError: (message: string) => void;
  handleImageFiles: (files: File[]) => Promise<void>;
  handleVideoFile: (file: File) => Promise<void>;
};

async function processSingleModeFiles(args: ProcessSingleModeArgs) {
  if (args.imageFiles.length > 0 && args.videoFiles.length > 0) {
    args.setError('Mixed media is not allowed. Please upload either images or a video.');
    return;
  }

  if (args.videoFiles.length > 0) {
    if (args.hasImages) {
      args.setError('Mixed media is not allowed. Remove existing images before uploading a video.');
      return;
    }
    if (args.hasVideo) {
      args.setError(
        'Only one video is allowed. Remove the existing video before uploading another media file.'
      );
      return;
    }
    await args.handleVideoFile(args.videoFiles[0]!);
    return;
  }

  if (args.imageFiles.length > 0) {
    if (args.hasVideo) {
      args.setError(
        'Mixed media is not allowed. Remove the existing video before uploading images.'
      );
      return;
    }
    await args.handleImageFiles(args.imageFiles);
  }
}

function useMediaItemsState(args: MediaItemsStateArgs) {
  const { value, onChange, allowMixedMedia, videoUrl } = args;
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMediaItems(
      value.map((asset) => ({
        id: asset.id,
        url: asset.url,
        type: asset.type || 'image',
      }))
    );
  }, [value]);

  const hasImages = mediaItems.some((item) => item.type === 'image');
  const hasVideoAsset = mediaItems.some((item) => item.type === 'video');
  const hasVideo = allowMixedMedia ? hasVideoAsset : Boolean(videoUrl) || hasVideoAsset;
  const hasUploadingMedia = mediaItems.some((item) => item.uploading);

  const resetError = useCallback(() => setError(null), []);

  const emitChange = useCallback(
    (items: MediaItem[]) => {
      onChange(
        items
          .filter((item) => item.id && !item.uploading)
          .map((item) => ({ id: item.id!, url: item.url, type: item.type }))
      );
    },
    [onChange]
  );

  const handleRemove = useCallback(
    (index: number) => {
      const nextItems = mediaItems.filter((_, itemIndex) => itemIndex !== index);
      setMediaItems(nextItems);
      emitChange(nextItems);
    },
    [emitChange, mediaItems]
  );

  return {
    mediaItems,
    setMediaItems,
    isDragging,
    setIsDragging,
    error,
    setError,
    fileInputRef,
    hasImages,
    hasVideo,
    hasUploadingMedia,
    resetError,
    emitChange,
    handleRemove,
  };
}

type MediaFileHandlersArgs = {
  brandId: string;
  maxImages: number;
  maxSizeInMB: number;
  allowMixedMedia: boolean;
  hasVideo: boolean;
  hasImages: boolean;
  mediaItems: MediaItem[];
  onChange: MultiImageUploaderProps['onChange'];
  onVideoChange?: MultiImageUploaderProps['onVideoChange'];
  acceptedVideoFormats: string[];
  maxVideoSizeInMB: number;
  resetError: () => void;
  setError: (message: string) => void;
  setMediaItems: React.Dispatch<React.SetStateAction<MediaItem[]>>;
  emitChange: (items: MediaItem[]) => void;
};

function useUploadPipelines(args: MediaFileHandlersArgs) {
  const handleImageFiles = useImageFilesHandler({
    brandId: args.brandId,
    maxImages: args.maxImages,
    maxSizeInMB: args.maxSizeInMB,
    allowMixedMedia: args.allowMixedMedia,
    hasVideo: args.hasVideo,
    mediaItems: args.mediaItems,
    setError: args.setError,
    setMediaItems: args.setMediaItems,
    emitChange: args.emitChange,
    onVideoChange: args.onVideoChange,
  });

  const videoHandler = useVideoFileHandler({
    brandId: args.brandId,
    acceptedVideoFormats: args.acceptedVideoFormats,
    maxVideoSizeInMB: args.maxVideoSizeInMB,
    allowMixedMedia: args.allowMixedMedia,
    onChange: args.onChange,
    onVideoChange: args.onVideoChange,
    resetError: args.resetError,
    setError: args.setError,
    setMediaItems: args.setMediaItems,
    emitChange: args.emitChange,
  });

  return { handleImageFiles, videoHandler };
}

function useMediaFileHandlers(args: MediaFileHandlersArgs) {
  const { maxImages, allowMixedMedia, hasVideo, hasImages, mediaItems, resetError, setError } =
    args;

  const { handleImageFiles, videoHandler } = useUploadPipelines(args);

  const handleFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || files.length === 0) {
        return;
      }

      resetError();
      const fileArray = Array.from(files);
      const imageFiles = fileArray.filter((file) => file.type.startsWith('image/'));
      const videoFiles = fileArray.filter((file) => file.type.startsWith('video/'));

      if (allowMixedMedia) {
        await processMixedModeFiles({
          files: fileArray,
          mediaItems,
          maxImages,
          handleImageFiles,
          handleVideoFile: videoHandler.handleVideoFile,
        });
        return;
      }

      await processSingleModeFiles({
        imageFiles,
        videoFiles,
        hasImages,
        hasVideo,
        setError,
        handleImageFiles,
        handleVideoFile: videoHandler.handleVideoFile,
      });
    },
    [
      allowMixedMedia,
      handleImageFiles,
      hasImages,
      hasVideo,
      maxImages,
      mediaItems,
      resetError,
      setError,
      videoHandler.handleVideoFile,
    ]
  );

  return {
    handleFiles,
    isUploadingVideo: videoHandler.isUploadingVideo,
    videoUploadProgress: videoHandler.videoUploadProgress,
  };
}

type DropzoneHandlersArgs = {
  isUploadDisabled: boolean;
  hasVideo: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  setIsDragging: (dragging: boolean) => void;
  setError: (message: string) => void;
  handleFiles: (files: FileList | File[] | null) => Promise<void>;
};

function useDropzoneHandlers(args: DropzoneHandlersArgs) {
  const { isUploadDisabled, hasVideo, fileInputRef, setIsDragging, setError, handleFiles } = args;

  const handleDropzoneClick = useCallback(() => {
    if (isUploadDisabled) {
      return;
    }
    fileInputRef.current?.click();
  }, [fileInputRef, isUploadDisabled]);

  const handleDropzoneDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (isUploadDisabled) {
        return;
      }
      setIsDragging(true);
    },
    [isUploadDisabled, setIsDragging]
  );

  const handleDropzoneDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
    },
    [setIsDragging]
  );

  const handleDropzoneDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
      if (isUploadDisabled) {
        if (hasVideo) {
          setError(
            'Only one video is allowed. Remove the existing video before uploading another media file.'
          );
        }
        return;
      }
      void handleFiles(event.dataTransfer.files);
    },
    [handleFiles, hasVideo, isUploadDisabled, setError, setIsDragging]
  );

  return {
    handleDropzoneClick,
    handleDropzoneDragOver,
    handleDropzoneDragLeave,
    handleDropzoneDrop,
  };
}

export function useMultiImageUploaderController(args: ControllerArgs) {
  const mediaState = useMediaItemsState({
    value: args.value,
    onChange: args.onChange,
    allowMixedMedia: args.allowMixedMedia,
    videoUrl: args.videoUrl,
  });

  const { draggedIndex, handleDragStart, handleDragOver, handleDragEnd } = useMediaReorder({
    setMediaItems: mediaState.setMediaItems,
    onCommit: mediaState.emitChange,
  });

  const fileHandlers = useMediaFileHandlers({
    brandId: args.brandId,
    maxImages: args.maxImages,
    maxSizeInMB: args.maxSizeInMB,
    allowMixedMedia: args.allowMixedMedia,
    hasVideo: mediaState.hasVideo,
    hasImages: mediaState.hasImages,
    mediaItems: mediaState.mediaItems,
    onChange: args.onChange,
    onVideoChange: args.onVideoChange,
    acceptedVideoFormats: args.acceptedVideoFormats,
    maxVideoSizeInMB: args.maxVideoSizeInMB,
    resetError: mediaState.resetError,
    setError: (message) => mediaState.setError(message),
    setMediaItems: mediaState.setMediaItems,
    emitChange: mediaState.emitChange,
  });

  const isUploadInProgress = fileHandlers.isUploadingVideo || mediaState.hasUploadingMedia;
  const isUploadDisabled =
    isUploadInProgress || (!args.allowMixedMedia && mediaState.hasVideo) || !args.enableUpload;

  const dropzoneHandlers = useDropzoneHandlers({
    isUploadDisabled,
    hasVideo: mediaState.hasVideo,
    fileInputRef: mediaState.fileInputRef,
    setIsDragging: mediaState.setIsDragging,
    setError: (message) => mediaState.setError(message),
    handleFiles: fileHandlers.handleFiles,
  });

  return {
    ...mediaState,
    ...fileHandlers,
    ...dropzoneHandlers,
    draggedIndex,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    isUploadInProgress,
    isUploadDisabled,
    handleFileSelect: fileHandlers.handleFiles,
  };
}
