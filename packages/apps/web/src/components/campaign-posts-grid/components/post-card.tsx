import type { ReactNode } from 'react';
import { FileText, Image, Play, Video } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Asset } from '@/features/assets/api/client';
import type { Content } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PostStatusTimeBadge } from '@/components/post-status-time-badge';
import { getPostStatusBorderColor } from '@/utils/post-status-colors';
import { formatShortDateTime, getPostPreview } from '../utils';

interface PostCardProps {
  post: Content;
  primaryAsset: Asset | null;
  onOpen: () => void;
}

export function PostCard({ post, primaryAsset, onOpen }: PostCardProps) {
  const preview = getPostPreview(primaryAsset);
  const borderColor = getPostStatusBorderColor(post.status);
  const previewAlt = post.caption?.trim() ? `${post.caption.trim()} preview` : 'Post media preview';

  let mediaLabel = 'Text';
  let mediaIcon: ReactNode = <FileText className="h-3 w-3" />;
  let previewBody: ReactNode = (
    <div className="bg-muted flex h-full w-full items-center justify-center">
      <FileText className="text-muted-foreground h-8 w-8" />
    </div>
  );

  if (preview.kind === 'video') {
    mediaLabel = 'Video';
    mediaIcon = <Video className="h-3 w-3" />;
    previewBody = (
      <div className="relative h-full w-full">
        <video
          src={preview.url}
          poster={preview.posterUrl || undefined}
          className="pointer-events-none h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/60 p-2">
            <Play className="h-4 w-4 text-white" />
          </div>
        </div>
      </div>
    );
  } else if (preview.kind === 'image') {
    mediaLabel = 'Image';
    mediaIcon = <Image className="h-3 w-3" />;
    previewBody = (
      <img
        src={preview.url}
        alt={previewAlt}
        className="pointer-events-none h-full w-full object-cover"
        loading="lazy"
      />
    );
  }

  const statusTimestamp =
    (post.status === 'published' && post.postedAt) ||
    (post.status === 'scheduled' && post.scheduledAt) ||
    post.scheduledAt ||
    post.postedAt ||
    null;
  const statusTimeLabel = statusTimestamp ? formatShortDateTime(statusTimestamp) : null;
  const statusLabel = `${post.status.slice(0, 1).toUpperCase()}${post.status.slice(1)}`;
  const lastEditedLabel = `Last edited ${formatShortDateTime(post.updatedAt || post.createdAt)}`;

  return (
    <Button
      asChild
      variant="ghost"
      className="h-auto w-full items-stretch justify-start p-0 text-left whitespace-normal hover:bg-transparent"
    >
      <button type="button" onClick={onOpen}>
        <div className="space-y-2">
          <div
            className="group relative aspect-square overflow-hidden rounded-lg border"
            style={{ borderColor }}
          >
            <div className="absolute top-2 left-2 z-10">
              <PostStatusTimeBadge
                status={post.status}
                variant="pill"
                title={statusTimeLabel ? `${statusLabel} • ${statusTimeLabel}` : statusLabel}
                aria-label={statusTimeLabel ? `${statusLabel} • ${statusTimeLabel}` : statusLabel}
              >
                {statusTimeLabel ?? statusLabel}
              </PostStatusTimeBadge>
            </div>

            <div className="absolute top-2 right-2 z-10">
              <Badge variant="secondary" className="flex items-center gap-1">
                {mediaIcon}
                <span>{mediaLabel}</span>
              </Badge>
            </div>

            {previewBody}
          </div>

          <div className="space-y-1">
            <div className="line-clamp-2 text-sm font-semibold">
              {post.caption?.trim() ? post.caption.trim() : 'Untitled post'}
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span>{lastEditedLabel}</span>
              {post.campaignName && (
                <span className="inline-flex items-center gap-1">
                  <span
                    className={cn('h-2 w-2 rounded-full border', !post.campaignColor && 'bg-muted')}
                    style={post.campaignColor ? { backgroundColor: post.campaignColor } : undefined}
                  />
                  <span className="max-w-[200px] truncate">{post.campaignName}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
    </Button>
  );
}
