import { memo, useEffect, useRef, useState, useMemo } from 'react';
import '@postolio/calendar/styles.css';
import { Calendar as PostolioCalendar, luxon } from '@postolio/calendar';
import { TouchBackend } from 'react-dnd-touch-backend';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { brand as brandApi, httpGet } from '@/lib/api';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { useCalendarItems } from '../hooks/useCalendarItems';
import { useFilteredEvents } from '../hooks/useFilteredEvents';
import { useTimezoneMeta } from '../hooks/useTimezoneMeta';
import { useCalendarFilters } from '../hooks/useCalendarFilters';
import { EventRenderer } from '../components/EventRenderer';
import { RescheduleManager } from '../components/RescheduleManager';
import { isTouchDevice } from '../utils/device';
import { CALENDAR_VIEW_MAP } from '../constants';
import type { CalendarEvent, RescheduleState } from '../types';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import type { Platform } from '@/lib/platform-config';
import type { SocialAccountsById } from '@/types/social-accounts';
import { formatSocialAccountLabel } from '@/lib/social-account-label';

import { useCalendarBackgroundClick } from './hooks/use-calendar-background-click';
import {
  useCalendarEventDrop,
  type OptimisticCalendarOp,
  type ScheduleAheadLimits,
} from './hooks/use-calendar-event-drop';
import { useCalendarQueueData } from './hooks/use-calendar-queue-data';
import { useOptimisticCalendarSync } from './hooks/use-optimistic-calendar-sync';
import { CalendarCreateCta } from './components/calendar-create-cta';
import type { FullCalendarProps } from './types';

function FullCalendarImpl({
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

  const [reschedule, setReschedule] = useState<RescheduleState>({ open: false, item: null });
  const [optimisticByContentId, setOptimisticByContentId] = useState<
    Record<string, OptimisticCalendarOp>
  >({});
  const optimisticClearTimersRef = useRef<Record<string, number>>({});

  const { tzRef, weekStartsOn } = useTimezoneMeta(brandTimezone);

  // Create localizer with brand timezone for correct time formatting
  const localizer = useMemo(() => {
    return luxon.create({ weekStartsOn, timezone: brandTimezone });
  }, [weekStartsOn, brandTimezone]);

  const effectiveSingleDestinationId = useMemo(() => {
    if (!Array.isArray(targetSocialAccountIds) || targetSocialAccountIds.length !== 1) return null;
    const id = targetSocialAccountIds[0];
    return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
  }, [targetSocialAccountIds]);

  const { queueId, queueItems, queueEstimatedContent, queueSlotPlaceholders } =
    useCalendarQueueData({
      brandId,
      brandTimezone,
      view,
      date,
      weekStartsOn: weekStartsOn as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      content,
      effectiveSingleDestinationId,
      optimisticByContentId,
    });

  useOptimisticCalendarSync({ content, queueItems, setOptimisticByContentId });

  useEffect(() => {
    return () => {
      const timers = optimisticClearTimersRef.current;
      for (const id of Object.keys(timers)) {
        window.clearTimeout(timers[id]);
      }
      optimisticClearTimersRef.current = {};
    };
  }, []);

  const mergedPlaceholders = useMemo(() => {
    if (!effectiveSingleDestinationId) return placeholders;
    return [...placeholders, ...queueSlotPlaceholders];
  }, [effectiveSingleDestinationId, placeholders, queueSlotPlaceholders]);

  const optimisticOverrides = useMemo(() => {
    return Object.values(optimisticByContentId).map((op) => ({
      ...op.override,
      optimisticAction: op.action,
    }));
  }, [optimisticByContentId]);

  const mergedContent = useMemo(() => {
    if (!effectiveSingleDestinationId) return [...optimisticOverrides, ...content];
    return [...optimisticOverrides, ...content, ...queueEstimatedContent];
  }, [content, effectiveSingleDestinationId, optimisticOverrides, queueEstimatedContent]);

  const items = useCalendarItems(mergedContent, mergedPlaceholders);
  const filters = useCalendarFilters();
  const events = useFilteredEvents(items, filters, tzRef.current);

  const primaryAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of mergedContent) {
      const primary = item?.primaryAssetId;
      const firstMedia = item?.mediaAssets?.[0]?.assetId;
      const candidate = (
        typeof primary === 'string' && primary.trim().length > 0
          ? primary
          : typeof firstMedia === 'string' && firstMedia.trim().length > 0
            ? firstMedia
            : null
      ) as string | null;
      if (candidate) ids.add(candidate);
    }
    return Array.from(ids);
  }, [mergedContent]);
  const { data: assetsById } = useAssetsByIds(primaryAssetIds);

  const socialAccountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandId],
    queryFn: () => brandApi.getConnectedAccounts(brandId),
    enabled: Boolean(brandId),
    staleTime: CACHE_TIMES.LONG,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });

  const socialAccountsById = useMemo(() => {
    const rawAccounts = (socialAccountsQuery.data as any)?.socialAccounts;
    const accounts = Array.isArray(rawAccounts) ? (rawAccounts as any[]) : [];
    const out: SocialAccountsById = {};

    for (const account of accounts) {
      const id = typeof account?.id === 'string' ? account.id : null;
      const platform =
        typeof account?.platform === 'string' ? (account.platform as Platform) : null;
      if (!id || !platform) continue;
      const username = typeof account?.username === 'string' ? account.username : null;
      const displayName = typeof account?.displayName === 'string' ? account.displayName : null;
      const label = formatSocialAccountLabel({ platform, username, displayName });
      const avatarName = username || displayName || platform;
      const avatarUrl =
        typeof account?.profilePictureUrl === 'string' ? account.profilePictureUrl : null;
      const disconnected = account?.disconnected === true;
      out[id] = { platform, label, avatarName, avatarUrl, disconnected };
    }

    return out;
  }, [socialAccountsQuery.data]);

  const scheduleAheadLimitQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead', brandId],
    queryFn: async () => httpGet('/api/account/limits/schedule-ahead'),
    enabled: Boolean(brandId),
    staleTime: 60 * 1000,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });
  const scheduleAheadLimits = (scheduleAheadLimitQuery.data as any)?.data as
    | ScheduleAheadLimits
    | undefined;
  const scheduleAheadAtCapacity =
    !!scheduleAheadLimits &&
    Number.isFinite(scheduleAheadLimits.maxAllowed) &&
    scheduleAheadLimits.currentCount >= scheduleAheadLimits.maxAllowed;

  const calendarView = (CALENDAR_VIEW_MAP[view] ?? 'month') as 'month' | 'week';
  const isTouch = isTouchDevice();
  const touchDndOptions = isTouch
    ? {
        enableTouchEvents: true,
        enableMouseEvents: true,
        delayTouchStart: 800,
      }
    : undefined;

  const handleEventDrop = useCalendarEventDrop({
    brandId,
    brandTimezone,
    viewKey: view,
    queryClient,
    queueId,
    effectiveSingleDestinationId,
    scheduleAheadAtCapacity,
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

  return (
    <>
      <PostolioCalendar
        localizer={localizer}
        view={calendarView as never}
        date={date}
        events={events as never}
        weekStartsOn={weekStartsOn}
        dragAndDrop
        dndBackend={isTouch ? TouchBackend : undefined}
        dndOptions={touchDndOptions}
        onEventDrop={handleEventDrop}
        components={{
          event: ({ event }: { event: CalendarEvent }) => (
            <EventRenderer
              event={event as CalendarEvent}
              timezone={tzRef.current}
              brandId={brandId}
              onReschedule={(item) => setReschedule({ open: true, item })}
              assetsById={assetsById}
              socialAccountsById={socialAccountsById}
              hideDestinations={Boolean(effectiveSingleDestinationId)}
            />
          ),
          createCta: CalendarCreateCta,
        }}
        onBackgroundClick={handleBackgroundClick}
      />
      <RescheduleManager
        brandId={brandId}
        timezone={tzRef.current}
        state={reschedule}
        onStateChange={setReschedule}
      />
    </>
  );
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
