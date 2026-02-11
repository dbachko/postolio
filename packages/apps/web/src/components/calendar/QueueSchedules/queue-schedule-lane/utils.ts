import type { Content } from '@/lib/api';
import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';

function getUntitledLabel(kind: PublishingQueueLaneKey | string | null): string {
  const normalized = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
  if (normalized === 'reel') return 'Untitled reel';
  if (normalized === 'story') return 'Untitled story';
  return 'Untitled post';
}

export function getDisplayTitle(params: {
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

export function normalizeLaneKeyForContent(content: Content | null): PublishingQueueLaneKey {
  const ct =
    typeof (content as any)?.contentType === 'string' ? String((content as any).contentType) : '';
  if (ct.trim() === 'reel') return 'reel';
  if (ct.trim() === 'story') return 'story';
  return 'post';
}

export function canDragScheduledContent(content: Content | null, isPast: boolean): boolean {
  if (!content) return false;
  if (isPast) return false;
  const status =
    typeof (content as any)?.status === 'string' ? String((content as any).status).trim() : '';
  if (status === 'published') return false;
  return true;
}

export function isLaneCompatible(
  slotLaneKey: PublishingQueueLaneKey,
  draggedLaneKey: PublishingQueueLaneKey
): boolean {
  if (slotLaneKey === 'any') return true;
  if (draggedLaneKey === 'any') return true;
  return slotLaneKey === draggedLaneKey;
}
