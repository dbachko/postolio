import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Content } from '@/lib/api';
import type { PublishingQueueItem } from '@/lib/api/publishing-queues-client';

import type { OptimisticCalendarOp } from './use-calendar-event-drop';

type UseOptimisticCalendarSyncParams = {
  content: Content[];
  queueItems: PublishingQueueItem[];
  setOptimisticByContentId: Dispatch<SetStateAction<Record<string, OptimisticCalendarOp>>>;
};

export function useOptimisticCalendarSync({
  content,
  queueItems,
  setOptimisticByContentId,
}: UseOptimisticCalendarSyncParams) {
  useEffect(() => {
    const serverById = new Map<string, Content>();
    for (const c of content) {
      if (c?.id) serverById.set(c.id, c);
    }

    setOptimisticByContentId((prev) => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;

      let removedAny = false;
      const next: Record<string, OptimisticCalendarOp> = {};

      for (const [contentId, op] of entries) {
        if (op.action === 'rescheduling') {
          const server = serverById.get(contentId) ?? null;
          const target = op.override?.scheduledAt ?? null;
          if (server?.scheduledAt && target && server.scheduledAt === target) {
            removedAny = true;
            continue;
          }
        }

        if (op.action === 'queueing') {
          const queued = queueItems.find(
            (item) =>
              item.contentId === contentId &&
              typeof item.estimatedScheduledAt === 'string' &&
              item.estimatedScheduledAt.trim().length > 0
          );
          if (queued) {
            removedAny = true;
            continue;
          }
        }

        next[contentId] = op;
      }

      return removedAny ? next : prev;
    });
  }, [content, queueItems, setOptimisticByContentId]);
}
