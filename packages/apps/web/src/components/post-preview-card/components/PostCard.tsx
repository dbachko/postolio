import type { RefObject, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { PostCardImage } from './PostCardImage';
import { OptimisticIndicator } from './OptimisticIndicator';
import type { MediaBadgeType } from '@/utils/media-type';
import { cn } from '@/lib/utils';

interface PostCardProps {
  cardRef: RefObject<HTMLDivElement | null>;
  isWide: boolean;
  onClick: () => void;
  onMouseEnter?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  // Status badge - rendered as a slot to allow light/full versions
  statusBadge: ReactNode;
  // Image props
  previewUrl: string | null;
  mediaBadgeType: MediaBadgeType;
  showMediaBadge: boolean;
  // Caption props
  captionText: string;
  captionIsFallback: boolean;
  isPlaceholder: boolean;
  // Indicators - rendered as a slot
  topRightIndicators: ReactNode;
  optimisticLabel: string | null;
}

/**
 * Unified post card shell that stays stable in the DOM.
 * Status badge and indicators are passed as slots to allow swapping
 * between light/interactive versions without remounting the image.
 */
export function PostCard({
  cardRef,
  isWide,
  onClick,
  onMouseEnter,
  onContextMenu,
  statusBadge,
  previewUrl,
  mediaBadgeType,
  showMediaBadge,
  captionText,
  captionIsFallback,
  isPlaceholder,
  topRightIndicators,
  optimisticLabel,
}: PostCardProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  const indicators = topRightIndicators ? (
    <div className="absolute top-2 right-2 z-10 origin-top-right scale-90">
      {topRightIndicators}
    </div>
  ) : null;

  const baseClassName = cn(
    'group bg-card hover:bg-muted/50 relative flex w-full cursor-pointer gap-2 p-2 text-left shadow-sm transition-colors select-none focus-visible:ring-2',
    'h-[var(--calendar-card-h)]',
    optimisticLabel && 'opacity-90'
  );

  if (isWide) {
    return (
      <Item
        ref={cardRef}
        variant="outline"
        size="sm"
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={onMouseEnter}
        onContextMenu={onContextMenu}
        className={cn(baseClassName, 'flex-nowrap items-stretch')}
      >
        {indicators}
        <PostCardImage
          previewUrl={previewUrl}
          mediaBadgeType={mediaBadgeType}
          showMediaBadge={showMediaBadge}
          className="h-full w-14 self-stretch"
        />
        <ItemContent className="min-w-0">
          <ItemTitle className="font-normal">{statusBadge}</ItemTitle>
          <ItemDescription
            className={cn(
              'mt-1 line-clamp-1 min-h-[1.4em] text-[12px] leading-snug',
              captionIsFallback ? 'text-muted-foreground italic' : 'text-foreground'
            )}
          >
            {captionText}
          </ItemDescription>
        </ItemContent>
        <OptimisticIndicator label={optimisticLabel} />
      </Item>
    );
  }

  // Narrow layout
  return (
    <Item
      ref={cardRef}
      variant="outline"
      size="sm"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      onContextMenu={onContextMenu}
      className={cn(baseClassName, 'flex-col flex-nowrap items-stretch justify-start')}
    >
      {indicators}
      <ItemTitle className="font-normal">{statusBadge}</ItemTitle>

      <div className="flex min-w-0 items-start gap-2 text-[12px] leading-snug">
        <PostCardImage
          previewUrl={previewUrl}
          mediaBadgeType={mediaBadgeType}
          showMediaBadge={showMediaBadge}
          className="h-[3em] w-[3em] shrink-0"
        />
        <ItemDescription
          className={cn(
            'line-clamp-2 min-w-0 flex-1',
            captionIsFallback ? 'text-muted-foreground italic' : 'text-foreground'
          )}
        >
          {isPlaceholder ? '' : captionText}
        </ItemDescription>
      </div>
      <OptimisticIndicator label={optimisticLabel} />
    </Item>
  );
}
