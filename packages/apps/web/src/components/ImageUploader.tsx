import React, { useState, useCallback, useRef } from 'react'
import { Upload, X, Image as ImageIcon, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Alert, AlertDescription } from './ui/alert'

interface ImageUploaderProps {
  value?: string
  onChange: (url: string | File) => void
  onUpload?: (file: File) => Promise<string>
  className?: string
  maxSizeInMB?: number
  acceptedFormats?: string[]
}

export function ImageUploader({
  value,
  onChange,
  onUpload,
  className,
  maxSizeInMB = 10,
  acceptedFormats = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
}: ImageUploaderProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string>(value || '')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Update preview when value changes
  React.useEffect(() => {
    if (value && !selectedFile) {
      setPreviewUrl(value)
    }
  }, [value, selectedFile])

  const validateFile = (file: File): string | null => {
    // Check file type
    if (!acceptedFormats.includes(file.type)) {
      return `Invalid file type. Accepted formats: ${acceptedFormats.map(f => f.split('/')[1]).join(', ')}`
    }

    // Check file size
    const sizeInMB = file.size / (1024 * 1024)
    if (sizeInMB > maxSizeInMB) {
      return `File size exceeds ${maxSizeInMB}MB limit. Current size: ${sizeInMB.toFixed(2)}MB`
    }

    return null
  }

  const handleFile = useCallback(async (file: File) => {
    setError(null)

    // Validate file
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    // Create preview URL
    const objectUrl = URL.createObjectURL(file)
    setPreviewUrl(objectUrl)
    setSelectedFile(file)

    // If onUpload is provided, upload the file
    if (onUpload) {
      setIsUploading(true)
      try {
        const uploadedUrl = await onUpload(file)
        onChange(uploadedUrl)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to upload image')
        // Revert preview on error
        setPreviewUrl(value || '')
        setSelectedFile(null)
      } finally {
        setIsUploading(false)
      }
    } else {
      // Just pass the file to onChange
      onChange(file)
    }
  }, [value, onChange, onUpload, acceptedFormats, maxSizeInMB])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0 && files[0]) {
      handleFile(files[0])
    }
  }, [handleFile])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0 && files[0]) {
      handleFile(files[0])
    }
  }, [handleFile])

  const handleRemoveImage = useCallback(() => {
    // Clear all state
    setPreviewUrl('')
    setSelectedFile(null)
    setError(null)
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    
    // Notify parent component that image was removed
    onChange('')
  }, [onChange])

  const handleClickUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

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
            'relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all',
            isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400',
            isUploading && 'opacity-50 cursor-not-allowed'
          )}
        >
          <div className="flex flex-col items-center space-y-4">
            {isUploading ? (
              <>
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
                <p className="text-sm text-gray-600">Uploading image...</p>
              </>
            ) : (
              <>
                <Upload className="w-12 h-12 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    Drop your image here or click to browse
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Supports: JPEG, PNG, WebP, GIF (max {maxSizeInMB}MB)
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* Image Preview */
        <div className="relative group">
          {/* Drag overlay when dragging over existing image */}
          {isDragging && (
            <div className="absolute inset-0 z-20 bg-blue-500 bg-opacity-90 rounded-lg flex items-center justify-center">
              <div className="text-white text-center">
                <Upload className="w-12 h-12 mx-auto mb-2" />
                <p className="text-sm font-medium">Drop to replace image</p>
              </div>
            </div>
          )}
          
          <div className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden">
            {/* Loading state for preview */}
            {isUploading && (
              <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-10">
                <div className="text-white text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2" />
                  <p className="text-sm">Uploading...</p>
                </div>
              </div>
            )}

            {/* Image */}
            <img
              src={previewUrl}
              alt="Preview"
              className="w-full h-full object-cover"
              onError={() => {
                setError('Failed to load image preview')
                if (!selectedFile) {
                  // Only reset if this was a URL, not a selected file
                  setPreviewUrl('')
                }
              }}
            />

            {/* Actions Overlay - Only show buttons on hover, no background overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity space-x-2 pointer-events-auto">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleClickUpload}
                  disabled={isUploading}
                  className="shadow-lg"
                >
                  <Upload className="w-4 h-4 mr-1" />
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
                  <X className="w-4 h-4 mr-1" />
                  Remove
                </Button>
              </div>
            </div>
          </div>

          {/* Image Info */}
          {selectedFile && (
            <div className="mt-2 text-xs text-gray-600">
              <p>File: {selectedFile.name}</p>
              <p>Size: {(selectedFile.size / (1024 * 1024)).toFixed(2)}MB</p>
            </div>
          )}
        </div>
      )}

      {/* Alternative Upload Button (when image exists) */}
      {previewUrl && !isUploading && (
        <div className="flex items-center justify-center text-sm text-gray-600">
          <ImageIcon className="w-4 h-4 mr-1" />
          <span>Image ready for post</span>
        </div>
      )}
    </div>
  )
}