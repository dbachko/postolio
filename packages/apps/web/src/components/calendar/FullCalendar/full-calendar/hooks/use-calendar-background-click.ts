import { useCallback } from 'react';
import { format, isBefore, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

import { convertLocalToUTC, toUTCFromInput } from '@/lib/timezone';

type UseCalendarBackgroundClickParams = {
  calendarView: 'month' | 'week';
  tzRef: { current: string };
  openSidebar: (key: string, options?: { params?: Record<string, string> }) => void;
  effectiveSingleDestinationId: string | null;
  targetSocialAccountIds: string[] | null;
};

export function useCalendarBackgroundClick({
  calendarView,
  tzRef,
  openSidebar,
  effectiveSingleDestinationId,
  targetSocialAccountIds,
}: UseCalendarBackgroundClickParams) {
  return useCallback(
    (value: Date) => {
      if (typeof window === 'undefined') return;

      try {
        const brandTz = tzRef.current;
        const clickedLocal = toZonedTime(value, brandTz);
        const todayLocal = startOfDay(toZonedTime(new Date(), brandTz));
        if (isBefore(startOfDay(clickedLocal), todayLocal)) {
          return;
        }

        const utcISO = (() => {
          // When a single destination is selected (queue slots visible), clicking a day/+ should
          // pin the schedule to that day using the current time-of-day (in the brand timezone),
          // not "next available".
          if (effectiveSingleDestinationId) {
            const datePart = format(clickedLocal, 'yyyy-MM-dd');
            const nowLocal = toZonedTime(new Date(), brandTz);
            const timePart = format(nowLocal, 'HH:mm');
            return toUTCFromInput(`${datePart}T${timePart}`, brandTz).toISOString();
          }

          const local = new Date(clickedLocal);
          if (calendarView === 'month') {
            local.setHours(10, 0, 0, 0);
          }
          return convertLocalToUTC(local, brandTz).toISOString();
        })();

        openSidebar('post-create', {
          params: {
            scheduledAt: utcISO,
            ...(Array.isArray(targetSocialAccountIds) && targetSocialAccountIds.length > 0
              ? targetSocialAccountIds.length === 1
                ? { targetSocialAccountId: targetSocialAccountIds[0] }
                : { targetSocialAccountIds: targetSocialAccountIds.join(',') }
              : {}),
          },
        });
      } catch (error) {
        console.error(error);
      }
    },
    [calendarView, effectiveSingleDestinationId, openSidebar, targetSocialAccountIds, tzRef]
  );
}
