import { useCallback } from 'react';
import { toast } from 'sonner';
import {
  clearOptimisticOnError,
  getTargetSlotUtcIso,
  handleExplicitSlotDrop,
  handleQueueSlotDrop,
  invalidateDropQueries,
  isQueueSlotTarget,
} from './calendar-event-drop-helpers';
import type {
  EventDropArgs,
  OptimisticCalendarAction as OptimisticCalendarActionType,
  OptimisticCalendarOp as OptimisticCalendarOpType,
  ScheduleAheadLimits as ScheduleAheadLimitsType,
  UseCalendarEventDropParams,
} from './calendar-event-drop-types';

export type OptimisticCalendarAction = OptimisticCalendarActionType;
export type OptimisticCalendarOp = OptimisticCalendarOpType;
export type ScheduleAheadLimits = ScheduleAheadLimitsType;

export function useCalendarEventDrop(context: UseCalendarEventDropParams) {
  return useCallback(
    async ({ event, start, targetEvent }: EventDropArgs) => {
      try {
        const resource = event.resource;
        if (resource.placeholder || resource.status === 'published') {
          return;
        }
        if (!start) {
          throw new Error('Missing start date');
        }

        if (targetEvent && isQueueSlotTarget(targetEvent)) {
          await handleQueueSlotDrop({ context, event, resource, targetEvent });
          return;
        }

        const targetSlotUtcIso = getTargetSlotUtcIso(targetEvent);
        if (!targetSlotUtcIso) {
          return;
        }
        await handleExplicitSlotDrop({ context, event, resource, targetSlotUtcIso });
      } catch (error) {
        console.error(error);
        clearOptimisticOnError({
          event,
          setOptimisticByContentId: context.setOptimisticByContentId,
        });
        const message = error instanceof Error ? error.message : 'Failed to reschedule';
        toast.error(message || 'Failed to reschedule');
      } finally {
        invalidateDropQueries(context);
      }
    },
    [context]
  );
}
