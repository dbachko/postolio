import type { DragEvent } from 'react';
import { cn } from '@/lib/utils';
import { MediaCard } from '@/components/media-card';
import type { UploadProgress } from '@/lib/api/video-client';
import type { MediaItem } from '../types';
import { Dropzone } from './dropzone';

type MediaUploaderLayoutProps = {
  enableUpload: boolean;
  allowMixedMedia: boolean;
  maxImages: number;
  maxSizeInMB: number;
  maxVideoSizeInMB: number;
  mediaItems: MediaItem[];
  hasVideo: boolean;
  videoUrl: string | undefined;
  isDragging: boolean;
  isUploadInProgress: boolean;
  isUploadingVideo: boolean;
  videoUploadProgress: UploadProgress | null;
  draggedIndex: number | null;
  onDropzoneClick: () => void;
  onDropzoneDragOver: (e: DragEvent<HTMLElement>) => void;
  onDropzoneDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDropzoneDrop: (e: DragEvent<HTMLElement>) => void;
  onDragStart: (e: DragEvent<HTMLElement>, index: number) => void;
  onDragOver: (e: DragEvent<HTMLElement>, index: number) => void;
  onDragEnd: () => void;
  onRemove: (index: number) => void;
  onVideoChange?: (url: string) => void;
  onResetError: () => void;
};

export function MediaUploaderLayout({
  enableUpload,
  allowMixedMedia,
  maxImages,
  maxSizeInMB,
  maxVideoSizeInMB,
  mediaItems,
  hasVideo,
  videoUrl,
  isDragging,
  isUploadInProgress,
  isUploadingVideo,
  videoUploadProgress,
  draggedIndex,
  onDropzoneClick,
  onDropzoneDragOver,
  onDropzoneDragLeave,
  onDropzoneDrop,
  onDragStart,
  onDragOver,
  onDragEnd,
  onRemove,
  onVideoChange,
  onResetError,
}: MediaUploaderLayoutProps) {
  return (
    <>
      {!mediaItems.length && !hasVideo && enableUpload && (
        <Dropzone
          variant="full"
          allowMixedMedia={allowMixedMedia}
          maxImages={maxImages}
          maxSizeInMB={maxSizeInMB}
          maxVideoSizeInMB={maxVideoSizeInMB}
          mediaItemCount={mediaItems.length}
          isDragging={isDragging}
          isUploadInProgress={isUploadInProgress}
          isUploadingVideo={isUploadingVideo}
          videoUploadProgress={videoUploadProgress}
          onClick={onDropzoneClick}
          onDragOver={onDropzoneDragOver}
          onDragLeave={onDropzoneDragLeave}
          onDrop={onDropzoneDrop}
        />
      )}

      {mediaItems.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {mediaItems.map((media, index) => (
            <MediaCard
              key={`${media.url}-${index}`}
              type={media.type}
              src={media.url}
              index={index}
              alt={`Upload ${index + 1}`}
              draggable={enableUpload && !media.uploading}
              onDragStart={enableUpload ? (event) => onDragStart(event, index) : undefined}
              onDragOver={enableUpload ? (event) => onDragOver(event, index) : undefined}
              onDragEnd={enableUpload ? onDragEnd : undefined}
              onRemove={enableUpload && !media.uploading ? () => onRemove(index) : undefined}
              isUploading={media.uploading}
              progressPercent={media.progressPercent}
              showDragHandle={enableUpload && media.type === 'image'}
              className={cn(draggedIndex === index && 'opacity-50')}
            />
          ))}

          {enableUpload && mediaItems.length < maxImages && (
            <Dropzone
              variant="card"
              allowMixedMedia={allowMixedMedia}
              maxImages={maxImages}
              maxSizeInMB={maxSizeInMB}
              maxVideoSizeInMB={maxVideoSizeInMB}
              mediaItemCount={mediaItems.length}
              isDragging={isDragging}
              isUploadInProgress={isUploadInProgress}
              isUploadingVideo={isUploadingVideo}
              videoUploadProgress={videoUploadProgress}
              onClick={onDropzoneClick}
              onDragOver={onDropzoneDragOver}
              onDragLeave={onDropzoneDragLeave}
              onDrop={onDropzoneDrop}
            />
          )}
        </div>
      )}

      {!allowMixedMedia && !mediaItems.length && hasVideo && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <MediaCard
            type="video"
            src={videoUrl ?? ''}
            index={0}
            showOrderBadge
            draggable={false}
            onRemove={
              onVideoChange
                ? () => {
                    onVideoChange('');
                    onResetError();
                  }
                : undefined
            }
            isUploading={isUploadingVideo}
            progressPercent={videoUploadProgress?.percentage}
            showDragHandle={false}
          />
        </div>
      )}
    </>
  );
}
