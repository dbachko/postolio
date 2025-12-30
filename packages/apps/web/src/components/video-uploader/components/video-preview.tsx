import { MediaCard } from '@/components/media-card';
import type { UploadProgress } from '@/lib/api/video-client';

interface VideoPreviewProps {
  previewUrl: string;
  isUploading: boolean;
  uploadProgress: UploadProgress | null;
  selectedFile: File | null;
  onRemove: () => void;
  onVideoLoaded: (video: HTMLVideoElement | null) => void;
  onVideoError: () => void;
}

export function VideoPreview({
  previewUrl,
  isUploading,
  uploadProgress,
  selectedFile,
  onRemove,
  onVideoLoaded,
  onVideoError,
}: VideoPreviewProps) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      <MediaCard
        type="video"
        src={previewUrl}
        index={0}
        showOrderBadge
        draggable={false}
        onRemove={onRemove}
        isUploading={isUploading}
        progressPercent={uploadProgress?.percentage}
        showDragHandle={false}
        fit="contain"
        onVideoLoaded={onVideoLoaded}
        onVideoError={() => {
          if (!selectedFile) {
            console.error('Failed to load existing video preview', previewUrl);
            return;
          }
          onVideoError();
        }}
      />
    </div>
  );
}
