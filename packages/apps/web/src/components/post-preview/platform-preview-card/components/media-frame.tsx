import type { ReactNode } from 'react';
import { Image as ImageIcon, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PreviewMedia } from '../../types';
import { getPreviewImageUrl } from '../utils';

type MediaFrameProps = {
  media: PreviewMedia[];
  caption: string;
  aspectRatio: string;
  overlayTopLeft?: ReactNode;
  overlayTopRight?: ReactNode;
  className?: string;
};

function renderPrimaryMedia({
  imageUrl,
  primaryMedia,
  caption,
}: {
  imageUrl: string | null;
  primaryMedia: PreviewMedia | null;
  caption: string;
}) {
  if (!imageUrl) {
    return (
      <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2 text-xs">
        <div className="bg-background border-border flex h-10 w-10 items-center justify-center rounded-full border">
          <ImageIcon className="h-4 w-4" />
        </div>
        <span>Add media to preview</span>
      </div>
    );
  }
  if (primaryMedia?.type === 'video' && !primaryMedia.thumbnailUrl) {
    return (
      <video
        src={primaryMedia.url}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <img
      src={imageUrl}
      alt={caption ? `${caption} preview` : 'Post media preview'}
      className="h-full w-full object-cover"
    />
  );
}

export function MediaFrame({
  media,
  caption,
  aspectRatio,
  overlayTopLeft,
  overlayTopRight,
  className,
}: MediaFrameProps) {
  const primaryMedia = media[0] || null;
  const imageUrl = getPreviewImageUrl(primaryMedia);

  return (
    <div
      className={cn('bg-muted relative w-full overflow-hidden', className)}
      style={{ aspectRatio }}
    >
      {renderPrimaryMedia({ imageUrl, primaryMedia, caption })}

      {primaryMedia?.type === 'video' ? (
        <div className="bg-foreground/20 text-foreground absolute inset-0 flex items-center justify-center">
          <div className="bg-background/80 text-foreground flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium">
            <Play className="h-3 w-3" />
            Video
          </div>
        </div>
      ) : null}

      {overlayTopLeft ? <div className="absolute top-2 left-2 z-10">{overlayTopLeft}</div> : null}
      {overlayTopRight ? (
        <div className="absolute top-2 right-2 z-10">{overlayTopRight}</div>
      ) : null}
    </div>
  );
}
