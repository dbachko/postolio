import { useCallback, useEffect, useRef, useState } from 'react';

type UseImageUploaderArgs = {
  value?: string;
  onChange: (url: string | File) => void;
  onUpload?: (file: File) => Promise<string>;
  maxSizeInMB: number;
  acceptedFormats: string[];
};

export function useImageUploader({
  value,
  onChange,
  onUpload,
  maxSizeInMB,
  acceptedFormats,
}: UseImageUploaderArgs) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>(value || '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPreviewUrl(value || '');
    setSelectedFile(null);
  }, [value]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const validateFile = useCallback(
    (file: File): string | null => {
      if (!acceptedFormats.includes(file.type)) {
        return `Invalid file type. Accepted formats: ${acceptedFormats.map((f) => f.split('/')[1]).join(', ')}`;
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

      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      setPreviewUrl(objectUrl);
      setSelectedFile(file);

      if (!onUpload) {
        onChange(file);
        return;
      }

      setIsUploading(true);
      try {
        const uploadedUrl = await onUpload(file);
        onChange(uploadedUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to upload image');
        setPreviewUrl(value || '');
        setSelectedFile(null);
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
      } finally {
        setIsUploading(false);
      }
    },
    [onChange, onUpload, validateFile, value]
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
      if (files.length > 0 && files[0]) {
        void handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0 && files[0]) {
        void handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleRemoveImage = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPreviewUrl('');
    setSelectedFile(null);
    setError(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    onChange('');
  }, [onChange]);

  const handleClickUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handlePreviewError = useCallback(() => {
    setError('Failed to load image preview');
    if (!selectedFile) {
      setPreviewUrl('');
    }
  }, [selectedFile]);

  return {
    acceptedFormats,
    error,
    fileInputRef,
    handleClickUpload,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileSelect,
    handlePreviewError,
    handleRemoveImage,
    isDragging,
    isUploading,
    maxSizeInMB,
    previewUrl,
    selectedFile,
    setError,
  };
}
