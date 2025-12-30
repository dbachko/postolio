import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMediaBadgeType } from '@/utils/media-type';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { getPostCardCaptionMeta } from '@/components/post-preview-card/caption-meta';
import { getPostCardDragMeta } from '@/components/post-preview-card/drag-meta';
import type { PostPreviewCardProps } from './types';
import {
  extractHashtags,
  getGroupMeta,
  getOptimisticLabel,
  getPlaceholderCreateParams,
  getPreviewUrl,
  getQueueSlotMeta,
  getStatusTimeInfo,
} from './utils';
import { PostPreviewCardContent } from './components/post-preview-card-content';
import { PostPreviewCardMenu } from './components/post-preview-card-menu';
import { QueueSlotCard } from './components/queue-slot-card';

export function PostPreviewCard({
  item,
  timezone,
  onReschedule,
  primaryAsset,
  socialAccountsById,
  hideDestinations = false,
}: PostPreviewCardProps) {
  const navigate = useNavigate();
  const { openSidebar } = useRightSidebarRouter();

  const optimisticLabel = useMemo(() => getOptimisticLabel(item), [item]);
  const dragMeta = useMemo(() => getPostCardDragMeta(item), [item]);
  const groupMeta = useMemo(() => getGroupMeta(item), [item]);
  const { status, displayTime, statusTooltip } = useMemo(
    () => getStatusTimeInfo(item, timezone),
    [item, timezone]
  );
  const captionMeta = useMemo(() => getPostCardCaptionMeta(item), [item]);
  const previewUrl = useMemo(() => getPreviewUrl(primaryAsset), [primaryAsset]);
  const queueSlotMeta = useMemo(() => getQueueSlotMeta(item, timezone), [item, timezone]);

  const mediaBadgeType = getMediaBadgeType({
    contentType: item.type === 'content' ? item.contentType : null,
    mediaAssets: item.type === 'content' ? item.mediaAssets : null,
    mediaAssetCount: item.type === 'content' ? item.mediaAssetCount : null,
    primaryAssetFileType: primaryAsset?.fileType ?? null,
  });
  const showMediaBadge = item.type !== 'placeholder';

  const onOpenCampaign = useCallback(
    (campaignId: string) => {
      navigate(`/campaigns/${campaignId}`);
    },
    [navigate]
  );

  const handleOpen = useCallback(() => {
    if (item.type === 'placeholder') {
      openSidebar('post-create', { params: getPlaceholderCreateParams(item) });
      return;
    }
    openSidebar('post', { id: item.id });
  }, [item, openSidebar]);

  const handleDuplicate = useCallback(() => {
    if (item.type === 'placeholder') {
      handleOpen();
      return;
    }

    const params = new URLSearchParams();
    if (item.campaignId) params.set('campaignId', item.campaignId);
    if (item.caption) params.set('caption', item.caption);

    const hashtags = extractHashtags(item);
    if (hashtags.length > 0) params.set('hashtags', hashtags.join(' '));

    navigate(`/posts/create?${params.toString()}`);
  }, [handleOpen, item, navigate]);

  if (queueSlotMeta) {
    return <QueueSlotCard queueSlot={queueSlotMeta} onCreate={handleOpen} />;
  }

  return (
    <PostPreviewCardMenu
      item={item}
      status={status}
      groupMeta={groupMeta}
      onOpen={handleOpen}
      onReschedule={onReschedule}
      onDuplicate={handleDuplicate}
    >
      <PostPreviewCardContent
        item={item}
        status={status}
        displayTime={displayTime}
        statusTooltip={statusTooltip}
        dragMeta={dragMeta}
        captionMeta={captionMeta}
        optimisticLabel={optimisticLabel}
        previewUrl={previewUrl}
        showMediaBadge={showMediaBadge}
        mediaBadgeType={mediaBadgeType}
        onOpen={handleOpen}
        hideDestinations={hideDestinations}
        socialAccountsById={socialAccountsById}
        onOpenCampaign={onOpenCampaign}
      />
    </PostPreviewCardMenu>
  );
}
