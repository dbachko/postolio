import { memo, useMemo, useState } from 'react';
import '@postolio/calendar/styles.css';
import { luxon } from '@postolio/calendar';
import { useQueryClient } from '@tanstack/react-query';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { useTimezoneMeta } from '../hooks/useTimezoneMeta';
import { CALENDAR_VIEW_MAP } from '../constants';
import type { RescheduleState } from '../types';
import { useAuthStore } from '@/stores/authStore';
import { isMultiDestinationEnabled } from '@/lib/feature-flags';
import { isTouchDevice } from '../utils/device';
import { useCalendarBackgroundClick } from './hooks/use-calendar-background-click';
import { useCalendarEventDrop } from './hooks/use-calendar-event-drop';
import { useFullCalendarSocialAccountsData } from './hooks/use-full-calendar-social-accounts';
import { useFullCalendarContentData } from './hooks/use-full-calendar-content-data';
import {
  isScheduleAheadAtCapacity,
  useScheduleAheadLimits,
} from './hooks/use-schedule-ahead-limits';
import { FullCalendarView } from './components/full-calendar-view';
import type { FullCalendarProps } from './types';

function useFullCalendarController({
  brandId,
  brandTimezone,
  view,
  date,
  content = [],
  placeholders = [],
  targetSocialAccountIds = null,
}: FullCalendarProps) {
  const queryClient = useQueryClient();
  const { openSidebar } = useRightSidebarRouter();
  const user = useAuthStore((state) => state.user);
  const [reschedule, setReschedule] = useState<RescheduleState>({ open: false, item: null });
  const multiDestinationEnabled = isMultiDestinationEnabled(user);
  const { tzRef, weekStartsOn } = useTimezoneMeta(brandTimezone);
  const localizer = useMemo(
    () => luxon.create({ weekStartsOn, timezone: brandTimezone }),
    [weekStartsOn, brandTimezone]
  );
  const { effectiveSingleDestinationId, socialAccountsById } = useFullCalendarSocialAccountsData({
    brandId,
    multiDestinationEnabled,
    targetSocialAccountIds,
  });
  const { assetsById, events, queueId, optimisticClearTimersRef, setOptimisticByContentId } =
    useFullCalendarContentData({
      brandId,
      brandTimezone,
      view,
      date,
      weekStartsOn: weekStartsOn as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      content,
      placeholders,
      multiDestinationEnabled,
      effectiveSingleDestinationId,
      timezone: tzRef.current,
    });
  const scheduleAheadLimits = useScheduleAheadLimits(brandId);
  const calendarView = (CALENDAR_VIEW_MAP[view] ?? 'month') as 'month' | 'week';
  const handleEventDrop = useCalendarEventDrop({
    brandId,
    brandTimezone,
    viewKey: view,
    queryClient,
    queueId,
    effectiveSingleDestinationId,
    scheduleAheadAtCapacity: isScheduleAheadAtCapacity(scheduleAheadLimits),
    scheduleAheadLimits,
    optimisticClearTimersRef,
    setOptimisticByContentId,
  });
  const handleBackgroundClick = useCalendarBackgroundClick({
    calendarView,
    tzRef,
    openSidebar,
    effectiveSingleDestinationId,
    targetSocialAccountIds,
  });

  return {
    assetsById,
    brandId,
    calendarView,
    date,
    effectiveSingleDestinationId,
    events,
    handleBackgroundClick,
    handleEventDrop,
    isTouch: isTouchDevice(),
    localizer,
    reschedule,
    setReschedule,
    socialAccountsById,
    timezone: tzRef.current,
    touchDndOptions: isTouchDevice()
      ? { enableTouchEvents: true, enableMouseEvents: true, delayTouchStart: 800 }
      : undefined,
    weekStartsOn,
  };
}

function FullCalendarImpl(props: FullCalendarProps) {
  const controller = useFullCalendarController(props);
  return <FullCalendarView {...controller} />;
}

export const FullCalendar = memo(FullCalendarImpl, (prev, next) => {
  return (
    prev.brandId === next.brandId &&
    prev.brandTimezone === next.brandTimezone &&
    prev.view === next.view &&
    prev.date.getTime() === next.date.getTime() &&
    prev.content === next.content &&
    prev.placeholders === next.placeholders &&
    prev.targetSocialAccountIds === next.targetSocialAccountIds &&
    prev.theme === next.theme
  );
});

export default FullCalendar;
