import { useDrag } from 'react-dnd';

import { getPostImageOrPlaceholder } from '@/lib/placeholders';

import { Button } from '@/components/ui/button';

import {
  getLanePillLabel,
  laneIcon,
} from '@/components/calendar/QueueSchedules/queue-schedules-utils';

import { DND_ITEM_TYPE } from '../constants';
import type { BacklogRowProps, QueueDragPayload } from '../types';
import { getDisplayTitle } from '../utils';
import { DragHandle } from './drag-handle';

export function BacklogRow({
  item,
  laneView,
  assetsById,
  calendarContentById,
  onOpen,
  scheduleAheadAtCapacity,
  scheduleLimitMessage,
}: BacklogRowProps) {
  const contentForThumb = calendarContentById.get(item.contentId) ?? null;
  const contentForRules =
    (calendarContentById.get(item.contentId) as any) ?? (item.content as any) ?? null;
  const primaryAssetId =
    contentForThumb?.primaryAssetId ||
    contentForThumb?.mediaAssets?.[0]?.assetId ||
    item.content?.primaryAssetId ||
    item.content?.mediaAssets?.[0]?.assetId ||
    null;
  const primaryAsset = primaryAssetId ? (assetsById?.[primaryAssetId] ?? null) : null;
  const previewUrl =
    primaryAsset?.fileType === 'video'
      ? primaryAsset.thumbnailUrl || primaryAsset.url || null
      : primaryAsset?.thumbnailUrl || primaryAsset?.url || null;

  const payload: QueueDragPayload = {
    kind: 'queueItem',
    contentId: item.contentId,
    laneKey: item.laneKey,
    sourceQueueItem: { queueId: item.queueId, queueItemId: item.id },
  };

  const contentStatus =
    typeof contentForRules?.status === 'string' ? String(contentForRules.status).trim() : '';
  const campaignStatus =
    typeof contentForRules?.campaignStatus === 'string'
      ? String(contentForRules.campaignStatus).trim()
      : '';
  const blockedByCampaign = campaignStatus === 'paused';
  const blockedByStatus = contentStatus === 'published';
  const canDrag = !scheduleAheadAtCapacity && !blockedByCampaign && !blockedByStatus;
  const dragTooltip = (() => {
    if (canDrag) return 'Drag to schedule.';
    if (scheduleAheadAtCapacity) return scheduleLimitMessage;
    if (blockedByCampaign)
      return 'Dragging is disabled because this campaign is paused. Unpause the campaign to reschedule posts.';
    if (blockedByStatus) return 'Published posts cannot be moved.';
    return 'Dragging is disabled.';
  })();
  const [, dragRef] = useDrag(
    () => ({
      type: DND_ITEM_TYPE,
      item: payload,
      canDrag: () => canDrag,
    }),
    [canDrag, item.id]
  );

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="hover:bg-muted h-auto w-full justify-between px-3 py-2 text-left"
      onClick={() => onOpen(item.contentId)}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <DragHandle disabled={!canDrag} dragRef={dragRef as any} tooltip={dragTooltip} />

        <div className="bg-muted border-border relative h-9 w-9 shrink-0 overflow-hidden rounded-md border">
          <img
            src={getPostImageOrPlaceholder(previewUrl)}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
          {laneView === 'all' ? (
            <div className="bg-background/80 border-border text-foreground absolute right-0.5 bottom-0.5 rounded-full border p-0.5">
              <span className="sr-only">{getLanePillLabel(item.laneKey)}</span>
              {laneIcon(item.laneKey, 'h-3 w-3')}
            </div>
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="text-foreground truncate text-sm font-medium">
            {getDisplayTitle({
              caption: item.content?.caption ?? null,
              contentType: item.content?.contentType ?? null,
              laneKey: item.laneKey,
            })}
          </div>
          <div className="text-muted-foreground truncate text-xs">Queued</div>
        </div>
      </div>

      <div className="text-muted-foreground shrink-0 text-xs">Open</div>
    </Button>
  );
}
