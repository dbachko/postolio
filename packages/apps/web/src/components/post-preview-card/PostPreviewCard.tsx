import { useMemo, useCallback } from 'react';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { getMediaBadgeType } from '@/utils/media-type';
import { CampaignDotLight } from './components/CampaignDotLight';
import { DestinationIndicatorLight } from './components/DestinationIndicatorLight';
import { getPostCardCaptionMeta } from './caption-meta';
import { QueueSlotCard } from './components/QueueSlotCard';
import { PostCard } from './components/PostCard';
import { StatusBadgeLight } from './components/StatusBadgeLight';
import { useCardWidth } from './hooks/use-card-width';
import { extractPostMeta, getOptimisticLabel, getPreviewUrl } from './utils/post-meta';
import { extractQueueSlotMeta, extractPlaceholderParams } from './utils/queue-slot-meta';
import { asRecord } from './types';
import type { PostPreviewCardProps } from './types';

/**
 * Lightweight preview card for posts in the calendar grid.
 */
export function PostPreviewCard({
  item,
  timezone,
  primaryAsset,
  socialAccountsById,
  hideDestinations = false,
}: PostPreviewCardProps) {
  const { openSidebar } = useRightSidebarRouter();
  const { cardRef, isWide } = useCardWidth();

  // ─────────────────────────────────────────────────────────────────────────
  // Derived metadata (memoized)
  // ─────────────────────────────────────────────────────────────────────────

  const postMeta = useMemo(() => extractPostMeta(item, timezone), [item, timezone]);

  const queueSlotMeta = useMemo(() => extractQueueSlotMeta(item, timezone), [item, timezone]);

  const captionMeta = useMemo(() => getPostCardCaptionMeta(item), [item]);

  const optimisticLabel = useMemo(() => getOptimisticLabel(item), [item]);

  const previewUrl = useMemo(() => getPreviewUrl(primaryAsset), [primaryAsset]);

  const mediaBadgeType = useMemo(() => {
    const record = asRecord(item);
    return getMediaBadgeType({
      contentType: typeof record.contentType === 'string' ? record.contentType : undefined,
      mediaAssets: Array.isArray(record.mediaAssets) ? record.mediaAssets : undefined,
      mediaAssetCount:
        typeof record.mediaAssetCount === 'number' ? record.mediaAssetCount : undefined,
      primaryAssetFileType: primaryAsset?.fileType ?? null,
    });
  }, [item, primaryAsset?.fileType]);

  const showMediaBadge = item.type !== 'placeholder';

  // ─────────────────────────────────────────────────────────────────────────
  // Callbacks
  // ─────────────────────────────────────────────────────────────────────────

  const handleOpen = useCallback(() => {
    if (item.type === 'placeholder') {
      const params = extractPlaceholderParams(item);
      openSidebar('post-create', { params });
      return;
    }
    openSidebar('post', { id: postMeta.id });
  }, [item, openSidebar, postMeta.id]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  // Queue slot placeholder
  if (queueSlotMeta) {
    return <QueueSlotCard meta={queueSlotMeta} onOpen={handleOpen} />;
  }

  // Lightweight indicators (no tooltips)
  const indicators =
    item.type !== 'placeholder' ? (
      <div className="flex items-center gap-1">
        <CampaignDotLight item={item} />
        <DestinationIndicatorLight
          item={item}
          hideDestinations={hideDestinations}
          socialAccountsById={socialAccountsById}
        />
      </div>
    ) : null;

  // Status badge
  const statusBadge = (
    <StatusBadgeLight status={postMeta.status} displayTime={postMeta.displayTime} />
  );

  return (
    <PostCard
      cardRef={cardRef}
      isWide={isWide}
      onClick={handleOpen}
      statusBadge={statusBadge}
      previewUrl={previewUrl}
      mediaBadgeType={mediaBadgeType}
      showMediaBadge={showMediaBadge}
      captionText={captionMeta.text}
      captionIsFallback={captionMeta.isFallback}
      isPlaceholder={item.type === 'placeholder'}
      topRightIndicators={indicators}
      optimisticLabel={optimisticLabel}
    />
  );
}
