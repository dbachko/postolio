import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { getPlatformConfig } from '@/lib/platform-config';
import { cn } from '@/lib/utils';
import type { PostPreviewItem } from '../../types';
import { CONTENT_TYPE_LABEL } from '../constants';
import { getAccountDisplayName } from '../utils';
import { MediaFrame } from './media-frame';

export function GenericPreviewCard({ item }: { item: PostPreviewItem }) {
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
          {CONTENT_TYPE_LABEL[content.contentType] || 'Post'}
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
