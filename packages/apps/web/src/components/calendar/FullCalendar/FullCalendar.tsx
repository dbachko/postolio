import { memo, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { addDays, format, isBefore, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import '@postolio/calendar/styles.css';
import { Calendar as PostolioCalendar, luxon } from '@postolio/calendar';
import { TouchBackend } from 'react-dnd-touch-backend';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import {
  brand as brandApi,
  campaign as campaignApi,
  content as contentApi,
  publishingQueues as publishingQueuesApi,
  type Content,
} from '@/lib/api';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { convertLocalToUTC, toUTCFromInput } from '@/lib/timezone';
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
import type {
  PublishingQueueItem,
  PublishingQueueSlotInstance,
} from '@/lib/api/publishing-queues-client';
import { Button } from '@/components/ui/button';
import { formatSocialAccountLabel } from '@/lib/social-account-label';

export interface FullCalendarProps {
  brandId: string;
  brandTimezone: string;
  view: 'month' | 'week';
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

  const exhaustive: never = view;
  throw new Error(`Unhandled calendar view: ${exhaustive}`);
}

const SLOT_CONFLICT_WINDOW_MS = 60 * 1000; // 1 minute (match API)

function isTimeOccupied(params: {
  candidateUtcMs: number;
  occupiedUtcMsSorted: number[];
}): boolean {
  const { candidateUtcMs, occupiedUtcMsSorted } = params;
  if (occupiedUtcMsSorted.length === 0) return false;

  // Binary search for nearest occupied time.
  let lo = 0;
  let hi = occupiedUtcMsSorted.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = occupiedUtcMsSorted[mid]!;
    if (t === candidateUtcMs) return true;
    if (t < candidateUtcMs) lo = mid + 1;
    else hi = mid - 1;
  }

  const left = hi >= 0 ? occupiedUtcMsSorted[hi] : null;
  const right = lo < occupiedUtcMsSorted.length ? occupiedUtcMsSorted[lo] : null;

  if (left !== null && Math.abs(candidateUtcMs - left) < SLOT_CONFLICT_WINDOW_MS) return true;
  if (right !== null && Math.abs(candidateUtcMs - right) < SLOT_CONFLICT_WINDOW_MS) return true;
  return false;
}

type OptimisticCalendarAction = 'rescheduling' | 'queueing';

type OptimisticCalendarOp = {
  override: Content;
  action: OptimisticCalendarAction;
  startedAtMs: number;
};

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

  const queueCapacity = useMemo(() => {
    const raw = queuesQuery.data as any;
    const current = raw?.data?.queueDepthCurrent;
    const max = raw?.data?.queueDepthMax;
    const currentNum = typeof current === 'number' && Number.isFinite(current) ? current : null;
    const maxNum = typeof max === 'number' && Number.isFinite(max) ? max : null;
    return {
      current: currentNum,
      max: maxNum,
      atCapacity: currentNum !== null && maxNum !== null && currentNum >= maxNum,
    };
  }, [queuesQuery.data]);

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

  const queueItemsQuery = useQuery({
    queryKey: ['publishing-queue-items-calendar', queueId, view],
    queryFn: () =>
      publishingQueuesApi.listQueueItems({
        queueId: queueId!,
        limit: 200,
      }),
    enabled: Boolean(queueId && effectiveSingleDestinationId),
    staleTime: 0,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const queueItems = useMemo(() => {
    const raw = queueItemsQuery.data as any;
    const lanes = raw?.data?.lanes;
    if (!Array.isArray(lanes)) return [] as PublishingQueueItem[];
    const collected: PublishingQueueItem[] = [];
    for (const lane of lanes) {
      const items = lane?.items;
      if (Array.isArray(items)) collected.push(...(items as PublishingQueueItem[]));
    }
    return collected;
  }, [queueItemsQuery.data]);

  const queueItemsByEstimatedMs = useMemo(() => {
    const map = new Map<number, PublishingQueueItem>();
    for (const item of queueItems) {
      if (!item.estimatedScheduledAt) continue;
      const ms = new Date(item.estimatedScheduledAt).getTime();
      if (!Number.isFinite(ms)) continue;
      if (!map.has(ms)) map.set(ms, item);
    }
    return map;
  }, [queueItems]);

  const occupiedTimesUtcMsSorted = useMemo(() => {
    if (!effectiveSingleDestinationId) return [] as number[];

    const occupied: number[] = [];

    // Optimistic drops should immediately reserve the target slot.
    for (const op of Object.values(optimisticByContentId)) {
      const scheduledAt = op?.override?.scheduledAt;
      if (!scheduledAt) continue;
      const ms = new Date(scheduledAt).getTime();
      if (Number.isFinite(ms)) occupied.push(ms);
    }

    // Pinned / scheduled content within the month data.
    for (const item of content) {
      if (!item?.scheduledAt) continue;
      const ms = new Date(item.scheduledAt).getTime();
      if (Number.isFinite(ms)) occupied.push(ms);
    }

    // Queue-estimated schedule (computed server-side).
    for (const ms of queueItemsByEstimatedMs.keys()) {
      if (Number.isFinite(ms)) occupied.push(ms);
    }

    occupied.sort((a, b) => a - b);
    return occupied;
  }, [content, effectiveSingleDestinationId, optimisticByContentId, queueItemsByEstimatedMs]);

  const queueEstimatedContent = useMemo(() => {
    if (!effectiveSingleDestinationId) return [] as Content[];
    if (!slotRange) return [] as Content[];

    const endUtcMs = slotRange.endUtcMs;
    const nowUtcMs = Date.now();
    const out: Content[] = [];

    for (const [ms, item] of queueItemsByEstimatedMs.entries()) {
      if (ms < nowUtcMs || ms >= endUtcMs) continue;
      const base = item.content;
      const status = (() => {
        const raw = base?.status;
        return raw === 'draft' ||
          raw === 'scheduled' ||
          raw === 'published' ||
          raw === 'failed' ||
          raw === 'skipped'
          ? raw
          : 'draft';
      })();

      out.push({
        id: item.contentId,
        caption: base?.caption ?? '',
        status,
        scheduledAt: new Date(ms).toISOString(),
        postedAt: null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        brandId,
        targetSocialAccountId: effectiveSingleDestinationId,
        contentType: base?.contentType ?? null,
        primaryAssetId: base?.primaryAssetId ?? null,
        mediaAssets: (base as any)?.mediaAssets ?? null,
        mediaAssetCount: (base as any)?.mediaAssetCount ?? null,
        publishingQueueItemId: item.id,
      });
    }

    return out;
  }, [brandId, effectiveSingleDestinationId, queueItemsByEstimatedMs, slotRange]);

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
  }, [content, queueItems]);

  useEffect(() => {
    return () => {
      const timers = optimisticClearTimersRef.current;
      for (const id of Object.keys(timers)) {
        window.clearTimeout(timers[id]);
      }
      optimisticClearTimersRef.current = {};
    };
  }, []);

  const queueSlotPlaceholders = useMemo(() => {
    if (!effectiveSingleDestinationId) return [] as PlaceholderItem[];
    if (!slotRange) return [] as PlaceholderItem[];
    const raw = slotInstancesQuery.data as any;
    const list = raw?.data?.instances;
    const instances = Array.isArray(list) ? (list as PublishingQueueSlotInstance[]) : [];
    const endUtcMs = slotRange.endUtcMs;
    const nowUtcMs = Date.now();
    const occupiedUtcMsSorted = occupiedTimesUtcMsSorted;

    return instances
      .filter((i) => {
        const ms = new Date(i.scheduledAt).getTime();
        if (!Number.isFinite(ms)) return false;
        // Hide occupied slots (server-occupied OR occupied by queue estimation/content within 1 min).
        if (i.occupied) return false;
        if (isTimeOccupied({ candidateUtcMs: ms, occupiedUtcMsSorted })) return false;
        return true;
      })
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
          queueAtCapacity: queueCapacity.atCapacity,
          // Extra fields consumed by PostPreviewCard -> open create with prefill
          targetSocialAccountId: effectiveSingleDestinationId,
          laneKey: i.laneKey,
          caption: 'Queue slot',
        } as unknown as PlaceholderItem;
      });
  }, [
    effectiveSingleDestinationId,
    occupiedTimesUtcMsSorted,
    queueCapacity.atCapacity,
    slotInstancesQuery.data,
    slotRange,
  ]);

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
    queryFn: () => campaignApi.getScheduleAheadLimit(),
    enabled: Boolean(brandId),
    staleTime: 60 * 1000,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });
  const scheduleAheadLimits = (scheduleAheadLimitQuery.data as any)?.data as
    | { tier: string; maxAllowed: number; currentCount: number }
    | undefined;
  const scheduleAheadAtCapacity =
    !!scheduleAheadLimits &&
    Number.isFinite(scheduleAheadLimits.maxAllowed) &&
    scheduleAheadLimits.currentCount >= scheduleAheadLimits.maxAllowed;

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
        if (!nextItem?.scheduledAt) return;
        const monthKey = formatInTimeZone(new Date(nextItem.scheduledAt), brandTimezone, 'yyyy-MM');
        queryClient.setQueryData(['calendar', brandId, monthKey], (prev: any) => {
          const list = prev?.data?.content;
          if (!Array.isArray(list)) return prev;

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
            if (!Array.isArray(lanes)) return prev;
            const nextLanes = lanes.map((lane: any) => {
              const items = lane?.items;
              if (!Array.isArray(items)) return lane;
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
        if (!effectiveSingleDestinationId) return;
        queryClient.setQueryData(
          ['publishing-queues', effectiveSingleDestinationId],
          (prev: any) => {
            const current = prev?.data?.queueDepthCurrent;
            if (typeof current !== 'number' || !Number.isFinite(current)) return prev;
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
          if (!(contentId in prev)) return prev;
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
        if (timers[params.contentId]) window.clearTimeout(timers[params.contentId]);
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
          if (!targetEvent?.resource?.placeholder) return false;
          const record = targetEvent.resource.item as any;
          if (record?.message === 'Queue slot') return true;
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
            if (lk === 'post' || lk === 'reel' || lk === 'story' || lk === 'any') return lk;
            return 'post' as const;
          })();

          const sourceLaneKey = (() => {
            const rec = resource.item as any;
            const ct = typeof rec?.contentType === 'string' ? String(rec.contentType).trim() : '';
            if (ct === 'reel') return 'reel' as const;
            if (ct === 'story') return 'story' as const;
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
                viewKey: view,
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
        if (!targetSlotUtcIso) return;

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
            if (!(event.id in prev)) return prev;
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
      queryClient,
      queueId,
      scheduleAheadAtCapacity,
      scheduleAheadLimits?.currentCount,
      scheduleAheadLimits?.maxAllowed,
      tzRef,
      view,
    ]
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

  const CalendarCreateCta = useCallback(
    ({
      date,
      onClick,
      disabled,
    }: {
      date: Date;
      onClick?: (d: Date) => void;
      disabled?: boolean;
    }) => {
      return (
        <div className="pc-create-cta">
          <Button
            type="button"
            variant="outline"
            size="icon-xxs"
            aria-label="Create post"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              onClick?.(date);
            }}
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
          </Button>
        </div>
      );
    },
    []
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
