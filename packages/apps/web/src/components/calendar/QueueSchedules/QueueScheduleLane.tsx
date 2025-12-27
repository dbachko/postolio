import { useCallback, useMemo } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useDrag, useDrop } from 'react-dnd';
import { toast } from 'sonner';

import { getPostImageOrPlaceholder } from '@/lib/placeholders';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { getLaneCreateLabel, getLanePillLabel, laneIcon } from './queue-schedules-utils';

import {
  content as contentApi,
  publishingQueues as publishingQueuesApi,
  type Content,
} from '@/lib/api';
import type {
  PublishingQueueItem,
  PublishingQueueLaneKey,
  PublishingQueueSlotInstance,
} from '@/lib/api/publishing-queues-client';
import type { AssetType } from '@/features/assets/api/client';
import { GripVertical } from 'lucide-react';

export function QueueScheduleLane({
  brandId,
  laneView,
  instances,
  itemsByEstimatedMs,
  calendarContentById,
  assetsById,
  brandTimezone,
  nowUtcMs,
  scheduleAheadAtCapacity,
  scheduleAheadLimits,
  onCreate,
  onOpen,
  unassigned,
  isLoading,
}: {
  brandId: string;
  laneView: 'all' | Exclude<PublishingQueueLaneKey, 'any'>;
  instances: PublishingQueueSlotInstance[];
  itemsByEstimatedMs: Map<number, PublishingQueueItem>;
  calendarContentById: Map<string, Content>;
  assetsById?: Record<string, AssetType | null>;
  brandTimezone: string;
  nowUtcMs: number;
  scheduleAheadAtCapacity: boolean;
  scheduleAheadLimits?: { tier: string; maxAllowed: number; currentCount: number };
  onCreate: (slotIso: string, slotLaneKey: PublishingQueueLaneKey) => void;
  onOpen: (contentId: string) => void;
  unassigned: PublishingQueueItem[];
  isLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const grouped = useMemo(() => {
    const byDay = new Map<string, PublishingQueueSlotInstance[]>();
    for (const inst of instances) {
      const dayKey = formatInTimeZone(new Date(inst.scheduledAt), brandTimezone, 'yyyy-MM-dd');
      if (!byDay.has(dayKey)) byDay.set(dayKey, []);
      byDay.get(dayKey)!.push(inst);
    }
    return Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [brandTimezone, instances]);

  const invalidateAfterChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances'] });
    queryClient.invalidateQueries({ queryKey: ['publishing-queue-items'] });
    queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
  }, [brandId, queryClient]);

  const scheduleLimitMessage = useMemo(() => {
    if (!scheduleAheadLimits) return 'Scheduling limit reached. Upgrade to add more.';
    return `Scheduling limit reached (${scheduleAheadLimits.currentCount}/${scheduleAheadLimits.maxAllowed}). Upgrade to add more.`;
  }, [scheduleAheadLimits]);

  const handleDropToSlot = useCallback(
    async (params: {
      contentId: string;
      scheduledAt: string;
      sourceQueueItem?: { queueId: string; queueItemId: string } | null;
    }) => {
      const { contentId, scheduledAt, sourceQueueItem } = params;

      await contentApi.updateContent({ contentId, scheduledAt });

      if (sourceQueueItem) {
        try {
          await publishingQueuesApi.removeQueueItem(
            sourceQueueItem.queueId,
            sourceQueueItem.queueItemId
          );
        } catch (queueRemoveError) {
          console.error(queueRemoveError);
          toast.error('Scheduled, but failed to remove from queue. Refresh to resolve.');
        }
      }

      invalidateAfterChange();
    },
    [invalidateAfterChange]
  );

  return (
    <div className="p-4">
      {isLoading ? (
        <div className="bg-muted h-32 animate-pulse rounded" />
      ) : instances.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          No upcoming {laneView === 'all' ? '' : `${laneView} `}slots found. Add slots in{' '}
          <Button
            variant="link"
            asChild
            className="h-auto p-0 text-sm font-medium underline underline-offset-4"
          >
            <Link to="/social-accounts/publishing-schedule">Social Accounts</Link>
          </Button>
          .
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([dayKey, dayInstances]) => {
            const first = dayInstances[0];
            const dayLabel = first
              ? formatInTimeZone(new Date(first.scheduledAt), brandTimezone, 'EEE, MMM d')
              : dayKey;
            return (
              <div key={dayKey} className="space-y-2">
                <div className="text-muted-foreground text-xs font-medium">{dayLabel}</div>
                <div className="border-border divide-border divide-y overflow-hidden rounded-md border">
                  {dayInstances.map((inst) => {
                    const slotMs = new Date(inst.scheduledAt).getTime();
                    const isPast = slotMs < nowUtcMs;

                    const estimatedItem = itemsByEstimatedMs.get(slotMs) ?? null;
                    const occupiedContent =
                      inst.occupied && inst.occupiedContentId
                        ? (calendarContentById.get(inst.occupiedContentId) ?? null)
                        : null;

                    const timeLabel = formatInTimeZone(
                      new Date(inst.scheduledAt),
                      brandTimezone,
                      'h:mm a'
                    );

                    const showContentId = occupiedContent?.id || estimatedItem?.contentId || null;
                    const title = showContentId
                      ? getDisplayTitle({
                          caption:
                            occupiedContent?.caption || estimatedItem?.content?.caption || null,
                          contentType:
                            occupiedContent?.contentType ||
                            estimatedItem?.content?.contentType ||
                            null,
                          laneKey:
                            estimatedItem?.laneKey ?? normalizeLaneKeyForContent(occupiedContent),
                        })
                      : null;
                    const contentForThumb = showContentId
                      ? (calendarContentById.get(showContentId) ?? null)
                      : null;
                    const primaryAssetId =
                      contentForThumb?.primaryAssetId ||
                      contentForThumb?.mediaAssets?.[0]?.assetId ||
                      estimatedItem?.content?.primaryAssetId ||
                      estimatedItem?.content?.mediaAssets?.[0]?.assetId ||
                      null;
                    const primaryAsset = primaryAssetId
                      ? (assetsById?.[primaryAssetId] ?? null)
                      : null;
                    const previewUrl =
                      primaryAsset?.fileType === 'video'
                        ? primaryAsset.thumbnailUrl || null
                        : primaryAsset?.thumbnailUrl || primaryAsset?.url || null;

                    return (
                      <SlotRow
                        key={inst.scheduledAt}
                        inst={inst}
                        laneView={laneView}
                        isPast={isPast}
                        timeLabel={timeLabel}
                        showContentId={showContentId}
                        title={title}
                        previewUrl={previewUrl}
                        occupiedContent={occupiedContent}
                        estimatedItem={estimatedItem}
                        onCreate={onCreate}
                        onOpen={onOpen}
                        onDropToSlot={handleDropToSlot}
                        scheduleAheadAtCapacity={scheduleAheadAtCapacity}
                        scheduleLimitMessage={scheduleLimitMessage}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {unassigned.length > 0 ? (
        <>
          <Separator className="my-4" />
          <div className="space-y-2">
            <div className="text-foreground text-sm font-semibold">Queued backlog</div>
            <div className="text-muted-foreground text-xs">
              These items don&apos;t have an estimated slot yet (no slots available in the next 7
              days).
            </div>
            <div className="border-border divide-border divide-y overflow-hidden rounded-md border">
              {unassigned.slice(0, 20).map((item) => (
                <BacklogRow
                  key={item.id}
                  item={item}
                  laneView={laneView}
                  assetsById={assetsById}
                  calendarContentById={calendarContentById}
                  onOpen={onOpen}
                  scheduleAheadAtCapacity={scheduleAheadAtCapacity}
                  scheduleLimitMessage={scheduleLimitMessage}
                />
              ))}
              {unassigned.length > 20 ? (
                <div className="text-muted-foreground px-3 py-2 text-xs">
                  +{unassigned.length - 20} more
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

const DND_ITEM_TYPE = 'POSTOLIO_QUEUE_DND_ITEM';

type QueueDragPayload = {
  kind: 'content' | 'queueItem';
  contentId: string;
  laneKey: PublishingQueueLaneKey;
  sourceQueueItem?: { queueId: string; queueItemId: string } | null;
};

function getUntitledLabel(kind: PublishingQueueLaneKey | string | null): string {
  const normalized = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
  if (normalized === 'reel') return 'Untitled reel';
  if (normalized === 'story') return 'Untitled story';
  return 'Untitled post';
}

function getDisplayTitle(params: {
  caption?: string | null;
  contentType?: string | null;
  laneKey?: PublishingQueueLaneKey | null;
}): string {
  const caption = typeof params.caption === 'string' ? params.caption.trim() : '';
  if (caption.length > 0) return caption;

  const contentType = typeof params.contentType === 'string' ? params.contentType.trim() : '';
  if (contentType.length > 0) return getUntitledLabel(contentType);

  return getUntitledLabel(params.laneKey ?? null);
}

function normalizeLaneKeyForContent(content: Content | null): PublishingQueueLaneKey {
  const ct =
    typeof (content as any)?.contentType === 'string' ? String((content as any).contentType) : '';
  if (ct.trim() === 'reel') return 'reel';
  if (ct.trim() === 'story') return 'story';
  return 'post';
}

function canDragScheduledContent(content: Content | null, isPast: boolean): boolean {
  if (!content) return false;
  if (isPast) return false;
  const status =
    typeof (content as any)?.status === 'string' ? String((content as any).status).trim() : '';
  if (status === 'published') return false;
  const campaignStatus =
    typeof (content as any)?.campaignStatus === 'string'
      ? String((content as any).campaignStatus).trim()
      : '';
  if (campaignStatus === 'paused') return false;
  return true;
}

function isLaneCompatible(
  slotLaneKey: PublishingQueueLaneKey,
  draggedLaneKey: PublishingQueueLaneKey
): boolean {
  if (slotLaneKey === 'any') return true;
  if (draggedLaneKey === 'any') return true;
  return slotLaneKey === draggedLaneKey;
}

function DragHandle({
  disabled,
  dragRef,
  tooltip,
}: {
  disabled: boolean;
  dragRef: (node: HTMLSpanElement | null) => void;
  tooltip?: string;
}) {
  const handle = (
    <span
      ref={dragRef}
      className={cn(
        'text-muted-foreground inline-flex h-8 w-5 shrink-0 items-center justify-center',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'
      )}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      aria-hidden="true"
    >
      <GripVertical className="h-4 w-4" />
    </span>
  );

  if (!tooltip) return handle;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{handle}</TooltipTrigger>
        <TooltipContent>
          <span>{tooltip}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SlotRow({
  inst,
  laneView,
  isPast,
  timeLabel,
  showContentId,
  title,
  previewUrl,
  occupiedContent,
  estimatedItem,
  onCreate,
  onOpen,
  onDropToSlot,
  scheduleAheadAtCapacity,
  scheduleLimitMessage,
}: {
  inst: PublishingQueueSlotInstance;
  laneView: 'all' | Exclude<PublishingQueueLaneKey, 'any'>;
  isPast: boolean;
  timeLabel: string;
  showContentId: string | null;
  title: string | null;
  previewUrl: string | null;
  occupiedContent: Content | null;
  estimatedItem: PublishingQueueItem | null;
  onCreate: (slotIso: string, slotLaneKey: PublishingQueueLaneKey) => void;
  onOpen: (contentId: string) => void;
  onDropToSlot: (params: {
    contentId: string;
    scheduledAt: string;
    sourceQueueItem?: { queueId: string; queueItemId: string } | null;
  }) => Promise<void>;
  scheduleAheadAtCapacity: boolean;
  scheduleLimitMessage: string;
}) {
  const isEmpty = !inst.occupied && !estimatedItem;
  const createDisabledReason = useMemo(() => {
    if (isPast) return 'This slot is in the past.';
    if (isEmpty && scheduleAheadAtCapacity) return scheduleLimitMessage;
    return null;
  }, [isEmpty, isPast, scheduleAheadAtCapacity, scheduleLimitMessage]);
  const queueItemDragMeta = useMemo(() => {
    if (!estimatedItem) return { disabled: false, reason: '' };
    const status =
      typeof (estimatedItem as any)?.content?.status === 'string'
        ? String((estimatedItem as any).content.status).trim()
        : '';
    const campaignStatus =
      typeof (estimatedItem as any)?.content?.campaignStatus === 'string'
        ? String((estimatedItem as any).content.campaignStatus).trim()
        : '';
    if (campaignStatus === 'paused') {
      return {
        disabled: true,
        reason:
          'Dragging is disabled because this campaign is paused. Unpause the campaign to reschedule posts.',
      };
    }
    if (status === 'published') {
      return { disabled: true, reason: 'Published posts cannot be moved.' };
    }
    return { disabled: false, reason: '' };
  }, [estimatedItem]);

  const dragPayload: QueueDragPayload | null = (() => {
    if (estimatedItem) {
      return {
        kind: 'queueItem',
        contentId: estimatedItem.contentId,
        laneKey: estimatedItem.laneKey,
        sourceQueueItem: { queueId: estimatedItem.queueId, queueItemId: estimatedItem.id },
      };
    }
    if (occupiedContent) {
      return {
        kind: 'content',
        contentId: occupiedContent.id,
        laneKey: normalizeLaneKeyForContent(occupiedContent),
        sourceQueueItem: null,
      };
    }
    return null;
  })();

  const canDrag = (() => {
    if (!dragPayload) return false;
    if (dragPayload.kind === 'queueItem')
      return !isPast && !scheduleAheadAtCapacity && !queueItemDragMeta.disabled;
    return canDragScheduledContent(occupiedContent, isPast);
  })();
  const dragTooltip = useMemo(() => {
    if (!dragPayload) return '';
    if (canDrag)
      return dragPayload.kind === 'queueItem' ? 'Drag to schedule.' : 'Drag to reschedule.';
    if (isPast) return 'Past posts cannot be moved.';
    if (dragPayload.kind === 'queueItem' && scheduleAheadAtCapacity) return scheduleLimitMessage;
    if (dragPayload.kind === 'queueItem' && queueItemDragMeta.disabled) {
      return queueItemDragMeta.reason;
    }
    const status =
      typeof (occupiedContent as any)?.status === 'string'
        ? String((occupiedContent as any).status).trim()
        : '';
    if (status === 'published') return 'Published posts cannot be moved.';
    const campaignStatus =
      typeof (occupiedContent as any)?.campaignStatus === 'string'
        ? String((occupiedContent as any).campaignStatus).trim()
        : '';
    if (campaignStatus === 'paused')
      return 'Dragging is disabled because this campaign is paused. Unpause the campaign to reschedule posts.';
    return 'Dragging is disabled.';
  }, [
    canDrag,
    dragPayload,
    isPast,
    occupiedContent,
    queueItemDragMeta.disabled,
    queueItemDragMeta.reason,
    scheduleAheadAtCapacity,
    scheduleLimitMessage,
  ]);

  const [{ isOver, canDrop }, dropRef] = useDrop(
    () => ({
      accept: DND_ITEM_TYPE,
      canDrop: (item: QueueDragPayload) => {
        if (!isEmpty) return false;
        if (isPast) return false;
        if (!isLaneCompatible(inst.laneKey, item.laneKey)) return false;
        if (item.kind === 'queueItem' && scheduleAheadAtCapacity) return false;
        return true;
      },
      drop: async (item: QueueDragPayload) => {
        if (!isEmpty) return;
        if (isPast) return;
        if (!isLaneCompatible(inst.laneKey, item.laneKey)) return;
        if (item.kind === 'queueItem' && scheduleAheadAtCapacity) {
          toast.error(scheduleLimitMessage);
          return;
        }
        try {
          await onDropToSlot({
            contentId: item.contentId,
            scheduledAt: inst.scheduledAt,
            sourceQueueItem: item.sourceQueueItem ?? null,
          });
          toast.success(item.kind === 'queueItem' ? 'Post scheduled' : 'Post rescheduled');
        } catch (error) {
          console.error(error);
          const message = error instanceof Error ? error.message : 'Failed to schedule';
          toast.error(message || 'Failed to schedule');
        }
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
      }),
    }),
    [
      inst.laneKey,
      inst.scheduledAt,
      isEmpty,
      isPast,
      onDropToSlot,
      scheduleAheadAtCapacity,
      scheduleLimitMessage,
    ]
  );

  const [, dragRef] = useDrag(
    () => ({
      type: DND_ITEM_TYPE,
      item: dragPayload as QueueDragPayload,
      canDrag: () => Boolean(dragPayload && canDrag),
    }),
    [dragPayload, canDrag]
  );

  return (
    <div
      ref={dropRef as any}
      className={cn(
        'hover:bg-muted/50 flex items-center justify-between gap-3 px-3 py-2.5 transition-colors',
        isPast && 'opacity-70',
        canDrop && 'bg-muted/40',
        isOver && canDrop && 'ring-ring/20 ring-2'
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {dragPayload ? (
            <DragHandle disabled={!canDrag} dragRef={dragRef as any} tooltip={dragTooltip} />
          ) : (
            <span className="inline-flex h-8 w-5 shrink-0" aria-hidden="true" />
          )}
          <div className="text-foreground w-16 shrink-0 text-sm font-medium">{timeLabel}</div>
          <div className="bg-muted border-border relative h-9 w-9 shrink-0 overflow-hidden rounded-md border">
            {showContentId ? (
              <img
                src={getPostImageOrPlaceholder(previewUrl)}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="text-muted-foreground flex h-full w-full items-center justify-center">
                {laneIcon(laneView === 'all' ? inst.laneKey : laneView)}
              </div>
            )}
            {laneView === 'all' && showContentId ? (
              <div className="bg-background/80 border-border text-foreground absolute right-0.5 bottom-0.5 rounded-full border p-0.5">
                <span className="sr-only">{getLanePillLabel(inst.laneKey)}</span>
                {laneIcon(inst.laneKey, 'h-3 w-3')}
              </div>
            ) : null}
          </div>
          <div className="min-w-0">
            {inst.occupied ? (
              <div className="text-foreground truncate text-sm font-medium">Scheduled</div>
            ) : estimatedItem ? (
              <div className="text-foreground truncate text-sm font-medium">Queued</div>
            ) : (
              <div className="text-muted-foreground truncate text-sm font-medium">Empty slot</div>
            )}
            {title ? <div className="text-muted-foreground truncate text-xs">{title}</div> : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {showContentId ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onOpen(showContentId)}>
            Open
          </Button>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={Boolean(createDisabledReason)}
                    onClick={() => onCreate(inst.scheduledAt, inst.laneKey)}
                  >
                    {getLaneCreateLabel(laneView === 'all' ? inst.laneKey : laneView)}
                  </Button>
                </span>
              </TooltipTrigger>
              {createDisabledReason ? (
                <TooltipContent>
                  <span>{createDisabledReason}</span>
                </TooltipContent>
              ) : null}
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}

function BacklogRow({
  item,
  laneView,
  assetsById,
  calendarContentById,
  onOpen,
  scheduleAheadAtCapacity,
  scheduleLimitMessage,
}: {
  item: PublishingQueueItem;
  laneView: 'all' | Exclude<PublishingQueueLaneKey, 'any'>;
  assetsById?: Record<string, AssetType | null>;
  calendarContentById: Map<string, Content>;
  onOpen: (contentId: string) => void;
  scheduleAheadAtCapacity: boolean;
  scheduleLimitMessage: string;
}) {
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
