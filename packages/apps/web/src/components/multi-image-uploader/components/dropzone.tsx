import { Upload } from 'lucide-react';
import type { UploadProgress } from '@/lib/api/video-client';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { DragEvent } from 'react';

interface DropzoneProps {
  variant: 'full' | 'card';
  allowMixedMedia: boolean;
  maxImages: number;
  maxSizeInMB: number;
  maxVideoSizeInMB: number;
  mediaItemCount: number;
  isDragging: boolean;
  isUploadInProgress: boolean;
  isUploadingVideo: boolean;
  videoUploadProgress: UploadProgress | null;
  onClick: () => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

export function Dropzone({
  variant,
  allowMixedMedia,
  maxImages,
  maxSizeInMB,
  maxVideoSizeInMB,
  mediaItemCount,
  isDragging,
  isUploadInProgress,
  isUploadingVideo,
  videoUploadProgress,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
}: DropzoneProps) {
  const baseClasses =
    'relative cursor-pointer rounded-lg border-2 border-dashed text-center transition-all';
  const activeBorderClasses = isDragging
    ? 'border-ring bg-muted'
    : 'border-border hover:border-foreground/30 border';
  const disabledClasses = isUploadInProgress ? 'cursor-not-allowed opacity-75' : '';

  if (variant === 'full') {
    return (
      <div
        className={cn(baseClasses, activeBorderClasses, disabledClasses, 'p-4')}
        onClick={onClick}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="flex flex-col items-center space-y-4">
          {isUploadingVideo && videoUploadProgress ? (
            <>
              <div className="border-foreground h-10 w-10 animate-spin rounded-full border-b-2" />
              <p className="text-muted-foreground text-sm">
                Uploading video... {videoUploadProgress.percentage}%
              </p>
              <div className="w-full max-w-xs">
                <Progress value={videoUploadProgress.percentage} className="h-2" />
              </div>
            </>
          ) : (
            <>
              <Upload className="text-muted-foreground h-8 w-8" />
              <div>
                <p className="text-foreground text-sm font-medium">
                  Drop {allowMixedMedia ? 'images or videos' : 'images or a video'} here, or click
                  to browse
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Images: up to {maxImages} (max {maxSizeInMB}MB each). Video: MP4/MOV/MPEG (max{' '}
                  {maxVideoSizeInMB}MB).
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        baseClasses,
        activeBorderClasses,
        disabledClasses,
        'bg-muted flex aspect-square h-auto flex-col items-center justify-center border p-0 text-xs shadow-none'
      )}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Upload className="text-muted-foreground mb-1 h-6 w-6" />
      <span className="text-foreground font-medium">Add media</span>
      <span className="text-muted-foreground mt-0.5 text-[10px]">
        {allowMixedMedia ? 'Media items' : 'Images only'} · {mediaItemCount}/{maxImages}
      </span>
    </Button>
  );
}
