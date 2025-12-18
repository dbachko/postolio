import { type DragEvent } from 'react';
import { GripVertical, Video as VideoIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

interface MediaCardProps {
  type: 'image' | 'video';
  src: string;
  index?: number;
  alt?: string;
  showOrderBadge?: boolean;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  onRemove?: () => void;
  isUploading?: boolean;
  progressPercent?: number;
  showDragHandle?: boolean;
  onVideoLoaded?: (video: HTMLVideoElement) => void;
  onVideoError?: () => void;
  fit?: 'cover' | 'contain';
  className?: string;
}

export function MediaCard({
  type,
  src,
  index,
  alt,
  showOrderBadge = true,
  draggable = false,
  onDragStart,
  onDragOver,
  onDragEnd,
  onRemove,
  isUploading = false,
  progressPercent,
  showDragHandle = true,
  onVideoLoaded,
  onVideoError,
  fit = 'cover',
  className,
}: MediaCardProps) {
  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (!draggable || isUploading || !onDragStart) return;
    onDragStart(event);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onDragOver) return;
    onDragOver(event);
  };

  const showProgress = type === 'video' && typeof progressPercent === 'number';
  const objectFitClass = fit === 'contain' ? 'object-contain' : 'object-cover';

  return (
    <div
      className={cn(
        'group bg-muted relative aspect-square overflow-hidden rounded-lg border',
        draggable && !isUploading && 'cursor-move',
        className
      )}
      draggable={draggable && !isUploading}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={onDragEnd}
    >
      {showOrderBadge && typeof index === 'number' && (
        <div className="absolute top-2 left-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-medium text-white">
          {index + 1}
        </div>
      )}

      {type === 'image' && showDragHandle && !isUploading && (
        <div className="absolute top-2 right-2 z-10 rounded bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100">
          <GripVertical className="h-4 w-4 text-white" />
        </div>
      )}

      {type === 'video' && (
        <div className="absolute top-2 right-2 z-10 rounded bg-black/60 p-1">
          <VideoIcon className="h-4 w-4 text-white" />
        </div>
      )}

      {onRemove && !isUploading && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-2 bottom-2 z-10 rounded-full bg-red-500 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-600"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {type === 'image' ? (
        <img src={src} alt={alt || 'Image'} className={cn('h-full w-full', objectFitClass)} />
      ) : (
        <video
          src={src}
          controls
          className={cn('h-full w-full', objectFitClass)}
          onLoadedMetadata={(event) => onVideoLoaded?.(event.currentTarget)}
          onError={onVideoError}
        />
      )}

      {isUploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          {showProgress ? (
            <div className="flex flex-col items-center gap-2 text-white">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-white" />
              <p className="text-xs">Uploading video... {progressPercent}%</p>
              <div className="w-32">
                <Progress value={progressPercent} className="h-1.5" />
              </div>
            </div>
          ) : (
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-white border-t-transparent" />
          )}
        </div>
      )}
    </div>
  );
}
