import { Bookmark, Heart, MessageCircle, MoreHorizontal, Send } from 'lucide-react';
import { ProfileAvatar } from '@/components/ui/profile-avatar';
import { cn } from '@/lib/utils';
import type { PostPreviewItem } from '../../types';
import { IG_COMMENTS_LABEL, IG_TIMESTAMP_LABEL } from '../constants';
import { getAccountDisplayName, stripLeadingAt } from '../utils';
import { MediaFrame } from './media-frame';

function getTopLeftOverlay(contentType: PostPreviewItem['content']['contentType']) {
  if (contentType !== 'story' && contentType !== 'reel') {
    return null;
  }
  return (
    <div className="bg-background/80 text-foreground rounded-full px-2 py-0.5 text-[10px] font-medium uppercase">
      {contentType === 'story' ? 'Story' : 'Reel'}
    </div>
  );
}

export function InstagramPreviewCard({ item }: { item: PostPreviewItem }) {
  const { account, content } = item;
  const caption = (content.caption || '').trim();
  const displayName = stripLeadingAt(getAccountDisplayName(account));
  const media = content.media || [];
  const mediaCount = media.length;
  const isVertical = content.contentType === 'story' || content.contentType === 'reel';
  const aspectRatio = isVertical ? '9 / 16' : '4 / 5';
  const showActions = content.contentType !== 'story';
  const overlayTopLeft = getTopLeftOverlay(content.contentType);

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
