import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MutableRefObject,
} from 'react';

type UseImageUploaderArgs = {
  value?: string;
  onChange: (url: string | File) => void;
  onUpload?: (file: File) => Promise<string>;
  maxSizeInMB: number;
  acceptedFormats: string[];
};

function revokeObjectUrl(objectUrlRef: MutableRefObject<string | null>) {
  if (objectUrlRef.current) {
    URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }
}

function useImageUploaderLifecycle(params: {
  value: string | undefined;
  setPreviewUrl: (url: string) => void;
  setSelectedFile: (file: File | null) => void;
  objectUrlRef: MutableRefObject<string | null>;
}) {
  const { value, setPreviewUrl, setSelectedFile, objectUrlRef } = params;

  useEffect(() => {
    revokeObjectUrl(objectUrlRef);
    setPreviewUrl(value || '');
    setSelectedFile(null);
  }, [objectUrlRef, setPreviewUrl, setSelectedFile, value]);

  useEffect(() => {
    return () => {
      revokeObjectUrl(objectUrlRef);
    };
  }, [objectUrlRef]);
}

function useImageUploaderFileActions(params: {
  acceptedFormats: string[];
  maxSizeInMB: number;
  onChange: (url: string | File) => void;
  onUpload?: (file: File) => Promise<string>;
  value: string | undefined;
  setError: (error: string | null) => void;
  setPreviewUrl: (url: string) => void;
  setSelectedFile: (file: File | null) => void;
  setIsUploading: (uploading: boolean) => void;
  objectUrlRef: MutableRefObject<string | null>;
}) {
  const validateFile = useCallback(
    (file: File): string | null => {
      if (!params.acceptedFormats.includes(file.type)) {
        return `Invalid file type. Accepted formats: ${params.acceptedFormats.map((f) => f.split('/')[1]).join(', ')}`;
      }

      const sizeInMB = file.size / (1024 * 1024);
      if (sizeInMB > params.maxSizeInMB) {
        return `File size exceeds ${params.maxSizeInMB}MB limit. Current size: ${sizeInMB.toFixed(2)}MB`;
      }

      return null;
    },
    [params.acceptedFormats, params.maxSizeInMB]
  );

  const handleFile = useCallback(
    async (file: File) => {
      params.setError(null);
      const validationError = validateFile(file);
      if (validationError) {
        params.setError(validationError);
        return;
      }

      revokeObjectUrl(params.objectUrlRef);
      const objectUrl = URL.createObjectURL(file);
      params.objectUrlRef.current = objectUrl;
      params.setPreviewUrl(objectUrl);
      params.setSelectedFile(file);

      if (!params.onUpload) {
        params.onChange(file);
        return;
      }

      params.setIsUploading(true);
      try {
        const uploadedUrl = await params.onUpload(file);
        params.onChange(uploadedUrl);
      } catch (err) {
        params.setError(err instanceof Error ? err.message : 'Failed to upload image');
        params.setPreviewUrl(params.value || '');
        params.setSelectedFile(null);
        revokeObjectUrl(params.objectUrlRef);
      } finally {
        params.setIsUploading(false);
      }
    },
    [params, validateFile]
  );

  return { handleFile };
}

function useImageUploaderEventHandlers(params: {
  onChange: (url: string | File) => void;
  selectedFile: File | null;
  setError: (error: string | null) => void;
  setPreviewUrl: (url: string) => void;
  setSelectedFile: (file: File | null) => void;
  setIsDragging: (isDragging: boolean) => void;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  objectUrlRef: MutableRefObject<string | null>;
  handleFile: (file: File) => Promise<void>;
}) {
  const handleDragOver = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      params.setIsDragging(true);
    },
    [params]
  );

  const handleDragLeave = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      params.setIsDragging(false);
    },
    [params]
  );

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      params.setIsDragging(false);

      const files = Array.from(event.dataTransfer.files);
      if (files[0]) {
        void params.handleFile(files[0]);
      }
    },
    [params]
  );

  const handleFileSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files?.[0]) {
        void params.handleFile(files[0]);
      }
    },
    [params]
  );

  const handleRemoveImage = useCallback(() => {
    revokeObjectUrl(params.objectUrlRef);
    params.setPreviewUrl('');
    params.setSelectedFile(null);
    params.setError(null);
    if (params.fileInputRef.current) {
      params.fileInputRef.current.value = '';
    }
    params.onChange('');
  }, [params]);

  const handleClickUpload = useCallback(() => {
    params.fileInputRef.current?.click();
  }, [params.fileInputRef]);

  const handlePreviewError = useCallback(() => {
    params.setError('Failed to load image preview');
    if (!params.selectedFile) {
      params.setPreviewUrl('');
    }
  }, [params]);

  return {
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileSelect,
    handleRemoveImage,
    handleClickUpload,
    handlePreviewError,
  };
}

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

  useImageUploaderLifecycle({
    value,
    setPreviewUrl,
    setSelectedFile,
    objectUrlRef,
  });

  const { handleFile } = useImageUploaderFileActions({
    acceptedFormats,
    maxSizeInMB,
    onChange,
    onUpload,
    value,
    setError,
    setPreviewUrl,
    setSelectedFile,
    setIsUploading,
    objectUrlRef,
  });

  const eventHandlers = useImageUploaderEventHandlers({
    onChange,
    selectedFile,
    setError,
    setPreviewUrl,
    setSelectedFile,
    setIsDragging,
    fileInputRef,
    objectUrlRef,
    handleFile,
  });

  return {
    acceptedFormats,
    error,
    fileInputRef,
    isDragging,
    isUploading,
    maxSizeInMB,
    previewUrl,
    selectedFile,
    setError,
    ...eventHandlers,
  };
}
