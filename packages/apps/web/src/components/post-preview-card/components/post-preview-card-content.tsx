import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { cn } from '@/lib/utils';
import type { CalendarItem } from '@/types/calendar';
import type { SocialAccountsById } from '@/types/social-accounts';
import type { MediaBadgeType } from '@/utils/media-type';
import type { PostCardDragMeta } from '../drag-meta';
import { POST_PREVIEW_WIDE_MIN_WIDTH_PX } from '../constants';
import type { PostStatus } from '../types';
import { DestinationIndicator } from './destination-indicator';
import { GenerationIndicator } from './generation-indicator';
import { OptimisticIndicator } from './optimistic-indicator';
import { PreviewImage } from './preview-image';
import { SeriesIndicator } from './series-indicator';
import { StatusBadge } from './status-badge';

type PostPreviewCardContentProps = {
  item: CalendarItem;
  status: PostStatus;
  displayTime: string;
  statusTooltip: string;
  dragMeta: PostCardDragMeta;
  captionMeta: { text: string; isFallback: boolean };
  optimisticLabel: string | null;
  previewUrl: string | null;
  showMediaBadge: boolean;
  mediaBadgeType: MediaBadgeType;
  onOpen: () => void;
  hideDestinations: boolean;
  socialAccountsById?: SocialAccountsById;
};

function useWideCard(ref: RefObject<HTMLDivElement | null>) {
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const element = ref.current;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? 0;
      setIsWide(width >= POST_PREVIEW_WIDE_MIN_WIDTH_PX);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return isWide;
}

function PostIndicators({
  item,
  hideDestinations,
  socialAccountsById,
}: Pick<PostPreviewCardContentProps, 'item' | 'hideDestinations' | 'socialAccountsById'>) {
  if (item.type === 'placeholder') {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      <SeriesIndicator item={item} />
      <GenerationIndicator item={item} />
      <DestinationIndicator
        item={item}
        hideDestinations={hideDestinations}
        socialAccountsById={socialAccountsById}
      />
    </div>
  );
}

function WidePostContent({
  previewUrl,
  showMediaBadge,
  mediaBadgeType,
  statusBadge,
  captionMeta,
}: {
  previewUrl: string | null;
  showMediaBadge: boolean;
  mediaBadgeType: MediaBadgeType;
  statusBadge: ReactNode;
  captionMeta: PostPreviewCardContentProps['captionMeta'];
}) {
  return (
    <>
      <PreviewImage
        previewUrl={previewUrl}
        showMediaBadge={showMediaBadge}
        mediaBadgeType={mediaBadgeType}
        className="h-full w-14 self-stretch"
      />
      <ItemContent className="min-w-0">
        <ItemTitle className="font-normal">{statusBadge}</ItemTitle>
        <ItemDescription
          className={cn(
            'mt-1 line-clamp-1 min-h-[1.4em] text-[12px] leading-snug',
            captionMeta.isFallback ? 'text-muted-foreground italic' : 'text-foreground'
          )}
        >
          {captionMeta.text}
        </ItemDescription>
      </ItemContent>
    </>
  );
}

function NarrowPostContent({
  item,
  previewUrl,
  showMediaBadge,
  mediaBadgeType,
  statusBadge,
  captionMeta,
}: {
  item: CalendarItem;
  previewUrl: string | null;
  showMediaBadge: boolean;
  mediaBadgeType: MediaBadgeType;
  statusBadge: ReactNode;
  captionMeta: PostPreviewCardContentProps['captionMeta'];
}) {
  return (
    <>
      <ItemTitle className="font-normal">{statusBadge}</ItemTitle>
      <div className="flex min-w-0 items-start gap-2 text-[12px] leading-snug">
        <PreviewImage
          previewUrl={previewUrl}
          showMediaBadge={showMediaBadge}
          mediaBadgeType={mediaBadgeType}
          className="h-[3em] w-[3em] shrink-0"
        />
        <ItemDescription
          className={cn(
            'line-clamp-2 min-w-0 flex-1',
            captionMeta.isFallback ? 'text-muted-foreground italic' : 'text-foreground'
          )}
        >
          {item.type === 'placeholder' ? '' : captionMeta.text}
        </ItemDescription>
      </div>
    </>
  );
}

export function PostPreviewCardContent({
  item,
  status,
  displayTime,
  statusTooltip,
  dragMeta,
  captionMeta,
  optimisticLabel,
  previewUrl,
  showMediaBadge,
  mediaBadgeType,
  onOpen,
  hideDestinations,
  socialAccountsById,
}: PostPreviewCardContentProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const isWide = useWideCard(cardRef);
  const indicators = (
    <PostIndicators
      item={item}
      hideDestinations={hideDestinations}
      socialAccountsById={socialAccountsById}
    />
  );

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  };

  const statusBadge = (
    <StatusBadge
      status={status}
      displayTime={displayTime}
      statusTooltip={statusTooltip}
      dragMeta={dragMeta}
    />
  );

  return (
    <Item
      ref={cardRef}
      variant="outline"
      size="sm"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      className={cn(
        'group bg-card hover:bg-muted/50 relative flex h-[var(--calendar-card-h)] w-full cursor-pointer p-2 text-left shadow-sm transition-colors select-none focus-visible:ring-2',
        optimisticLabel && 'opacity-90',
        isWide ? 'flex-nowrap items-stretch gap-2' : 'flex-col items-stretch justify-start gap-2'
      )}
    >
      {indicators ? (
        <div className="absolute top-2 right-2 z-10 origin-top-right scale-90">{indicators}</div>
      ) : null}

      {isWide ? (
        <WidePostContent
          previewUrl={previewUrl}
          showMediaBadge={showMediaBadge}
          mediaBadgeType={mediaBadgeType}
          statusBadge={statusBadge}
          captionMeta={captionMeta}
        />
      ) : (
        <NarrowPostContent
          item={item}
          previewUrl={previewUrl}
          showMediaBadge={showMediaBadge}
          mediaBadgeType={mediaBadgeType}
          statusBadge={statusBadge}
          captionMeta={captionMeta}
        />
      )}

      {optimisticLabel ? <OptimisticIndicator label={optimisticLabel} /> : null}
    </Item>
  );
}
