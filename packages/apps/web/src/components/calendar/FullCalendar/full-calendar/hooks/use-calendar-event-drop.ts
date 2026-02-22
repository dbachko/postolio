import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  content as contentApi,
  publishingQueues as publishingQueuesApi,
  type Content,
} from '@/lib/api';

import type { CalendarEvent } from '../../types';

export type OptimisticCalendarAction = 'rescheduling' | 'queueing';

export type OptimisticCalendarOp = {
  override: Content;
  action: OptimisticCalendarAction;
  startedAtMs: number;
};

export type ScheduleAheadLimits = {
  tier: string;
  maxAllowed: number;
  currentCount: number;
};

type UseCalendarEventDropParams = {
  brandId: string;
  brandTimezone: string;
  viewKey: 'month' | 'week';
  queryClient: QueryClient;
  queueId: string | null;
  effectiveSingleDestinationId: string | null;
  scheduleAheadAtCapacity: boolean;
  scheduleAheadLimits?: ScheduleAheadLimits;
  optimisticClearTimersRef: { current: Record<string, number> };
  setOptimisticByContentId: Dispatch<SetStateAction<Record<string, OptimisticCalendarOp>>>;
};

export function useCalendarEventDrop({
  brandId,
  brandTimezone,
  viewKey,
  queryClient,
  queueId,
  effectiveSingleDestinationId,
  scheduleAheadAtCapacity,
  scheduleAheadLimits,
  optimisticClearTimersRef,
  setOptimisticByContentId,
}: UseCalendarEventDropParams) {
  return useCallback(
    async ({
      event,
      start,
      targetEvent,
    }: {
      event: CalendarEvent;
      start: Date;
      targetEvent?: CalendarEvent | null;
    }) => {
      const upsertCalendarCache = (nextItem: Content) => {
        if (!nextItem?.scheduledAt) {
          return;
        }
        const monthKey = formatInTimeZone(new Date(nextItem.scheduledAt), brandTimezone, 'yyyy-MM');
        queryClient.setQueryData(['calendar', brandId, monthKey], (prev: any) => {
          const list = prev?.data?.content;
          if (!Array.isArray(list)) {
            return prev;
          }

          const existingIdx = list.findIndex((c: any) => c && c.id === nextItem.id);
          const merged = {
            ...(existingIdx >= 0 ? (list[existingIdx] as any) : {}),
            ...(nextItem as any),
            publishingQueueItemId: null,
          };

          const nextList =
            existingIdx >= 0
              ? list.map((c: any, i: number) => (i === existingIdx ? merged : c))
              : [...list, merged];

          return {
            ...prev,
            data: {
              ...prev.data,
              content: nextList,
            },
          };
        });
      };

      const removeQueueItemFromCalendarCache = (params: {
        queueId: string;
        viewKey: string;
        queueItemId: string;
        contentId: string;
      }) => {
        queryClient.setQueryData(
          ['publishing-queue-items-calendar', params.queueId, params.viewKey],
          (prev: any) => {
            const lanes = prev?.data?.lanes;
            if (!Array.isArray(lanes)) {
              return prev;
            }
            const nextLanes = lanes.map((lane: any) => {
              const items = lane?.items;
              if (!Array.isArray(items)) {
                return lane;
              }
              return {
                ...lane,
                items: items.filter(
                  (it: any) => it?.id !== params.queueItemId && it?.contentId !== params.contentId
                ),
              };
            });
            return {
              ...prev,
              data: {
                ...prev.data,
                lanes: nextLanes,
              },
            };
          }
        );
      };

      const adjustQueueDepth = (delta: number) => {
        if (!effectiveSingleDestinationId) {
          return;
        }
        queryClient.setQueryData(
          ['publishing-queues', effectiveSingleDestinationId],
          (prev: any) => {
            const current = prev?.data?.queueDepthCurrent;
            if (typeof current !== 'number' || !Number.isFinite(current)) {
              return prev;
            }
            const next = Math.max(0, current + delta);
            return {
              ...prev,
              data: {
                ...prev.data,
                queueDepthCurrent: next,
              },
            };
          }
        );
      };

      const clearOptimistic = (contentId: string) => {
        const timers = optimisticClearTimersRef.current;
        if (timers[contentId]) {
          window.clearTimeout(timers[contentId]);
          delete timers[contentId];
        }
        setOptimisticByContentId((prev) => {
          if (!(contentId in prev)) {
            return prev;
          }
          const next = { ...prev };
          delete next[contentId];
          return next;
        });
      };

      const setOptimistic = (params: {
        contentId: string;
        override: Content;
        action: OptimisticCalendarAction;
      }) => {
        setOptimisticByContentId((prev) => ({
          ...prev,
          [params.contentId]: {
            override: params.override,
            action: params.action,
            startedAtMs: Date.now(),
          },
        }));

        const timers = optimisticClearTimersRef.current;
        if (timers[params.contentId]) {
          window.clearTimeout(timers[params.contentId]);
        }
        timers[params.contentId] = window.setTimeout(
          () => clearOptimistic(params.contentId),
          15_000
        );
      };

      try {
        const resource = event.resource;
        if (resource.placeholder || resource.status === 'published') {
          return;
        }

        if (!start) {
          throw new Error('Missing start date');
        }

        const isQueueSlotTarget = (() => {
          if (!targetEvent?.resource?.placeholder) {
            return false;
          }
          const record = targetEvent.resource.item as any;
          if (record?.message === 'Queue slot') {
            return true;
          }
          return typeof record?.id === 'string' && record.id.startsWith('queue-slot:');
        })();

        if (isQueueSlotTarget) {
          if (!queueId || !effectiveSingleDestinationId) {
            toast.error('Select a single destination to use queue slots.');
            return;
          }

          const targetSlotUtcIso = (() => {
            const v =
              typeof targetEvent?.resource?.scheduledAt === 'string'
                ? targetEvent.resource.scheduledAt.trim()
                : '';
            return v.length > 0 ? v : null;
          })();

          if (!targetSlotUtcIso) {
            toast.error('Missing target slot time.');
            return;
          }

          const targetLaneKey = (() => {
            const rec = targetEvent?.resource?.item as any;
            const lk = typeof rec?.laneKey === 'string' ? rec.laneKey : null;
            if (lk === 'post' || lk === 'reel' || lk === 'story' || lk === 'any') {
              return lk;
            }
            return 'post' as const;
          })();

          const sourceLaneKey = (() => {
            const rec = resource.item as any;
            const ct = typeof rec?.contentType === 'string' ? String(rec.contentType).trim() : '';
            if (ct === 'reel') {
              return 'reel' as const;
            }
            if (ct === 'story') {
              return 'story' as const;
            }
            return 'post' as const;
          })();

          if (targetLaneKey !== 'any' && targetLaneKey !== sourceLaneKey) {
            return;
          }

          const record = resource.item as unknown as Record<string, unknown>;
          const sourceQueueItemId =
            typeof (record as any).publishingQueueItemId === 'string' &&
            (record as any).publishingQueueItemId.trim().length > 0
              ? String((record as any).publishingQueueItemId).trim()
              : null;

          const groupId =
            typeof record.contentGroupId === 'string' && record.contentGroupId.trim().length > 0
              ? record.contentGroupId.trim()
              : null;
          const isMultiDestination = record.isMultiDestination === true && Boolean(groupId);
          if (isMultiDestination) {
            toast.error('Multi-destination posts cannot be moved into a queue slot yet.');
            return;
          }

          if (sourceQueueItemId && scheduleAheadAtCapacity) {
            toast.error(
              `Scheduling limit reached (${scheduleAheadLimits?.currentCount}/${scheduleAheadLimits?.maxAllowed}). Upgrade to add more.`
            );
            return;
          }

          setOptimistic({
            contentId: event.id,
            override: {
              ...(resource.item as any),
              status: 'scheduled',
              scheduledAt: targetSlotUtcIso,
              publishingQueueItemId: null,
            } as Content,
            action: 'rescheduling',
          });

          await contentApi.updateContent({ contentId: event.id, scheduledAt: targetSlotUtcIso });
          upsertCalendarCache({
            ...(resource.item as any),
            id: event.id,
            brandId,
            scheduledAt: targetSlotUtcIso,
            status: 'scheduled',
            publishingQueueItemId: null,
          } as Content);

          // Best-effort: if it was in the queue, remove after scheduling succeeds.
          if (sourceQueueItemId) {
            try {
              await publishingQueuesApi.removeQueueItem(queueId, sourceQueueItemId);
              adjustQueueDepth(-1);
              removeQueueItemFromCalendarCache({
                queueId,
                viewKey,
                queueItemId: sourceQueueItemId,
                contentId: event.id,
              });
            } catch (queueRemoveError) {
              console.error(queueRemoveError);
              toast.error('Scheduled, but failed to remove from queue. Refresh to resolve.');
            }
          }
          toast.success('Post scheduled');
          return;
        }

        // Drops are only supported on explicit slot cards (placeholder events). Ignore any other
        // drop results to avoid leaving items half-scheduled/half-queued.
        const targetSlotUtcIso =
          targetEvent?.resource?.placeholder &&
          typeof targetEvent.resource.scheduledAt === 'string' &&
          targetEvent.resource.scheduledAt.trim().length > 0
            ? targetEvent.resource.scheduledAt.trim()
            : null;
        if (!targetSlotUtcIso) {
          return;
        }

        const record = resource.item as unknown as Record<string, unknown>;
        const sourceQueueItemId =
          typeof (record as any).publishingQueueItemId === 'string' &&
          (record as any).publishingQueueItemId.trim().length > 0
            ? String((record as any).publishingQueueItemId).trim()
            : null;

        const utcISO = targetSlotUtcIso;
        const groupId =
          typeof record.contentGroupId === 'string' && record.contentGroupId.trim().length > 0
            ? record.contentGroupId.trim()
            : null;
        const isMultiDestination = record.isMultiDestination === true && Boolean(groupId);

        // If the item is currently managed by the queue, scheduling it into an explicit time slot
        // must also remove it from the queue.
        if (sourceQueueItemId && queueId && effectiveSingleDestinationId) {
          if (scheduleAheadAtCapacity) {
            toast.error(
              `Scheduling limit reached (${scheduleAheadLimits?.currentCount}/${scheduleAheadLimits?.maxAllowed}). Upgrade to add more.`
            );
            return;
          }
        }

        if (isMultiDestination && groupId) {
          await contentApi.scheduleContentGroup(groupId, utcISO);
        } else {
          await contentApi.updateContent({ contentId: event.id, scheduledAt: utcISO });
        }

        if (sourceQueueItemId && queueId && effectiveSingleDestinationId) {
          try {
            await publishingQueuesApi.removeQueueItem(queueId, sourceQueueItemId);
            adjustQueueDepth(-1);
          } catch (queueRemoveError) {
            console.error(queueRemoveError);
            toast.error('Rescheduled, but failed to remove from queue. Refresh to resolve.');
          }
        }
        toast.success('Post rescheduled');
      } catch (error) {
        console.error(error);
        if (event?.id) {
          setOptimisticByContentId((prev) => {
            if (!(event.id in prev)) {
              return prev;
            }
            const next = { ...prev };
            delete next[event.id];
            return next;
          });
        }
        const message = error instanceof Error ? error.message : 'Failed to reschedule';
        toast.error(message || 'Failed to reschedule');
      } finally {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances-calendar'] });
        queryClient.invalidateQueries({ queryKey: ['publishing-queue-items-calendar'] });
        queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances'] });
        queryClient.invalidateQueries({ queryKey: ['publishing-queue-items'] });
        if (effectiveSingleDestinationId) {
          queryClient.invalidateQueries({
            queryKey: ['publishing-queues', effectiveSingleDestinationId],
          });
        }
      }
    },
    [
      brandId,
      brandTimezone,
      effectiveSingleDestinationId,
      optimisticClearTimersRef,
      queryClient,
      queueId,
      scheduleAheadAtCapacity,
      scheduleAheadLimits?.currentCount,
      scheduleAheadLimits?.maxAllowed,
      setOptimisticByContentId,
      viewKey,
    ]
  );
}
