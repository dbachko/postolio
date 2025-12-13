import { Film, Image as ImageIcon, Layers, Text, Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MediaBadgeType } from '@/utils/media-type';

const mediaBadgeByType = {
  carousel: { title: 'Carousel', Icon: Layers },
  reel: { title: 'Reel', Icon: Film },
  video: { title: 'Video', Icon: Video },
  image: { title: 'Image', Icon: ImageIcon },
  text: { title: 'Text', Icon: Text },
} as const satisfies Record<MediaBadgeType, { title: string; Icon: typeof Video }>;

export function MediaTypeBadge({
  type,
  className,
  iconClassName,
  title,
}: {
  type: MediaBadgeType;
  className?: string;
  iconClassName?: string;
  title?: string;
}) {
  const badge = mediaBadgeByType[type];
  const effectiveTitle = title ?? badge.title;

  return (
    <span
      className={cn(
        'bg-background/80 border-border text-foreground inline-flex items-center justify-center rounded-md border p-1 shadow-sm backdrop-blur',
        className
      )}
      title={effectiveTitle}
      aria-label={effectiveTitle}
    >
      <badge.Icon className={cn('h-3.5 w-3.5', iconClassName)} />
    </span>
  );
}
