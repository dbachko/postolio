import { useState, useEffect, useRef } from 'react';
import { ItemMedia } from '@/components/ui/item';
import { getPostImageOrPlaceholder } from '@/lib/placeholders';
import { MediaTypeBadge } from '@/components/MediaTypeBadge';
import type { MediaBadgeType } from '@/utils/media-type';
import { cn } from '@/lib/utils';

interface PostCardImageProps {
  previewUrl: string | null;
  mediaBadgeType: MediaBadgeType;
  showMediaBadge: boolean;
  className?: string;
}

// Module-level cache of loaded image URLs to avoid re-showing skeleton on remount
const loadedImages = new Set<string>();

/**
 * Post card image with loading skeleton and optional media badge.
 * Tracks loaded images globally to prevent skeleton flash on component remount.
 */
export function PostCardImage({
  previewUrl,
  mediaBadgeType,
  showMediaBadge,
  className,
}: PostCardImageProps) {
  const resolvedUrl = getPostImageOrPlaceholder(previewUrl);
  const alreadyLoaded = loadedImages.has(resolvedUrl);
  const [imageReady, setImageReady] = useState(alreadyLoaded);
  const imgRef = useRef<HTMLImageElement>(null);

  // Check if image is already cached by browser (complete before onLoad fires)
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      loadedImages.add(resolvedUrl);
      setImageReady(true);
    }
  }, [resolvedUrl]);

  // Reset loading state only for genuinely new URLs
  useEffect(() => {
    if (!loadedImages.has(resolvedUrl)) {
      setImageReady(false);
    }
  }, [resolvedUrl]);

  const handleLoad = () => {
    loadedImages.add(resolvedUrl);
    setImageReady(true);
  };

  return (
    <ItemMedia variant="image" className={cn('bg-muted relative', className)}>
      {!imageReady && <div className="bg-muted absolute inset-0 animate-pulse" />}
      <img
        ref={imgRef}
        src={resolvedUrl}
        alt=""
        onLoad={handleLoad}
        onError={() => setImageReady(true)}
        className={cn(
          'absolute inset-0 h-full w-full object-cover transition-opacity',
          imageReady ? 'opacity-100' : 'opacity-0'
        )}
        loading="lazy"
        decoding="async"
      />
      {showMediaBadge && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <MediaTypeBadge type={mediaBadgeType} />
        </div>
      )}
    </ItemMedia>
  );
}
