import { Globe, MessageCircle, MoreHorizontal, Share2, ThumbsUp } from 'lucide-react';
import { ProfileAvatar } from '@/components/ui/profile-avatar';
import { cn } from '@/lib/utils';
import type { PostPreviewItem } from '../../types';
import { FB_COMMENTS_LABEL, FB_REACTIONS_LABEL, FB_SHARES_LABEL } from '../constants';
import { getAccountDisplayName } from '../utils';
import { MediaFrame } from './media-frame';

export function FacebookPreviewCard({ item }: { item: PostPreviewItem }) {
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
