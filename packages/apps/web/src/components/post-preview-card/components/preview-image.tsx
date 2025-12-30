import { useEffect, useState } from 'react';
import { getPostImageOrPlaceholder } from '@/lib/placeholders';
import { cn } from '@/lib/utils';
import { MediaTypeBadge } from '@/components/media-type-badge';
import { ItemMedia } from '@/components/ui/item';
import type { MediaBadgeType } from '@/utils/media-type';

type PreviewImageProps = {
  previewUrl: string | null;
  showMediaBadge: boolean;
  mediaBadgeType: MediaBadgeType;
  className?: string;
};

export function PreviewImage({
  previewUrl,
  showMediaBadge,
  mediaBadgeType,
  className,
}: PreviewImageProps) {
  const [imageReady, setImageReady] = useState(false);

  useEffect(() => {
    setImageReady(false);
  }, [previewUrl]);

  return (
    <ItemMedia variant="image" className={cn('bg-muted relative', className)}>
      {!imageReady && <div className="bg-muted absolute inset-0 animate-pulse" />}
      <img
        src={getPostImageOrPlaceholder(previewUrl)}
        alt=""
        onLoad={() => setImageReady(true)}
        onError={() => setImageReady(true)}
        className={cn(
          'absolute inset-0 h-full w-full object-cover transition-opacity',
          imageReady ? 'opacity-100' : 'opacity-0'
        )}
        loading="lazy"
        decoding="async"
      />
      {showMediaBadge ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <MediaTypeBadge type={mediaBadgeType} />
        </div>
      ) : null}
    </ItemMedia>
  );
}
