import { memo, useState, useCallback, useMemo } from 'react';
import { addDays, isBefore, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import '@postolio/calendar/styles.css';
import { Calendar as PostolioCalendar, luxon } from '@postolio/calendar';
import { TouchBackend } from 'react-dnd-touch-backend';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  brand as brandApi,
  content as contentApi,
  publishingQueues as publishingQueuesApi,
  type Content,
} from '@/lib/api';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { convertLocalToUTC } from '@/lib/timezone';
import { useCalendarItems } from './hooks/useCalendarItems';
import { useFilteredEvents } from './hooks/useFilteredEvents';
import { useTimezoneMeta } from './hooks/useTimezoneMeta';
import { useCalendarFilters } from './hooks/useCalendarFilters';
import { EventRenderer } from './components/EventRenderer';
import { RescheduleManager } from './components/RescheduleManager';
import { isTouchDevice } from './utils/device';
import { CALENDAR_VIEW_MAP } from './constants';
import type { CalendarEvent, PlaceholderItem, RescheduleState } from './types';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import type { Platform } from '@/lib/platform-config';
import type { SocialAccountsById } from '@/types/social-accounts';
import { getDefaultQueueId } from '@/components/publishing-queues/queue-utils';
import type { PublishingQueueSlotInstance } from '@/lib/api/publishing-queues-client';

export interface FullCalendarProps {
  brandId: string;
  brandTimezone: string;
  view: 'month' | 'week' | 'three-day';
  date: Date;
  content?: Content[];
  placeholders?: PlaceholderItem[];
  targetSocialAccountIds?: string[] | null;
  theme?: 'default' | 'monarch';
}

function getQueueSlotRange(opts: {
  view: FullCalendarProps['view'];
  date: Date;
  timezone: string;
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}): { afterUtcIso: string; endUtcMs: number; limit: number } {
  const { view, date, timezone, weekStartsOn } = opts;
  const zoned = toZonedTime(date, timezone);

  if (view === 'month') {
    const monthStart = startOfMonth(zoned);
    const localStart = startOfWeek(monthStart, { weekStartsOn });
    const localEnd = addDays(localStart, 42);
    return {
      afterUtcIso: convertLocalToUTC(localStart, timezone).toISOString(),
      endUtcMs: convertLocalToUTC(localEnd, timezone).getTime(),
      limit: 600,
    };
  }

  if (view === 'week') {
    const localStart = startOfWeek(zoned, { weekStartsOn });
    const localEnd = addDays(localStart, 7);
    return {
      afterUtcIso: convertLocalToUTC(localStart, timezone).toISOString(),
      endUtcMs: convertLocalToUTC(localEnd, timezone).getTime(),
      limit: 250,
    };
  }

  const localStart = startOfDay(zoned);
  const localEnd = addDays(localStart, 3);
  return {
    afterUtcIso: convertLocalToUTC(localStart, timezone).toISOString(),
    endUtcMs: convertLocalToUTC(localEnd, timezone).getTime(),
    limit: 150,
  };
}

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

  const slotRange = useMemo(
    () =>
      effectiveSingleDestinationId
        ? getQueueSlotRange({ view, date, timezone: brandTimezone, weekStartsOn })
        : null,
    [brandTimezone, date, effectiveSingleDestinationId, view, weekStartsOn]
  );

  const queuesQuery = useQuery({
    queryKey: ['publishing-queues', effectiveSingleDestinationId],
    queryFn: () => publishingQueuesApi.listQueuesForSocialAccount(effectiveSingleDestinationId!),
    enabled: Boolean(effectiveSingleDestinationId),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const queueId = useMemo(() => getDefaultQueueId(queuesQuery.data as any), [queuesQuery.data]);

  const slotInstancesQuery = useQuery({
    queryKey: ['publishing-queue-slot-instances-calendar', queueId, slotRange?.afterUtcIso, view],
    queryFn: () =>
      publishingQueuesApi.listSlotInstances({
        queueId: queueId!,
        limit: slotRange?.limit ?? 200,
        after: slotRange?.afterUtcIso,
      }),
    enabled: Boolean(queueId && effectiveSingleDestinationId && slotRange?.afterUtcIso),
    staleTime: 0,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const queueSlotPlaceholders = useMemo(() => {
    if (!effectiveSingleDestinationId) return [] as PlaceholderItem[];
    if (!slotRange) return [] as PlaceholderItem[];
    const raw = slotInstancesQuery.data as any;
    const list = raw?.data?.instances;
    const instances = Array.isArray(list) ? (list as PublishingQueueSlotInstance[]) : [];
    const endUtcMs = slotRange.endUtcMs;
    const nowUtcMs = Date.now();

    return instances
      .filter((i) => !i.occupied)
      .filter((i) => {
        const ms = new Date(i.scheduledAt).getTime();
        return Number.isFinite(ms) && ms >= nowUtcMs && ms < endUtcMs;
      })
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
      .map((i) => {
        return {
          id: `queue-slot:${i.queueId}:${i.laneKey}:${i.scheduledAt}`,
          scheduledAt: i.scheduledAt,
          message: 'Queue slot',
          campaignId: null,
          campaignName: null,
          campaignColor: null,
          // Extra fields consumed by PostPreviewCard -> open create with prefill
          targetSocialAccountId: effectiveSingleDestinationId,
          laneKey: i.laneKey,
          caption: 'Queue slot',
        } as unknown as PlaceholderItem;
      });
  }, [effectiveSingleDestinationId, slotInstancesQuery.data, slotRange]);

  const mergedPlaceholders = useMemo(() => {
    if (!effectiveSingleDestinationId) return placeholders;
    return [...placeholders, ...queueSlotPlaceholders];
  }, [effectiveSingleDestinationId, placeholders, queueSlotPlaceholders]);

  const items = useCalendarItems(content, mergedPlaceholders);
  const filters = useCalendarFilters();
  const events = useFilteredEvents(items, filters, tzRef.current);

  const primaryAssetIds = useMemo(() => content.map((item) => item.primaryAssetId), [content]);
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
      const label = username ? `@${username}` : displayName || platform;
      const avatarName = username || displayName || platform;
      const avatarUrl =
        typeof account?.profilePictureUrl === 'string' ? account.profilePictureUrl : null;
      const disconnected = account?.disconnected === true;
      out[id] = { platform, label, avatarName, avatarUrl, disconnected };
    }

    return out;
  }, [socialAccountsQuery.data]);

  const calendarView = CALENDAR_VIEW_MAP[view] ?? 'month';
  const isTouch = isTouchDevice();
  const touchDndOptions = isTouch
    ? {
        enableTouchEvents: true,
        enableMouseEvents: true,
        delayTouchStart: 800,
      }
    : undefined;

  const handleEventDrop = useCallback(
    async ({ event, start }: { event: CalendarEvent; start: Date }) => {
      try {
        const resource = event.resource;
        if (resource.placeholder || resource.status === 'published') {
          return;
        }

        if (!start) {
          throw new Error('Missing start date');
        }

        const utcISO = convertLocalToUTC(new Date(start), tzRef.current).toISOString();
        const record = resource.item as unknown as Record<string, unknown>;
        const groupId =
          typeof record.contentGroupId === 'string' && record.contentGroupId.trim().length > 0
            ? record.contentGroupId.trim()
            : null;
        const isMultiDestination = record.isMultiDestination === true && Boolean(groupId);

        if (isMultiDestination && groupId) {
          await contentApi.scheduleContentGroup(groupId, utcISO);
        } else {
          await contentApi.updateContent({ contentId: event.id, scheduledAt: utcISO });
        }
        toast.success('Post rescheduled');
      } catch (error) {
        console.error(error);
        toast.error('Failed to reschedule');
      } finally {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
      }
    },
    [brandId, queryClient, tzRef]
  );

  const handleBackgroundClick = useCallback(
    (value: Date) => {
      if (typeof window === 'undefined') return;

      try {
        const brandTz = tzRef.current;
        const clickedLocal = toZonedTime(value, brandTz);
        const todayLocal = startOfDay(toZonedTime(new Date(), brandTz));
        if (isBefore(startOfDay(clickedLocal), todayLocal)) {
          return;
        }

        const local = new Date(clickedLocal);
        if (calendarView === 'month') {
          local.setHours(10, 0, 0, 0);
        }
        const utcISO = convertLocalToUTC(local, brandTz).toISOString();
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
    [calendarView, openSidebar, targetSocialAccountIds, tzRef]
  );

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
