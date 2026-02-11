import { useMemo } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { toast } from 'sonner';

import { getPostImageOrPlaceholder } from '@/lib/placeholders';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import {
  getLaneCreateLabel,
  getLanePillLabel,
  laneIcon,
} from '@/components/calendar/QueueSchedules/queue-schedules-utils';

import { DND_ITEM_TYPE } from '../constants';
import type { QueueDragPayload, SlotRowProps } from '../types';
import { canDragScheduledContent, isLaneCompatible, normalizeLaneKeyForContent } from '../utils';
import { DragHandle } from './drag-handle';

export function SlotRow({
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
}: SlotRowProps) {
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
