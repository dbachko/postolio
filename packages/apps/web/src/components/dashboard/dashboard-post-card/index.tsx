import type { ReactNode } from 'react';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

type DashboardPostThumbnail =
  | {
      kind: 'image';
      src: string | null;
      alt?: string;
    }
  | {
      kind: 'video';
      src: string | null;
      posterSrc?: string | null;
      alt?: string;
    };

export function DashboardPostCard({
  thumbnail,
  children,
  action,
  className,
}: {
  thumbnail?: DashboardPostThumbnail;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const renderThumbnailMedia = () => {
    if (!thumbnail) {
      return null;
    }
    if (thumbnail.kind === 'image') {
      if (!thumbnail.src) {
        return null;
      }
      return (
        <img
          src={thumbnail.src}
          alt={thumbnail.alt ?? ''}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      );
    }
    if (!thumbnail.src) {
      return null;
    }
    return (
      <>
        <video
          src={thumbnail.src}
          poster={thumbnail.posterSrc || undefined}
          className="h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="bg-foreground/60 rounded-full p-1">
            <Play className="text-background h-3 w-3" aria-hidden="true" />
          </div>
        </div>
      </>
    );
  };

  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-md border p-3', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {thumbnail ? (
          <div className="bg-muted relative h-10 w-10 shrink-0 overflow-hidden rounded-md">
            {renderThumbnailMedia()}
          </div>
        ) : null}

        <div className="min-w-0 flex-1">{children}</div>
      </div>

      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
