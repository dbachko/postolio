import { useMemo } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { toast } from 'sonner';
import { DND_ITEM_TYPE } from '../constants';
import type { QueueDragPayload, SlotRowProps } from '../types';
import { canDragScheduledContent, isLaneCompatible, normalizeLaneKeyForContent } from '../utils';

type QueueItemDragMeta = { disabled: boolean; reason: string };

function getQueueItemDragMeta(estimatedItem: SlotRowProps['estimatedItem']): QueueItemDragMeta {
  if (!estimatedItem) {
    return { disabled: false, reason: '' };
  }
  const status =
    typeof (estimatedItem as any)?.content?.status === 'string'
      ? String((estimatedItem as any).content.status).trim()
      : '';
  if (status === 'published') {
    return { disabled: true, reason: 'Published posts cannot be moved.' };
  }
  return { disabled: false, reason: '' };
}

function buildDragPayload(params: {
  estimatedItem: SlotRowProps['estimatedItem'];
  occupiedContent: SlotRowProps['occupiedContent'];
}): QueueDragPayload | null {
  const { estimatedItem, occupiedContent } = params;
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
}

function getCreateDisabledReason(params: {
  isPast: boolean;
  isEmpty: boolean;
  scheduleAheadAtCapacity: boolean;
  scheduleLimitMessage: string;
}) {
  if (params.isPast) {
    return 'This slot is in the past.';
  }
  if (params.isEmpty && params.scheduleAheadAtCapacity) {
    return params.scheduleLimitMessage;
  }
  return null;
}

function getCanDrag(params: {
  dragPayload: QueueDragPayload | null;
  isPast: boolean;
  scheduleAheadAtCapacity: boolean;
  queueItemDragMeta: QueueItemDragMeta;
  occupiedContent: SlotRowProps['occupiedContent'];
}) {
  const { dragPayload, isPast, scheduleAheadAtCapacity, queueItemDragMeta, occupiedContent } =
    params;
  if (!dragPayload) {
    return false;
  }
  if (dragPayload.kind === 'queueItem') {
    return !isPast && !scheduleAheadAtCapacity && !queueItemDragMeta.disabled;
  }
  return canDragScheduledContent(occupiedContent, isPast);
}

function getDragTooltip(params: {
  dragPayload: QueueDragPayload | null;
  canDrag: boolean;
  isPast: boolean;
  occupiedContent: SlotRowProps['occupiedContent'];
  queueItemDragMeta: QueueItemDragMeta;
  scheduleAheadAtCapacity: boolean;
  scheduleLimitMessage: string;
}) {
  const {
    dragPayload,
    canDrag,
    isPast,
    occupiedContent,
    queueItemDragMeta,
    scheduleAheadAtCapacity,
    scheduleLimitMessage,
  } = params;
  if (!dragPayload) {
    return '';
  }
  if (canDrag) {
    return dragPayload.kind === 'queueItem' ? 'Drag to schedule.' : 'Drag to reschedule.';
  }
  if (isPast) {
    return 'Past posts cannot be moved.';
  }
  if (dragPayload.kind === 'queueItem' && scheduleAheadAtCapacity) {
    return scheduleLimitMessage;
  }
  if (dragPayload.kind === 'queueItem' && queueItemDragMeta.disabled) {
    return queueItemDragMeta.reason;
  }
  const status =
    typeof (occupiedContent as any)?.status === 'string'
      ? String((occupiedContent as any).status).trim()
      : '';
  if (status === 'published') {
    return 'Published posts cannot be moved.';
  }
  return 'Dragging is disabled.';
}

function canDropToSlot(params: {
  item: QueueDragPayload;
  isEmpty: boolean;
  isPast: boolean;
  slotLaneKey: QueueDragPayload['laneKey'];
  scheduleAheadAtCapacity: boolean;
}) {
  if (!params.isEmpty || params.isPast) {
    return false;
  }
  if (!isLaneCompatible(params.slotLaneKey, params.item.laneKey)) {
    return false;
  }
  if (params.item.kind === 'queueItem' && params.scheduleAheadAtCapacity) {
    return false;
  }
  return true;
}

async function dropToSlot(params: {
  item: QueueDragPayload;
  isEmpty: boolean;
  isPast: boolean;
  slotLaneKey: QueueDragPayload['laneKey'];
  scheduledAt: string;
  onDropToSlot: SlotRowProps['onDropToSlot'];
  scheduleAheadAtCapacity: boolean;
  scheduleLimitMessage: string;
}) {
  if (
    !canDropToSlot({
      item: params.item,
      isEmpty: params.isEmpty,
      isPast: params.isPast,
      slotLaneKey: params.slotLaneKey,
      scheduleAheadAtCapacity: params.scheduleAheadAtCapacity,
    })
  ) {
    return;
  }
  if (params.item.kind === 'queueItem' && params.scheduleAheadAtCapacity) {
    toast.error(params.scheduleLimitMessage);
    return;
  }
  try {
    await params.onDropToSlot({
      contentId: params.item.contentId,
      scheduledAt: params.scheduledAt,
      sourceQueueItem: params.item.sourceQueueItem ?? null,
    });
    toast.success(params.item.kind === 'queueItem' ? 'Post scheduled' : 'Post rescheduled');
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Failed to schedule';
    toast.error(message || 'Failed to schedule');
  }
}

type SlotRowDndParams = {
  inst: SlotRowProps['inst'];
  isPast: boolean;
  occupiedContent: SlotRowProps['occupiedContent'];
  estimatedItem: SlotRowProps['estimatedItem'];
  onDropToSlot: SlotRowProps['onDropToSlot'];
  scheduleAheadAtCapacity: boolean;
  scheduleLimitMessage: string;
};

function useSlotRowDerivedState(params: SlotRowDndParams) {
  const isEmpty = !params.inst.occupied && !params.estimatedItem;
  const createDisabledReason = getCreateDisabledReason({
    isPast: params.isPast,
    isEmpty,
    scheduleAheadAtCapacity: params.scheduleAheadAtCapacity,
    scheduleLimitMessage: params.scheduleLimitMessage,
  });
  const queueItemDragMeta = useMemo(
    () => getQueueItemDragMeta(params.estimatedItem),
    [params.estimatedItem]
  );
  const dragPayload = useMemo(
    () =>
      buildDragPayload({
        estimatedItem: params.estimatedItem,
        occupiedContent: params.occupiedContent,
      }),
    [params.estimatedItem, params.occupiedContent]
  );
  const canDrag = useMemo(
    () =>
      getCanDrag({
        dragPayload,
        isPast: params.isPast,
        scheduleAheadAtCapacity: params.scheduleAheadAtCapacity,
        queueItemDragMeta,
        occupiedContent: params.occupiedContent,
      }),
    [
      dragPayload,
      params.isPast,
      params.scheduleAheadAtCapacity,
      queueItemDragMeta,
      params.occupiedContent,
    ]
  );
  const dragTooltip = useMemo(
    () =>
      getDragTooltip({
        dragPayload,
        canDrag,
        isPast: params.isPast,
        occupiedContent: params.occupiedContent,
        queueItemDragMeta,
        scheduleAheadAtCapacity: params.scheduleAheadAtCapacity,
        scheduleLimitMessage: params.scheduleLimitMessage,
      }),
    [
      dragPayload,
      canDrag,
      params.isPast,
      params.occupiedContent,
      queueItemDragMeta,
      params.scheduleAheadAtCapacity,
      params.scheduleLimitMessage,
    ]
  );
  return { canDrag, createDisabledReason, dragPayload, dragTooltip, isEmpty };
}

function useSlotRowDndBindings(
  params: SlotRowDndParams & {
    canDrag: boolean;
    dragPayload: QueueDragPayload | null;
    isEmpty: boolean;
  }
) {
  const [{ isOver, canDrop }, dropRef] = useDrop(
    () => ({
      accept: DND_ITEM_TYPE,
      canDrop: (item: QueueDragPayload) =>
        canDropToSlot({
          item,
          isEmpty: params.isEmpty,
          isPast: params.isPast,
          slotLaneKey: params.inst.laneKey,
          scheduleAheadAtCapacity: params.scheduleAheadAtCapacity,
        }),
      drop: async (item: QueueDragPayload) => {
        await dropToSlot({
          item,
          isEmpty: params.isEmpty,
          isPast: params.isPast,
          slotLaneKey: params.inst.laneKey,
          scheduledAt: params.inst.scheduledAt,
          onDropToSlot: params.onDropToSlot,
          scheduleAheadAtCapacity: params.scheduleAheadAtCapacity,
          scheduleLimitMessage: params.scheduleLimitMessage,
        });
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
      }),
    }),
    [
      params.isEmpty,
      params.isPast,
      params.inst.laneKey,
      params.inst.scheduledAt,
      params.onDropToSlot,
      params.scheduleAheadAtCapacity,
      params.scheduleLimitMessage,
    ]
  );
  const [, dragRef] = useDrag(
    () => ({
      type: DND_ITEM_TYPE,
      item: params.dragPayload as QueueDragPayload,
      canDrag: () => Boolean(params.dragPayload && params.canDrag),
    }),
    [params.canDrag, params.dragPayload]
  );
  return { canDrop, dragRef, dropRef, isOver };
}

export function useSlotRowDndState(params: SlotRowDndParams) {
  const derived = useSlotRowDerivedState(params);
  const dnd = useSlotRowDndBindings({ ...params, ...derived });
  return { ...derived, ...dnd };
}
