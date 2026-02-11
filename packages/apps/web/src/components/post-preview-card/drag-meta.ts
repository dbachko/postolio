import type { CalendarItem } from '@/types/calendar';

export type PostCardDragMeta = {
  show: boolean;
  canDrag: boolean;
  tooltip: string;
};

export function getPostCardDragMeta(item: CalendarItem): PostCardDragMeta {
  if (item.type === 'placeholder') return { show: false, canDrag: false, tooltip: '' };

  const record = item as unknown as Record<string, unknown>;

  const itemStatus = typeof record.status === 'string' ? record.status.trim() : '';
  if (itemStatus === 'published') {
    return { show: true, canDrag: false, tooltip: 'Published posts cannot be moved.' };
  }

  const optimisticAction =
    typeof record.optimisticAction === 'string' ? record.optimisticAction.trim() : '';
  if (optimisticAction.length > 0) {
    return { show: true, canDrag: false, tooltip: 'This post is updating. Try again in a moment.' };
  }

  const publishingQueueItemId =
    typeof record.publishingQueueItemId === 'string' ? record.publishingQueueItemId.trim() : '';
  const scheduledAt = typeof record.scheduledAt === 'string' ? record.scheduledAt.trim() : '';

  const canDrag = publishingQueueItemId.length > 0 || scheduledAt.length > 0;
  if (!canDrag) {
    return {
      show: true,
      canDrag: false,
      tooltip: 'Drag-and-drop is only available for scheduled posts.',
    };
  }

  return { show: true, canDrag: true, tooltip: 'Drag to reschedule.' };
}
