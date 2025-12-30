import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Content } from '@/lib/api';
import type { Asset } from '@/features/assets/api/client';
import { formatInUserTimezone } from '@/lib/timezone';
import { getPostImageOrPlaceholder } from '@/lib/placeholders';
import { getMediaBadgeType } from '@/utils/media-type';
import { MediaTypeBadge } from '@/components/media-type-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DashboardPostCard } from '@/components/dashboard/dashboard-post-card';

type DashboardPostPreviewCardProps = {
  post: Content;
  primaryAsset: Asset | null;
  brandTimezone?: string;
  timestampLabel: string;
  timestamp: string;
  actionLabel: string;
  actionTo: string;
  extraBadges?: ReactNode;
};

export function DashboardPostPreviewCard({
  post,
  primaryAsset,
  brandTimezone,
  timestampLabel,
  timestamp,
  actionLabel,
  actionTo,
  extraBadges,
}: DashboardPostPreviewCardProps) {
  const previewThumbnail =
    primaryAsset?.fileType === 'video'
      ? {
          kind: 'video' as const,
          src: primaryAsset.url,
          posterSrc: primaryAsset.thumbnailUrl || null,
        }
      : {
          kind: 'image' as const,
          src: getPostImageOrPlaceholder(primaryAsset?.thumbnailUrl || primaryAsset?.url || null),
        };

  const mediaBadgeType = getMediaBadgeType({
    contentType: post.contentType,
    mediaAssets: post.mediaAssets,
    mediaAssetCount: post.mediaAssetCount,
    primaryAssetFileType: primaryAsset?.fileType ?? null,
  });

  return (
    <DashboardPostCard
      thumbnail={previewThumbnail}
      action={
        <Button asChild size="sm" variant="outline">
          <Link to={actionTo}>{actionLabel}</Link>
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <MediaTypeBadge
          type={mediaBadgeType}
          className="pointer-events-none p-0.5"
          iconClassName="h-3 w-3"
        />
        <span className="text-sm font-medium">
          {timestampLabel} {formatInUserTimezone(timestamp, 'EEE, MMM d • h:mm a', brandTimezone)}
        </span>
        {post.campaignName ? <Badge variant="secondary">{post.campaignName}</Badge> : null}
        {extraBadges}
      </div>
      <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">
        {post.caption?.trim() ? post.caption.trim() : 'Untitled post'}
      </p>
    </DashboardPostCard>
  );
}
