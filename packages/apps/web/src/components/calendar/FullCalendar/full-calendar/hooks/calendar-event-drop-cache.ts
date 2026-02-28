import { formatInTimeZone } from 'date-fns-tz';
import type { Content } from '@/lib/api';
import type {
  CalendarDropContext,
  OptimisticCalendarAction,
  OptimisticCalendarOp,
} from './calendar-event-drop-types';

export function upsertCalendarCache({
  brandId,
  brandTimezone,
  queryClient,
  nextItem,
}: {
  brandId: string;
  brandTimezone: string;
  queryClient: CalendarDropContext['queryClient'];
  nextItem: Content;
}) {
  if (!nextItem?.scheduledAt) {
    return;
  }
  const monthKey = formatInTimeZone(new Date(nextItem.scheduledAt), brandTimezone, 'yyyy-MM');
  queryClient.setQueryData(['calendar', brandId, monthKey], (previous: any) => {
    const list = previous?.data?.content;
    if (!Array.isArray(list)) {
      return previous;
    }

    const existingIndex = list.findIndex((content: any) => content && content.id === nextItem.id);
    const merged = {
      ...(existingIndex >= 0 ? (list[existingIndex] as any) : {}),
      ...(nextItem as any),
      publishingQueueItemId: null,
    };
    const nextList =
      existingIndex >= 0
        ? list.map((content: any, index: number) => (index === existingIndex ? merged : content))
        : [...list, merged];

    return {
      ...previous,
      data: {
        ...previous.data,
        content: nextList,
      },
    };
  });
}

export function removeQueueItemFromCalendarCache({
  queryClient,
  queueId,
  viewKey,
  queueItemId,
  contentId,
}: {
  queryClient: CalendarDropContext['queryClient'];
  queueId: string;
  viewKey: string;
  queueItemId: string;
  contentId: string;
}) {
  queryClient.setQueryData(
    ['publishing-queue-items-calendar', queueId, viewKey],
    (previous: any) => {
      const lanes = previous?.data?.lanes;
      if (!Array.isArray(lanes)) {
        return previous;
      }

      const nextLanes = lanes.map((lane: any) => {
        const items = lane?.items;
        if (!Array.isArray(items)) {
          return lane;
        }
        return {
          ...lane,
          items: items.filter(
            (item: any) => item?.id !== queueItemId && item?.contentId !== contentId
          ),
        };
      });

      return {
        ...previous,
        data: {
          ...previous.data,
          lanes: nextLanes,
        },
      };
    }
  );
}

export function adjustQueueDepth({
  queryClient,
  effectiveSingleDestinationId,
  delta,
}: {
  queryClient: CalendarDropContext['queryClient'];
  effectiveSingleDestinationId: string | null;
  delta: number;
}) {
  if (!effectiveSingleDestinationId) {
    return;
  }
  queryClient.setQueryData(['publishing-queues', effectiveSingleDestinationId], (previous: any) => {
    const currentDepth = previous?.data?.queueDepthCurrent;
    if (typeof currentDepth !== 'number' || !Number.isFinite(currentDepth)) {
      return previous;
    }

    return {
      ...previous,
      data: {
        ...previous.data,
        queueDepthCurrent: Math.max(0, currentDepth + delta),
      },
    };
  });
}

export function clearOptimistic({
  contentId,
  optimisticClearTimersRef,
  setOptimisticByContentId,
}: {
  contentId: string;
  optimisticClearTimersRef: CalendarDropContext['optimisticClearTimersRef'];
  setOptimisticByContentId: CalendarDropContext['setOptimisticByContentId'];
}) {
  const timers = optimisticClearTimersRef.current;
  if (timers[contentId]) {
    window.clearTimeout(timers[contentId]);
    delete timers[contentId];
  }
  setOptimisticByContentId((previous) => {
    if (!(contentId in previous)) {
      return previous;
    }
    const next = { ...previous };
    delete next[contentId];
    return next;
  });
}

export function setOptimistic({
  action,
  contentId,
  optimisticClearTimersRef,
  override,
  setOptimisticByContentId,
}: {
  action: OptimisticCalendarAction;
  contentId: string;
  optimisticClearTimersRef: CalendarDropContext['optimisticClearTimersRef'];
  override: Content;
  setOptimisticByContentId: CalendarDropContext['setOptimisticByContentId'];
}) {
  setOptimisticByContentId((previous: Record<string, OptimisticCalendarOp>) => ({
    ...previous,
    [contentId]: {
      override,
      action,
      startedAtMs: Date.now(),
    },
  }));

  const timers = optimisticClearTimersRef.current;
  if (timers[contentId]) {
    window.clearTimeout(timers[contentId]);
  }
  timers[contentId] = window.setTimeout(
    () => clearOptimistic({ contentId, optimisticClearTimersRef, setOptimisticByContentId }),
    15_000
  );
}
