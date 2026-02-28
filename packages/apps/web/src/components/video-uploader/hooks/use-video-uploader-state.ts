import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { UploadProgress } from '@/lib/api/video-client';
import type { AllowedAspectRatio } from './video-upload-types';
import {
  useRemoveVideoHandler,
  useValidateVideoFile,
  useVideoDropHandler,
  useVideoFileSelectHandler,
  useVideoLoadHandler,
  useVideoUploadHandler,
} from './video-upload-handlers';

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

function useVideoUploaderCoreState(value: string | undefined) {
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

  return {
    error,
    fileInputRef,
    isDragging,
    isUploading,
    previewUrl,
    selectedFile,
    setError,
    setIsDragging,
    setIsUploading,
    setPreviewUrl,
    setSelectedFile,
    setUploadProgress,
    uploadProgress,
  };
}

type VideoUploaderCoreState = ReturnType<typeof useVideoUploaderCoreState>;

function useVideoValidationHandlers(
  {
    acceptedFormats,
    allowedAspectRatios,
    brandId,
    maxDurationSeconds,
    maxHeight,
    maxSizeInMB,
    maxWidth,
    minDurationSeconds,
    minHeight,
    minWidth,
    onChange,
    value,
  }: UseVideoUploaderStateParams,
  {
    setError,
    setIsUploading,
    setPreviewUrl,
    setSelectedFile,
    setUploadProgress,
  }: Pick<
    VideoUploaderCoreState,
    'setError' | 'setIsUploading' | 'setPreviewUrl' | 'setSelectedFile' | 'setUploadProgress'
  >
) {
  const handleVideoLoad = useVideoLoadHandler({
    allowedAspectRatios,
    minDurationSeconds,
    maxDurationSeconds,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    setError,
  });
  const validateFile = useValidateVideoFile({ acceptedFormats, maxSizeInMB });
  const handleFile = useVideoUploadHandler({
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
  });

  return { handleFile, handleVideoLoad };
}

function useVideoDragHandlers(setIsDragging: (next: boolean) => void) {
  const handleDragOver = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(true);
    },
    [setIsDragging]
  );

  const handleDragLeave = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
    },
    [setIsDragging]
  );

  return { handleDragLeave, handleDragOver };
}

function useVideoInteractionHandlers({
  fileInputRef,
  previewUrl,
  onChange,
  handleFile,
  setError,
  setIsDragging,
  setPreviewUrl,
  setSelectedFile,
  setUploadProgress,
}: {
  fileInputRef: VideoUploaderCoreState['fileInputRef'];
  previewUrl: string;
  onChange: UseVideoUploaderStateParams['onChange'];
  handleFile: (file: File) => Promise<void>;
  setError: (value: string | null) => void;
  setIsDragging: (next: boolean) => void;
  setPreviewUrl: (value: string) => void;
  setSelectedFile: (file: File | null) => void;
  setUploadProgress: (value: UploadProgress | null) => void;
}) {
  const dragHandlers = useVideoDragHandlers(setIsDragging);
  const handleDrop = useVideoDropHandler({ handleFile, setError, setIsDragging });
  const handleFileSelect = useVideoFileSelectHandler({ handleFile, setError });
  const handleRemoveVideo = useRemoveVideoHandler({
    previewUrl,
    onChange,
    fileInputRef,
    setPreviewUrl,
    setSelectedFile,
    setError,
    setUploadProgress,
  });

  return {
    ...dragHandlers,
    handleClickUpload: () => fileInputRef.current?.click(),
    handleDrop,
    handleFileSelect,
    handlePreviewError: () => {
      setError('Failed to load video preview');
      setPreviewUrl('');
    },
    handleRemoveVideo,
  };
}

export function useVideoUploaderState(params: UseVideoUploaderStateParams) {
  const state = useVideoUploaderCoreState(params.value);
  const { handleFile, handleVideoLoad } = useVideoValidationHandlers(params, state);
  const interactions = useVideoInteractionHandlers({
    fileInputRef: state.fileInputRef,
    previewUrl: state.previewUrl,
    onChange: params.onChange,
    handleFile,
    setError: state.setError,
    setIsDragging: state.setIsDragging,
    setPreviewUrl: state.setPreviewUrl,
    setSelectedFile: state.setSelectedFile,
    setUploadProgress: state.setUploadProgress,
  });

  return {
    error: state.error,
    fileInputRef: state.fileInputRef,
    isDragging: state.isDragging,
    isUploading: state.isUploading,
    previewUrl: state.previewUrl,
    selectedFile: state.selectedFile,
    uploadProgress: state.uploadProgress,
    ...interactions,
    handleVideoLoad,
  };
}
