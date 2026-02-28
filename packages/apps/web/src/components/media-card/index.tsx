import type { DragEvent } from 'react';
import { GripVertical, Video as VideoIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';

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

function createDragStartHandler(
  draggable: boolean,
  isUploading: boolean,
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void
) {
  return (event: DragEvent<HTMLDivElement>) => {
    if (!draggable || isUploading || !onDragStart) {
      return;
    }
    onDragStart(event);
  };
}

function createDragOverHandler(onDragOver?: (event: DragEvent<HTMLDivElement>) => void) {
  return (event: DragEvent<HTMLDivElement>) => {
    if (!onDragOver) {
      return;
    }
    onDragOver(event);
  };
}

function MediaCardPreview({
  type,
  src,
  alt,
  objectFitClass,
  onVideoLoaded,
  onVideoError,
}: {
  type: MediaCardProps['type'];
  src: string;
  alt?: string;
  objectFitClass: string;
  onVideoLoaded?: (video: HTMLVideoElement) => void;
  onVideoError?: () => void;
}) {
  if (type === 'image') {
    return <img src={src} alt={alt || 'Image'} className={cn('h-full w-full', objectFitClass)} />;
  }
  return (
    <video
      src={src}
      controls
      className={cn('h-full w-full', objectFitClass)}
      onLoadedMetadata={(event) => onVideoLoaded?.(event.currentTarget)}
      onError={onVideoError}
    />
  );
}

function MediaCardUploadOverlay({
  showProgress,
  progressPercent,
}: {
  showProgress: boolean;
  progressPercent?: number;
}) {
  return (
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
  );
}

function MediaCardOverlays({
  type,
  index,
  showOrderBadge,
  showDragHandle,
  isUploading,
  onRemove,
}: {
  type: MediaCardProps['type'];
  index?: number;
  showOrderBadge: boolean;
  showDragHandle: boolean;
  isUploading: boolean;
  onRemove?: () => void;
}) {
  return (
    <>
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
        <Button
          type="button"
          variant="destructive"
          size="icon-sm"
          onClick={onRemove}
          className="absolute right-2 bottom-2 z-10 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </>
  );
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
  const handleDragStart = createDragStartHandler(draggable, isUploading, onDragStart);
  const handleDragOver = createDragOverHandler(onDragOver);
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
      <MediaCardOverlays
        type={type}
        index={index}
        showOrderBadge={showOrderBadge}
        showDragHandle={showDragHandle}
        isUploading={isUploading}
        onRemove={onRemove}
      />

      <MediaCardPreview
        type={type}
        src={src}
        alt={alt}
        objectFitClass={objectFitClass}
        onVideoLoaded={onVideoLoaded}
        onVideoError={onVideoError}
      />
      {isUploading && (
        <MediaCardUploadOverlay showProgress={showProgress} progressPercent={progressPercent} />
      )}
    </div>
  );
}
