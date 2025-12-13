import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Upload, X, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ImageUploaderProps {
  value?: string;
  onChange: (url: string | File) => void;
  onUpload?: (file: File) => Promise<string>;
  className?: string;
  maxSizeInMB?: number;
  acceptedFormats?: string[];
}

export function ImageUploader({
  value,
  onChange,
  onUpload,
  className,
  maxSizeInMB = 10,
  acceptedFormats = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
}: ImageUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>(value || '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Keep preview in sync with controlled value prop
  useEffect(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPreviewUrl(value || '');
    setSelectedFile(null);
  }, [value]);

  // Clean up object URL on unmount
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
      // Check file type
      if (!acceptedFormats.includes(file.type)) {
        return `Invalid file type. Accepted formats: ${acceptedFormats.map((f) => f.split('/')[1]).join(', ')}`;
      }

      // Check file size
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

      // Validate file
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      // Create preview URL
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      setPreviewUrl(objectUrl);
      setSelectedFile(file);

      // If onUpload is provided, upload the file
      if (onUpload) {
        setIsUploading(true);
        try {
          const uploadedUrl = await onUpload(file);
          onChange(uploadedUrl);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to upload image');
          // Revert preview on error
          setPreviewUrl(value || '');
          setSelectedFile(null);
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
          }
        } finally {
          setIsUploading(false);
        }
      } else {
        // Just pass the file to onChange
        onChange(file);
      }
    },
    [value, onChange, onUpload, validateFile]
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
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0 && files[0]) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleRemoveImage = useCallback(() => {
    // Clear all state
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPreviewUrl('');
    setSelectedFile(null);
    setError(null);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Notify parent component that image changed
    onChange('');
  }, [onChange]);

  const handleClickUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div
      className={cn('space-y-4', className)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input - always present for Replace functionality */}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedFormats.join(',')}
        onChange={handleFileSelect}
        className="hidden"
        disabled={isUploading}
      />

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Upload Area */}
      {!previewUrl ? (
        <div
          onClick={handleClickUpload}
          className={cn(
            'relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-all',
            isDragging ? 'border-ring bg-muted' : 'border-border hover:border-foreground/30 border',
            isUploading && 'cursor-not-allowed opacity-50'
          )}
        >
          <div className="flex flex-col items-center space-y-4">
            {isUploading ? (
              <>
                <div className="border-foreground h-12 w-12 animate-spin rounded-full border-b-2" />
                <p className="text-muted-foreground text-sm">Uploading image...</p>
              </>
            ) : (
              <>
                <Upload className="text-muted-foreground h-12 w-12" />
                <div>
                  <p className="text-foreground text-sm font-medium">
                    Drop your image here or click to browse
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Supports: JPEG, PNG, WebP, GIF (max {maxSizeInMB}MB)
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* Image Preview */
        <div className="group relative">
          {/* Drag overlay when dragging over existing image */}
          {isDragging && (
            <div className="bg-primary/90 absolute inset-0 z-20 flex items-center justify-center rounded-lg">
              <div className="text-center text-white">
                <Upload className="mx-auto mb-2 h-12 w-12" />
                <p className="text-sm font-medium">Drop to replace image</p>
              </div>
            </div>
          )}

          <div className="bg-muted relative aspect-square overflow-hidden rounded-lg">
            {/* Loading state for preview */}
            {isUploading && (
              <div className="bg-opacity-50 absolute inset-0 z-10 flex items-center justify-center bg-black">
                <div className="text-center text-white">
                  <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-white" />
                  <p className="text-sm">Uploading...</p>
                </div>
              </div>
            )}

            {/* Image */}
            <img
              src={previewUrl}
              alt="Preview"
              className="h-full w-full object-cover"
              onError={() => {
                setError('Failed to load image preview');
                if (!selectedFile) {
                  // Only reset if this was a URL, not a selected file
                  setPreviewUrl('');
                }
              }}
            />

            {/* Actions Overlay - Only show buttons on hover, no background overlay */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto space-x-2 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleClickUpload}
                  disabled={isUploading}
                  className="shadow-lg"
                >
                  <Upload className="mr-1 h-4 w-4" />
                  Replace
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleRemoveImage}
                  disabled={isUploading}
                  className="shadow-lg"
                >
                  <X className="mr-1 h-4 w-4" />
                  Remove
                </Button>
              </div>
            </div>
          </div>

          {/* Image Info */}
          {selectedFile && (
            <div className="text-muted-foreground mt-2 text-xs">
              <p>File: {selectedFile.name}</p>
              <p>Size: {(selectedFile.size / (1024 * 1024)).toFixed(2)}MB</p>
            </div>
          )}
        </div>
      )}

      {/* Alternative Upload Button (when image exists) */}
      {previewUrl && !isUploading && (
        <div className="text-muted-foreground flex items-center justify-center text-sm">
          <ImageIcon className="mr-1 h-4 w-4" />
          <span>Image ready for post</span>
        </div>
      )}
    </div>
  );
}
