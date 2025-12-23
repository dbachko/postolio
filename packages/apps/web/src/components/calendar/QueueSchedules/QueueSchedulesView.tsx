import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { Link } from 'react-router-dom';

import {
  brand as brandApi,
  publishingQueues as publishingQueuesApi,
  type Content,
} from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';
import { cn } from '@/lib/utils';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SocialAccountAvatar } from '@/components/social/SocialAccountAvatar';

import { Film, Image as ImageIcon, Layers, LayoutGrid } from 'lucide-react';

import type {
  PublishingQueueItem,
  PublishingQueueLaneKey,
  PublishingQueueSlotInstance,
  PublishingQueueSummary,
} from '@/lib/api/publishing-queues-client';
import { getDefaultQueueId } from '@/components/publishing-queues/queue-utils';
import {
  getBrandRangeEndUtcMs,
  getBrandRangeStartUtcIso,
  normalizeLaneKey,
} from '@/components/calendar/QueueSchedules/queue-schedules-utils';
import { QueueScheduleLane } from '@/components/calendar/QueueSchedules/QueueScheduleLane';

export function QueueSchedulesView({
  brandId,
  brandTimezone,
  date,
  calendarContent,
}: {
  brandId: string;
  brandTimezone: string;
  date: Date;
  calendarContent: Content[];
}) {
  const { openSidebar } = useRightSidebarRouter();

  const accountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandId],
    queryFn: () => brandApi.getConnectedAccounts(brandId),
    enabled: Boolean(brandId),
    staleTime: CACHE_TIMES.LONG,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });

  const socialAccounts = useMemo(() => {
    const list = (accountsQuery.data as any)?.socialAccounts;
    const accounts = Array.isArray(list) ? (list as any[]) : [];
    return accounts
      .slice()
      .sort((a, b) => {
        const aOrder = typeof a?.sortOrder === 'number' ? a.sortOrder : 0;
        const bOrder = typeof b?.sortOrder === 'number' ? b.sortOrder : 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      })
      .map((account) => {
        const id = typeof account?.id === 'string' ? account.id : '';
        const platform =
          typeof account?.platform === 'string' ? (account.platform as Platform) : null;
        const username = typeof account?.username === 'string' ? account.username : null;
        const displayName = typeof account?.displayName === 'string' ? account.displayName : null;
        const label = username ? `@${username}` : displayName || platform || 'Social account';
        const avatarName = username || displayName || platform || 'Account';
        const avatarUrl =
          typeof account?.profilePictureUrl === 'string' ? account.profilePictureUrl : null;
        const disconnected = account?.disconnected === true;
        const schedulingSupported = platform
          ? (() => {
              try {
                return getPlatformConfig(platform).features.scheduling;
              } catch {
                return false;
              }
            })()
          : false;

        return {
          id,
          platform,
          label,
          avatarName,
          avatarUrl,
          disconnected,
          schedulingSupported,
        };
      })
      .filter((a) => Boolean(a.id && a.platform));
  }, [accountsQuery.data]);

  const [selectedSocialAccountId, setSelectedSocialAccountId] = useState<string | null>(null);
  const [selectedLane, setSelectedLane] = useState<'all' | Exclude<PublishingQueueLaneKey, 'any'>>(
    'all'
  );
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedSocialAccountId) return;
    const first =
      socialAccounts.find((a) => a.schedulingSupported && !a.disconnected) ||
      socialAccounts[0] ||
      null;
    if (first?.id) setSelectedSocialAccountId(first.id);
  }, [selectedSocialAccountId, socialAccounts]);

  const queuesQuery = useQuery({
    queryKey: ['publishing-queues', selectedSocialAccountId],
    queryFn: () => publishingQueuesApi.listQueuesForSocialAccount(selectedSocialAccountId!),
    enabled: Boolean(selectedSocialAccountId),
    staleTime: CACHE_TIMES.STANDARD,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const queueId = useMemo(() => {
    if (selectedQueueId) return selectedQueueId;
    const fallback = getDefaultQueueId(queuesQuery.data as any);
    return fallback;
  }, [queuesQuery.data, selectedQueueId]);

  useEffect(() => {
    if (!queueId) return;
    setSelectedQueueId(queueId);
  }, [queueId]);

  const rangeStartUtcIso = useMemo(
    () => getBrandRangeStartUtcIso(date, brandTimezone),
    [brandTimezone, date]
  );
  const rangeEndUtcMs = useMemo(
    () => getBrandRangeEndUtcMs(date, brandTimezone, 7),
    [brandTimezone, date]
  );

  const instancesQuery = useQuery({
    queryKey: ['publishing-queue-slot-instances', queueId, selectedLane, rangeStartUtcIso],
    queryFn: () =>
      publishingQueuesApi.listSlotInstances({
        queueId: queueId!,
        laneKey: selectedLane === 'all' ? undefined : selectedLane,
        limit: 100,
        after: rangeStartUtcIso,
      }),
    enabled: Boolean(queueId),
    staleTime: 0,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const itemsQuery = useQuery({
    queryKey: ['publishing-queue-items', queueId, selectedLane, rangeStartUtcIso],
    queryFn: () =>
      publishingQueuesApi.listQueueItems({
        queueId: queueId!,
        laneKey: selectedLane === 'all' ? undefined : selectedLane,
        limit: 200,
        after: rangeStartUtcIso,
      }),
    enabled: Boolean(queueId),
    staleTime: 0,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const instances = useMemo(() => {
    const raw = instancesQuery.data as any;
    const list = raw?.data?.instances;
    const parsed = Array.isArray(list) ? (list as PublishingQueueSlotInstance[]) : [];
    return parsed
      .slice()
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
      .filter((i) => new Date(i.scheduledAt).getTime() < rangeEndUtcMs);
  }, [instancesQuery.data, rangeEndUtcMs]);

  const queueItems = useMemo(() => {
    const raw = itemsQuery.data as any;
    const lanes = raw?.data?.lanes;
    if (!Array.isArray(lanes)) return [] as PublishingQueueItem[];
    if (selectedLane === 'all') {
      const collected: PublishingQueueItem[] = [];
      for (const lane of lanes) {
        const items = lane?.items;
        if (Array.isArray(items)) collected.push(...(items as PublishingQueueItem[]));
      }
      return collected;
    }
    const lane = lanes.find((l: any) => l?.laneKey === selectedLane) || lanes[0] || null;
    const items = lane?.items;
    return Array.isArray(items) ? (items as PublishingQueueItem[]) : [];
  }, [itemsQuery.data, selectedLane]);

  const itemsByEstimatedMs = useMemo(() => {
    const map = new Map<number, PublishingQueueItem>();
    for (const item of queueItems) {
      if (!item.estimatedScheduledAt) continue;
      const ms = new Date(item.estimatedScheduledAt).getTime();
      if (!Number.isFinite(ms)) continue;
      if (!map.has(ms)) map.set(ms, item);
    }
    return map;
  }, [queueItems]);

  const calendarContentById = useMemo(() => {
    const map = new Map<string, Content>();
    for (const item of calendarContent) {
      if (item && typeof item.id === 'string') map.set(item.id, item);
    }
    return map;
  }, [calendarContent]);

  const primaryAssetIds = useMemo(() => {
    return calendarContent.map(
      (item) => item.primaryAssetId || item.mediaAssets?.[0]?.assetId || null
    );
  }, [calendarContent]);
  const { data: assetsById } = useAssetsByIds(primaryAssetIds);

  const nowLocal = useMemo(() => toZonedTime(new Date(), brandTimezone), [brandTimezone]);

  const unassignedQueueItems = useMemo(
    () => queueItems.filter((i) => !i.estimatedScheduledAt),
    [queueItems]
  );

  const selectedAccountMeta = useMemo(() => {
    if (!selectedSocialAccountId) return null;
    return socialAccounts.find((a) => a.id === selectedSocialAccountId) || null;
  }, [selectedSocialAccountId, socialAccounts]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <div className="text-sm font-semibold">Queues</div>
          <span className="text-muted-foreground text-xs">
            {formatInTimeZone(date, brandTimezone, 'MMM d, yyyy')} · {brandTimezone}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedQueueId ?? ''}
            onValueChange={(v) => setSelectedQueueId(v)}
            disabled={queuesQuery.isLoading || !queueId}
          >
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="Select a queue" />
            </SelectTrigger>
            <SelectContent>
              {(() => {
                const raw = queuesQuery.data as any;
                const list = raw?.data?.queues;
                const queues = Array.isArray(list) ? (list as PublishingQueueSummary[]) : [];
                if (queues.length === 0) {
                  return (
                    <SelectItem value="__none" disabled>
                      No queues
                    </SelectItem>
                  );
                }
                return queues.map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {q.name}
                    {q.isDefault ? ' (Default)' : ''}
                  </SelectItem>
                ));
              })()}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              openSidebar('post-create', {
                params: {
                  targetSocialAccountId: selectedSocialAccountId,
                  contentType: selectedLane === 'all' ? undefined : selectedLane,
                },
              });
            }}
            disabled={!selectedSocialAccountId || !selectedAccountMeta?.schedulingSupported}
          >
            Create
          </Button>
        </div>
      </div>

      <Card className="bg-card">
        <div className="border-border flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Social account
            </div>
            <div className="flex items-center gap-1.5">
              {socialAccounts.length === 0 ? (
                <div className="text-muted-foreground text-sm">
                  No connected accounts. Go to{' '}
                  <Button
                    variant="link"
                    asChild
                    className="h-auto p-0 text-sm font-medium underline underline-offset-4"
                  >
                    <Link to="/social-accounts/connections">Social Accounts</Link>
                  </Button>
                  .
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {socialAccounts.map((account) => {
                    const active = account.id === selectedSocialAccountId;
                    const disabled = account.disconnected || !account.schedulingSupported;
                    return (
                      <Button
                        key={account.id}
                        type="button"
                        aria-label={account.label}
                        onClick={() => {
                          if (disabled) return;
                          setSelectedSocialAccountId(account.id);
                          setSelectedQueueId(null);
                        }}
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        className={cn('rounded-full', disabled && 'opacity-50')}
                        title={
                          disabled
                            ? account.disconnected
                              ? 'Account disconnected'
                              : 'Queue scheduling not available for this platform'
                            : account.label
                        }
                      >
                        <SocialAccountAvatar
                          platform={account.platform!}
                          name={account.avatarName}
                          src={account.avatarUrl}
                          size="sm"
                          selected={active}
                          disabled={account.disconnected}
                          muted={!account.schedulingSupported}
                        />
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <Tabs
            value={selectedLane}
            onValueChange={(v) => {
              const next = v === 'all' ? 'all' : normalizeLaneKey(v);
              if (next === 'any') {
                setSelectedLane('post');
                return;
              }
              setSelectedLane(next);
            }}
          >
            <TabsList>
              <TabsTrigger value="all" className="gap-1">
                <LayoutGrid className="h-4 w-4" />
                <span className="hidden sm:inline">All</span>
              </TabsTrigger>
              <TabsTrigger value="post" className="gap-1">
                <ImageIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Posts</span>
              </TabsTrigger>
              <TabsTrigger value="reel" className="gap-1">
                <Film className="h-4 w-4" />
                <span className="hidden sm:inline">Reels</span>
              </TabsTrigger>
              <TabsTrigger value="story" className="gap-1">
                <Layers className="h-4 w-4" />
                <span className="hidden sm:inline">Stories</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <QueueScheduleLane
          laneView={selectedLane}
          instances={instances}
          itemsByEstimatedMs={itemsByEstimatedMs}
          calendarContentById={calendarContentById}
          assetsById={assetsById}
          brandTimezone={brandTimezone}
          nowLocal={nowLocal}
          onCreate={(slotIso, slotLaneKey) => {
            const contentType =
              selectedLane === 'all'
                ? slotLaneKey === 'post' || slotLaneKey === 'reel' || slotLaneKey === 'story'
                  ? slotLaneKey
                  : null
                : selectedLane;
            openSidebar('post-create', {
              params: {
                scheduledAt: slotIso,
                targetSocialAccountId: selectedSocialAccountId,
                contentType,
              },
            });
          }}
          onOpen={(contentId) => openSidebar('post', { id: contentId })}
          unassigned={unassignedQueueItems}
          isLoading={instancesQuery.isLoading || itemsQuery.isLoading}
        />
      </Card>
    </div>
  );
}
