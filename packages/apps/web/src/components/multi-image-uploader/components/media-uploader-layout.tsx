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

type DropzoneConfigProps = Pick<
  MediaUploaderLayoutProps,
  | 'allowMixedMedia'
  | 'maxImages'
  | 'maxSizeInMB'
  | 'maxVideoSizeInMB'
  | 'mediaItems'
  | 'isDragging'
  | 'isUploadInProgress'
  | 'isUploadingVideo'
  | 'videoUploadProgress'
  | 'onDropzoneClick'
  | 'onDropzoneDragOver'
  | 'onDropzoneDragLeave'
  | 'onDropzoneDrop'
>;

function UploadDropzone({
  variant,
  config,
}: {
  variant: 'full' | 'card';
  config: DropzoneConfigProps;
}) {
  return (
    <Dropzone
      variant={variant}
      allowMixedMedia={config.allowMixedMedia}
      maxImages={config.maxImages}
      maxSizeInMB={config.maxSizeInMB}
      maxVideoSizeInMB={config.maxVideoSizeInMB}
      mediaItemCount={config.mediaItems.length}
      isDragging={config.isDragging}
      isUploadInProgress={config.isUploadInProgress}
      isUploadingVideo={config.isUploadingVideo}
      videoUploadProgress={config.videoUploadProgress}
      onClick={config.onDropzoneClick}
      onDragOver={config.onDropzoneDragOver}
      onDragLeave={config.onDropzoneDragLeave}
      onDrop={config.onDropzoneDrop}
    />
  );
}

function MediaItemsGrid({
  mediaItems,
  enableUpload,
  maxImages,
  draggedIndex,
  onDragStart,
  onDragOver,
  onDragEnd,
  onRemove,
  dropzoneConfig,
}: {
  mediaItems: MediaItem[];
  enableUpload: boolean;
  maxImages: number;
  draggedIndex: number | null;
  onDragStart: MediaUploaderLayoutProps['onDragStart'];
  onDragOver: MediaUploaderLayoutProps['onDragOver'];
  onDragEnd: MediaUploaderLayoutProps['onDragEnd'];
  onRemove: MediaUploaderLayoutProps['onRemove'];
  dropzoneConfig: DropzoneConfigProps;
}) {
  return (
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
      {enableUpload && mediaItems.length < maxImages ? (
        <UploadDropzone variant="card" config={dropzoneConfig} />
      ) : null}
    </div>
  );
}

function VideoCard({
  videoUrl,
  isUploadingVideo,
  videoUploadProgress,
  onVideoChange,
  onResetError,
}: {
  videoUrl: string | undefined;
  isUploadingVideo: boolean;
  videoUploadProgress: UploadProgress | null;
  onVideoChange?: (url: string) => void;
  onResetError: () => void;
}) {
  return (
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
  );
}

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
  const dropzoneConfig: DropzoneConfigProps = {
    allowMixedMedia,
    maxImages,
    maxSizeInMB,
    maxVideoSizeInMB,
    mediaItems,
    isDragging,
    isUploadInProgress,
    isUploadingVideo,
    videoUploadProgress,
    onDropzoneClick,
    onDropzoneDragOver,
    onDropzoneDragLeave,
    onDropzoneDrop,
  };

  return (
    <>
      {!mediaItems.length && !hasVideo && enableUpload && (
        <UploadDropzone variant="full" config={dropzoneConfig} />
      )}

      {mediaItems.length > 0 && (
        <MediaItemsGrid
          mediaItems={mediaItems}
          enableUpload={enableUpload}
          maxImages={maxImages}
          draggedIndex={draggedIndex}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onRemove={onRemove}
          dropzoneConfig={dropzoneConfig}
        />
      )}

      {!allowMixedMedia && !mediaItems.length && hasVideo && (
        <VideoCard
          videoUrl={videoUrl}
          isUploadingVideo={isUploadingVideo}
          videoUploadProgress={videoUploadProgress}
          onVideoChange={onVideoChange}
          onResetError={onResetError}
        />
      )}
    </>
  );
}
