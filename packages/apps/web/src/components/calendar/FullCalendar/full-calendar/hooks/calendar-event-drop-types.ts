import type { Dispatch, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { Content } from '@/lib/api';
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

export type UseCalendarEventDropParams = {
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

export type EventDropArgs = {
  event: CalendarEvent;
  start: Date;
  targetEvent?: CalendarEvent | null;
};

export type CalendarDropContext = UseCalendarEventDropParams;

export type LaneKey = 'post' | 'reel' | 'story' | 'any';
