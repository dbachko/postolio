import type { ReactNode } from 'react';
import {
  Bookmark,
  Globe,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  MoreHorizontal,
  Play,
  Send,
  Share2,
  ThumbsUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ProfileAvatar } from '@/components/ui/profile-avatar';
import { SocialAccountAvatar } from '@/components/social/SocialAccountAvatar';
import { getPlatformConfig } from '@/lib/platform-config';
import { cn } from '@/lib/utils';
import type { PostPreviewItem, PreviewMedia } from './types';

const contentTypeLabel: Record<string, string> = {
  post: 'Post',
  reel: 'Reel',
  story: 'Story',
};

const IG_LIKES_LABEL = '1,024 likes';
const IG_COMMENTS_LABEL = 'View all comments';
const IG_TIMESTAMP_LABEL = '1 minute ago';
const FB_REACTIONS_LABEL = '1.2K';
const FB_COMMENTS_LABEL = '246 comments';
const FB_SHARES_LABEL = '32 shares';

const getAccountDisplayName = (account: PostPreviewItem['account']) => {
  const label = (account.label || '').trim();
  if (label) return label;
  const avatarName = (account.avatarName || '').trim();
  if (avatarName) return avatarName;
  return 'Account';
};

const getPreviewImageUrl = (primaryMedia: PreviewMedia | null) => {
  if (!primaryMedia) return '';
  if (primaryMedia.type === 'video') {
    return primaryMedia.thumbnailUrl || primaryMedia.url || '';
  }
  return primaryMedia.url || '';
};

type MediaFrameProps = {
  media: PreviewMedia[];
  caption: string;
  aspectRatio: string;
  overlayTopLeft?: ReactNode;
  overlayTopRight?: ReactNode;
  className?: string;
};

function MediaFrame({
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
      {imageUrl ? (
        primaryMedia?.type === 'video' && !primaryMedia.thumbnailUrl ? (
          <video
            src={primaryMedia.url}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : (
          <img
            src={imageUrl}
            alt={caption ? `${caption} preview` : 'Post media preview'}
            className="h-full w-full object-cover"
          />
        )
      ) : (
        <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2 text-xs">
          <div className="bg-background border-border flex h-10 w-10 items-center justify-center rounded-full border">
            <ImageIcon className="h-4 w-4" />
          </div>
          <span>Add media to preview</span>
        </div>
      )}

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

function InstagramPreviewCard({ item }: { item: PostPreviewItem }) {
  const { account, content } = item;
  const caption = (content.caption || '').trim();
  const displayName = getAccountDisplayName(account);
  const media = content.media || [];
  const mediaCount = media.length;
  const isVertical = content.contentType === 'story' || content.contentType === 'reel';
  const aspectRatio = isVertical ? '9 / 16' : '4 / 5';
  const showActions = content.contentType !== 'story';

  const overlayTopLeft =
    content.contentType === 'story' ? (
      <div className="bg-background/80 text-foreground rounded-full px-2 py-0.5 text-[10px] font-medium uppercase">
        Story
      </div>
    ) : content.contentType === 'reel' ? (
      <div className="bg-background/80 text-foreground rounded-full px-2 py-0.5 text-[10px] font-medium uppercase">
        Reel
      </div>
    ) : null;

  const overlayTopRight =
    mediaCount > 1 ? (
      <div className="bg-background/80 text-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
        1/{mediaCount}
      </div>
    ) : null;

  return (
    <div className="bg-background border-border overflow-hidden rounded-2xl border shadow-xs">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <ProfileAvatar
            src={account.avatarUrl}
            name={account.avatarName || displayName}
            alt={displayName}
            size="sm"
            className={cn(account.disconnected && 'opacity-60 grayscale')}
          />
          <div className="text-foreground text-sm font-semibold">{displayName}</div>
        </div>
        <MoreHorizontal className="text-muted-foreground h-4 w-4" />
      </div>

      <MediaFrame
        media={media}
        caption={caption}
        aspectRatio={aspectRatio}
        overlayTopLeft={overlayTopLeft}
        overlayTopRight={overlayTopRight}
      />

      {showActions ? (
        <>
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-3">
              <Heart className="text-foreground h-4 w-4" />
              <MessageCircle className="text-foreground h-4 w-4" />
              <Send className="text-foreground h-4 w-4" />
            </div>
            <Bookmark className="text-foreground h-4 w-4" />
          </div>

          <div className="space-y-1 px-3 pb-3 text-sm">
            <div className="text-foreground font-medium">{IG_LIKES_LABEL}</div>
            <p className="text-foreground line-clamp-2 text-sm">
              <span className="font-semibold">{displayName}</span>
              <span className={cn('ml-1', caption ? 'text-foreground' : 'text-muted-foreground')}>
                {caption || 'Add a caption to preview text.'}
              </span>
            </p>
            <div className="text-muted-foreground text-xs">{IG_COMMENTS_LABEL}</div>
            {content.contentType === 'reel' && content.shareToFeed === false ? (
              <div className="text-muted-foreground text-xs">Not shared to feed.</div>
            ) : null}
            <div className="text-muted-foreground text-[10px] tracking-wide uppercase">
              {IG_TIMESTAMP_LABEL}
            </div>
          </div>
        </>
      ) : (
        <div className="text-muted-foreground px-3 py-2 text-xs">
          Stories appear full-screen on Instagram.
        </div>
      )}
    </div>
  );
}

function FacebookPreviewCard({ item }: { item: PostPreviewItem }) {
  const { account, content } = item;
  const caption = (content.caption || '').trim();
  const displayName = getAccountDisplayName(account);
  const media = content.media || [];
  const primaryMedia = media[0] || null;
  const mediaCount = media.length;
  const aspectRatio =
    content.contentType === 'story'
      ? '9 / 16'
      : primaryMedia?.type === 'video'
        ? '16 / 9'
        : '1 / 1';

  const overlayTopRight =
    mediaCount > 1 ? (
      <div className="bg-background/80 text-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
        1/{mediaCount}
      </div>
    ) : null;

  return (
    <div className="bg-background border-border overflow-hidden rounded-xl border shadow-xs">
      <div className="flex items-start justify-between px-3 py-2">
        <div className="flex items-start gap-2">
          <ProfileAvatar
            src={account.avatarUrl}
            name={account.avatarName || displayName}
            alt={displayName}
            size="sm"
            className={cn(account.disconnected && 'opacity-60 grayscale')}
          />
          <div>
            <div className="text-foreground text-sm font-semibold">{displayName}</div>
            <div className="text-muted-foreground flex items-center gap-1 text-xs">
              <span>Just now</span>
              <span className="text-muted-foreground">|</span>
              <Globe className="h-3 w-3" />
              <span>Public</span>
            </div>
          </div>
        </div>
        <MoreHorizontal className="text-muted-foreground h-4 w-4" />
      </div>

      <div className="px-3 pb-2 text-sm">
        {caption ? (
          <p className="text-foreground line-clamp-3">{caption}</p>
        ) : (
          <p className="text-muted-foreground">Add a caption to preview text.</p>
        )}
      </div>

      <MediaFrame
        media={media}
        caption={caption}
        aspectRatio={aspectRatio}
        overlayTopRight={overlayTopRight}
        className="mt-1"
      />

      <div className="border-border text-muted-foreground flex items-center justify-between border-t px-3 py-2 text-xs">
        <div className="flex items-center gap-1">
          <div className="bg-foreground text-background flex h-5 w-5 items-center justify-center rounded-full">
            <ThumbsUp className="h-3 w-3" />
          </div>
          <span className="text-foreground font-medium">{FB_REACTIONS_LABEL}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>{FB_COMMENTS_LABEL}</span>
          <span>|</span>
          <span>{FB_SHARES_LABEL}</span>
        </div>
      </div>

      <div className="border-border text-muted-foreground flex items-center justify-between border-t px-3 py-2 text-xs font-medium">
        <div className="flex items-center gap-1">
          <ThumbsUp className="h-4 w-4" />
          Like
        </div>
        <div className="flex items-center gap-1">
          <MessageCircle className="h-4 w-4" />
          Comment
        </div>
        <div className="flex items-center gap-1">
          <Share2 className="h-4 w-4" />
          Share
        </div>
      </div>
    </div>
  );
}

function GenericPreviewCard({ item }: { item: PostPreviewItem }) {
  const { account, content } = item;
  const caption = (content.caption || '').trim();
  const displayName = getAccountDisplayName(account);
  const platformConfig = getPlatformConfig(account.platform);
  const media = content.media || [];
  const mediaCount = media.length;
  const isVertical = content.contentType === 'story' || content.contentType === 'reel';
  const aspectRatio = isVertical ? '9 / 16' : '1 / 1';
  const overlayTopRight =
    mediaCount > 1 ? (
      <div className="bg-background/80 text-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
        1/{mediaCount}
      </div>
    ) : null;

  return (
    <div className="bg-background border-border flex flex-col gap-3 rounded-lg border p-3 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <SocialAccountAvatar
            platform={account.platform}
            name={account.avatarName}
            src={account.avatarUrl}
            size="sm"
            muted={false}
            disabled={account.disconnected}
          />
          <div className="min-w-0">
            <div className="text-foreground line-clamp-1 text-sm font-semibold">{displayName}</div>
            <div className="text-muted-foreground text-xs">{platformConfig.displayName}</div>
          </div>
        </div>
        <span className="text-muted-foreground text-[10px] uppercase">
          {contentTypeLabel[content.contentType] || 'Post'}
        </span>
      </div>

      <MediaFrame
        media={media}
        caption={caption}
        aspectRatio={aspectRatio}
        overlayTopRight={overlayTopRight}
        className="border-border rounded-md border"
      />

      <p
        className={cn('text-foreground line-clamp-3 text-sm', !caption && 'text-muted-foreground')}
      >
        {caption || 'Add a caption to preview text.'}
      </p>
    </div>
  );
}

export function PlatformPreviewCard({ item }: { item: PostPreviewItem }) {
  const { account, content, note } = item;
  const firstComment = (content.firstComment || '').trim();
  const showMeta = Boolean(note || account.disconnected);
  const showFirstComment =
    account.platform === 'instagram' && firstComment && content.contentType !== 'story';

  let preview: ReactNode;
  if (account.platform === 'instagram') {
    preview = <InstagramPreviewCard item={item} />;
  } else if (account.platform === 'facebook') {
    preview = <FacebookPreviewCard item={item} />;
  } else {
    preview = <GenericPreviewCard item={item} />;
  }

  return (
    <div className="space-y-2">
      {showMeta ? (
        <div className="flex justify-end gap-1">
          {note ? (
            <Badge variant="secondary" className="text-[10px] uppercase">
              {note}
            </Badge>
          ) : null}
          {account.disconnected ? (
            <Badge variant="outline" className="text-[10px]">
              Disconnected
            </Badge>
          ) : null}
        </div>
      ) : null}

      {preview}

      {showFirstComment ? (
        <p className="text-muted-foreground border-border bg-muted/40 line-clamp-2 rounded-lg border px-3 py-2 text-xs">
          <span className="text-foreground font-medium">First comment:</span>
          <span className="ml-1">{firstComment}</span>
        </p>
      ) : null}
    </div>
  );
}
