import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatInUserTimezone } from '@/lib/timezone';
import { ExternalLink, Play, Images, Video } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';
import type { PublicationLink, PublicationPreviewMedia } from './types';

type PostPublicationFooterProps = {
  layout: 'sidebar' | 'page';
  publishedAt?: string | null;
  brandTimezone?: string;
  preview?: {
    contentType?: string;
    media: PublicationPreviewMedia[];
  } | null;
  links: PublicationLink[];
};

const KNOWN_PLATFORMS: Platform[] = ['instagram', 'facebook', 'linkedin', 'x', 'youtube', 'tiktok'];

function isKnownPlatform(value: string): value is Platform {
  return (KNOWN_PLATFORMS as string[]).includes(value);
}

function formatPlatformLabel(platform: string): string {
  const normalized = platform.trim().toLowerCase();
  if (!normalized) {
    return 'Platform';
  }
  if (isKnownPlatform(normalized)) {
    return getPlatformConfig(normalized).displayName;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function PreviewImageTile({
  src,
  alt,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<'img'>, 'src'> & {
  src: string;
  alt: string;
}) {
  return (
    <div className={cn('bg-muted relative h-10 w-10 overflow-hidden rounded-md', className)}>
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        {...props}
      />
    </div>
  );
}

function PreviewFallback({ kind }: { kind: 'generic' | 'video' | 'carousel' }) {
  let Icon = ExternalLink;
  if (kind === 'video') {
    Icon = Video;
  } else if (kind === 'carousel') {
    Icon = Images;
  }
  return (
    <div className="bg-muted text-muted-foreground flex h-10 w-10 items-center justify-center rounded-md">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </div>
  );
}

function buildPreviewTiles(media: PublicationPreviewMedia[]) {
  return media.slice(0, 4).map((item) => ({
    type: item.type,
    src: item.type === 'video' ? item.thumbnailUrl || null : item.url,
  }));
}

function resolvePreviewKinds(params: {
  media: PublicationPreviewMedia[];
  tiles: Array<{ type: PublicationPreviewMedia['type']; src: string | null }>;
  contentType: string;
}) {
  const isCarousel = params.media.length > 1;
  let carouselKind: 'generic' | 'video' | 'carousel' = 'generic';
  if (isCarousel) {
    carouselKind = 'carousel';
  } else if (params.tiles[0]?.type === 'video') {
    carouselKind = 'video';
  }
  const showPlayOverlay =
    !isCarousel && (params.tiles[0]?.type === 'video' || params.contentType === 'reel');

  return { isCarousel, carouselKind, showPlayOverlay };
}

function PublicationPreview({
  preview,
}: {
  preview: { contentType?: string; media: PublicationPreviewMedia[] } | null | undefined;
}) {
  const media = preview?.media || [];
  const contentType = String(preview?.contentType || '').toLowerCase();

  if (media.length === 0) {
    return <PreviewFallback kind="generic" />;
  }

  const tiles = buildPreviewTiles(media);
  const { isCarousel, carouselKind, showPlayOverlay } = resolvePreviewKinds({
    media,
    tiles,
    contentType,
  });

  if (isCarousel) {
    return (
      <div className="bg-muted relative grid h-10 w-10 grid-cols-2 overflow-hidden rounded-md">
        {tiles.map((tile, idx) => (
          <div key={idx} className="relative h-full w-full">
            {tile.src ? (
              <img
                src={tile.src}
                alt="Published post preview"
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="text-muted-foreground flex h-full w-full items-center justify-center">
                <Video className="h-3.5 w-3.5" aria-hidden="true" />
              </div>
            )}
            {tile.type === 'video' ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="bg-background/70 text-foreground flex h-5 w-5 items-center justify-center rounded-full">
                  <Play className="h-3 w-3" aria-hidden="true" />
                </div>
              </div>
            ) : null}
          </div>
        ))}
        <div className="bg-background/70 absolute top-1 right-1 rounded px-1 py-0.5 text-[10px] font-medium">
          {media.length}
        </div>
      </div>
    );
  }

  const tile = tiles[0];
  if (!tile) {
    return <PreviewFallback kind={carouselKind} />;
  }

  if (!tile.src) {
    return <PreviewFallback kind={carouselKind} />;
  }

  return (
    <div className="relative">
      <PreviewImageTile src={tile.src} alt="Published post preview" />
      {showPlayOverlay ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-background/70 text-foreground flex h-6 w-6 items-center justify-center rounded-full">
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PostPublicationFooter({
  layout,
  publishedAt,
  brandTimezone,
  preview,
  links,
}: PostPublicationFooterProps) {
  if (!publishedAt && links.length === 0) {
    return null;
  }

  const outerClass = cn(
    'border-border bg-card border-t px-4 py-3',
    layout === 'sidebar' && 'sticky bottom-0 z-20'
  );

  const primaryLink = links[0];

  return (
    <div className={outerClass}>
      <div className="space-y-3">
        {publishedAt ? (
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-muted-foreground">Published</span>
            <span className="text-foreground font-medium">
              {formatInUserTimezone(publishedAt, 'MMM d, h:mm a', brandTimezone)}
            </span>
          </div>
        ) : null}

        {primaryLink ? (
          <Button asChild variant="outline" className="h-auto w-full justify-start gap-3 p-2">
            <a href={primaryLink.url} target="_blank" rel="noopener noreferrer">
              <PublicationPreview preview={preview} />

              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium">
                  Open on {formatPlatformLabel(primaryLink.platform)}
                </div>
                <div className="text-muted-foreground truncate text-xs">Opens in a new tab</div>
              </div>

              <ExternalLink className="text-muted-foreground h-4 w-4" aria-hidden="true" />
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
