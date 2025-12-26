import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import type { CalendarItem } from '../types/calendar';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { CalendarClock, Clock, Copy, ExternalLink, Loader2, Trash2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { content as contentApi } from '@/lib/api';
// import { convertLocalToUTC } from '@/lib/timezone';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getPostImageOrPlaceholder } from '@/lib/placeholders';
import { PostStatusTimeBadge } from '@/components/PostStatusTimeBadge';
import { getPostStatusBorderColor } from '@/utils/post-status-colors';
import { getMediaBadgeType } from '@/utils/media-type';
import { MediaTypeBadge } from '@/components/MediaTypeBadge';
import type { AssetType } from '@/features/assets/api/client';
import { SocialAccountAvatar } from '@/components/social/SocialAccountAvatar';
import type { SocialAccountsById } from '@/types/social-accounts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTrigger,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { laneIcon } from '@/components/calendar/QueueSchedules/queue-schedules-utils';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { MouseEvent } from 'react';
import type { PublishingQueueLaneKey } from '@/lib/api/publishing-queues-client';

type DeleteTarget =
  | { kind: 'content'; contentId: string }
  | { kind: 'group'; contentGroupId: string; destinationCount: number };

type ScheduleTarget =
  | { kind: 'content'; contentId: string }
  | { kind: 'group'; contentGroupId: string; destinationCount: number };

interface PostPreviewCardProps {
  item: CalendarItem;
  timezone: string;
  onReschedule?: (item: CalendarItem) => void;
  primaryAsset?: AssetType | null;
  socialAccountsById?: SocialAccountsById;
  hideDestinations?: boolean;
}

// Lightweight preview card shown inside the Month grid
export function PostPreviewCard({
  item,
  timezone,
  onReschedule,
  primaryAsset,
  socialAccountsById,
  hideDestinations = false,
}: PostPreviewCardProps) {
  const navigate = useNavigate();
  const { openSidebar } = useRightSidebarRouter();

  const optimisticLabel = useMemo(() => {
    const v = (item as any)?.optimisticAction;
    if (v === 'queueing') return 'Queueing…';
    if (v === 'rescheduling') return 'Rescheduling…';
    return null;
  }, [item]);

  const groupMeta = useMemo(() => {
    if (item.type === 'placeholder') return null;
    const record = item as unknown as Record<string, unknown>;
    const contentGroupId =
      typeof record.contentGroupId === 'string' && record.contentGroupId.trim().length > 0
        ? record.contentGroupId.trim()
        : null;
    const isMultiDestination = record.isMultiDestination === true && Boolean(contentGroupId);
    const destinationContentIds = Array.isArray(record.destinationContentIds)
      ? (record.destinationContentIds as unknown[])
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : [];
    const destinationCount = destinationContentIds.length > 0 ? destinationContentIds.length : 0;

    if (!isMultiDestination || !contentGroupId) return null;

    return {
      contentGroupId,
      destinationCount: destinationCount > 0 ? destinationCount : 2,
    };
  }, [item]);

  const { status, displayTime } = useMemo(() => {
    const isPlaceholder = item.type === 'placeholder' || (item as any)?.isPlaceholder;
    const status = (item as any)?.status || (isPlaceholder ? 'placeholder' : 'draft');

    // Determine the relevant date/time: prefer postedAt for published, otherwise scheduledAt
    const ts =
      (status === 'published' && (item as any)?.postedAt) ||
      (item as any)?.scheduledAt ||
      (item as any)?.postedAt ||
      null;
    let displayTime = '';
    if (ts) {
      // Use date-fns-tz to correctly convert UTC to brand timezone
      // formatInTimeZone handles the conversion from UTC ISO string to brand timezone
      displayTime = formatInTimeZone(new Date(ts), timezone, 'h:mm a');
    }

    return { status, displayTime };
  }, [item, timezone]);

  const [imageReady, setImageReady] = useState(false);
  const previewUrl = useMemo(() => {
    if (!primaryAsset) return null;
    if (primaryAsset.fileType === 'video') {
      return primaryAsset.thumbnailUrl || null;
    }
    return primaryAsset.thumbnailUrl || primaryAsset.url || null;
  }, [primaryAsset]);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isWide, setIsWide] = useState(false);

  const mediaBadgeType = getMediaBadgeType({
    contentType: (item as any)?.contentType,
    mediaAssets: (item as any)?.mediaAssets,
    mediaAssetCount: (item as any)?.mediaAssetCount,
    primaryAssetFileType: primaryAsset?.fileType ?? null,
  });
  const showMediaBadge = item.type !== 'placeholder';

  const destinationAvatars = useMemo(() => {
    if (hideDestinations) return null;
    if (item.type === 'placeholder') return null;
    if (!socialAccountsById) return null;

    const record = item as unknown as Record<string, unknown>;
    const rawIds = Array.isArray(record.destinationSocialAccountIds)
      ? (record.destinationSocialAccountIds as unknown[])
      : null;
    const singleId =
      typeof record.targetSocialAccountId === 'string' ? record.targetSocialAccountId : null;

    const ids = (rawIds && rawIds.length > 0 ? rawIds : singleId ? [singleId] : [])
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return null;

    const maxVisible = 3;
    const visible = unique.slice(0, maxVisible);
    const extraCount = unique.length - visible.length;

    return (
      <div className="flex items-center -space-x-1.5">
        {visible.map((id) => {
          const meta = socialAccountsById[id];
          if (!meta) return null;
          return (
            <div key={id} className="shrink-0" title={meta.label}>
              <SocialAccountAvatar
                platform={meta.platform}
                name={meta.avatarName}
                src={meta.avatarUrl}
                size="xs"
                disabled={meta.disconnected}
                muted={false}
              />
            </div>
          );
        })}
        {extraCount > 0 ? (
          <div className="bg-muted text-muted-foreground border-border flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-medium">
            +{extraCount}
          </div>
        ) : null}
      </div>
    );
  }, [hideDestinations, item, socialAccountsById]);

  useEffect(() => {
    setImageReady(false);
  }, [previewUrl]);

  useEffect(() => {
    if (!cardRef.current) return;
    const el = cardRef.current;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? 0;
      setIsWide(width >= 200);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleOpen = () => {
    // Navigate to post details or create from placeholder
    if (item.type === 'placeholder') {
      const record = item as unknown as Record<string, unknown>;
      const params: Record<string, string | null | undefined> = {};

      const scheduledAt =
        typeof record.scheduledAt === 'string' && record.scheduledAt.trim().length > 0
          ? record.scheduledAt.trim()
          : null;
      if (scheduledAt) params.scheduledAt = scheduledAt;

      const campaignId =
        typeof record.campaignId === 'string' && record.campaignId.trim().length > 0
          ? record.campaignId.trim()
          : null;
      if (campaignId && campaignId !== 'none') params.campaignId = campaignId;

      const targetSocialAccountId =
        typeof record.targetSocialAccountId === 'string' && record.targetSocialAccountId.trim()
          ? record.targetSocialAccountId.trim()
          : null;
      if (targetSocialAccountId) {
        params.targetSocialAccountId = targetSocialAccountId;
      }

      const targetSocialAccountIdsRaw =
        typeof record.targetSocialAccountIds === 'string' ? record.targetSocialAccountIds : null;
      const targetSocialAccountIds = Array.isArray(record.targetSocialAccountIds)
        ? (record.targetSocialAccountIds as unknown[])
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter(Boolean)
        : targetSocialAccountIdsRaw
          ? targetSocialAccountIdsRaw
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean)
          : [];
      if (!targetSocialAccountId && targetSocialAccountIds.length > 0) {
        const unique = Array.from(new Set(targetSocialAccountIds));
        if (unique.length === 1) params.targetSocialAccountId = unique[0];
        else params.targetSocialAccountIds = unique.join(',');
      }

      const laneKey = typeof record.laneKey === 'string' ? record.laneKey : null;
      if (laneKey === 'post' || laneKey === 'reel' || laneKey === 'story') {
        params.contentType = laneKey;
      }

      openSidebar('post-create', { params });
      return;
    }
    openSidebar('post', { id: (item as any).id });
  };

  const isQueueSlotPlaceholder = useMemo(() => {
    if (item.type !== 'placeholder') return false;
    const record = item as unknown as Record<string, unknown>;
    return record.message === 'Queue slot';
  }, [item]);

  const queueSlotMeta = useMemo(() => {
    if (!isQueueSlotPlaceholder) return null;
    const record = item as unknown as Record<string, unknown>;
    const scheduledAt =
      typeof record.scheduledAt === 'string' && record.scheduledAt.trim().length > 0
        ? record.scheduledAt.trim()
        : null;
    const laneKey = typeof record.laneKey === 'string' ? record.laneKey : null;
    const normalizedLaneKey: PublishingQueueLaneKey =
      laneKey === 'post' || laneKey === 'reel' || laneKey === 'story' || laneKey === 'any'
        ? (laneKey as PublishingQueueLaneKey)
        : 'post';
    const timeLabel = scheduledAt
      ? formatInTimeZone(new Date(scheduledAt), timezone, 'h:mm a')
      : '';
    const isPast = scheduledAt
      ? toZonedTime(new Date(scheduledAt), timezone).getTime() <
        toZonedTime(new Date(), timezone).getTime()
      : false;
    return {
      scheduledAt,
      laneKey: normalizedLaneKey,
      timeLabel,
      isPast,
    };
  }, [isQueueSlotPlaceholder, item, timezone]);

  // Status-tinted border to match calendar cards
  const borderColor = getPostStatusBorderColor(status);

  // Mutations
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: (target: DeleteTarget) => {
      if (target.kind === 'group') {
        return contentApi.deleteContentGroup(target.contentGroupId);
      }
      return contentApi.deletePost(target.contentId);
    },
    onSuccess: () => {
      toast.success(groupMeta ? 'Posts deleted' : 'Post deleted');
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['content'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-items-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-items'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to delete post'),
  });

  const unscheduleMutation = useMutation({
    mutationFn: (target: ScheduleTarget) => {
      if (target.kind === 'group') {
        return contentApi.scheduleContentGroup(target.contentGroupId, null);
      }
      return contentApi.updateContent({
        contentId: target.contentId,
        scheduledAt: null,
      });
    },
    onSuccess: () => {
      toast.success(
        groupMeta ? 'Posts unscheduled and moved to Drafts' : 'Post unscheduled and moved to Drafts'
      );
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['content'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-items-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances'] });
      queryClient.invalidateQueries({ queryKey: ['publishing-queue-items'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to unschedule post'),
  });

  // Reschedule dialog moved up to parent to avoid React portal bubbling to card

  const handleDuplicate = () => {
    if (item.type === 'placeholder') {
      // placeholders already route to create with prefill
      handleOpen();
      return;
    }
    const params = new URLSearchParams();
    if ((item as any).campaignId) params.set('campaignId', (item as any).campaignId);
    if ((item as any).caption) params.set('caption', (item as any).caption);
    if ((item as any).hashtags?.length)
      params.set('hashtags', ((item as any).hashtags as string[]).join(' '));
    navigate(`/posts/create?${params.toString()}`);
  };

  if (queueSlotMeta) {
    const handleCreate = () => {
      if (queueSlotMeta.isPast) return;
      handleOpen();
    };

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleCreate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleCreate();
          }
        }}
        className={cn(
          'group bg-card hover:bg-muted/50 focus-visible:ring-ring relative flex h-[calc(var(--calendar-card-h)-8px)] w-full cursor-pointer items-center justify-between gap-3 rounded-lg border p-2 text-left shadow-sm transition-colors select-none focus:outline-none focus-visible:ring-2',
          queueSlotMeta.isPast && 'opacity-70'
        )}
      >
        {/* Default content (hidden on hover) */}
        <div className="flex w-full items-center justify-between gap-3 transition-opacity duration-150 ease-out group-hover:pointer-events-none group-hover:opacity-0">
          <div className="text-foreground w-16 shrink-0 text-sm font-medium">
            {queueSlotMeta.timeLabel}
          </div>
          <div className="flex min-w-0 items-center justify-end gap-2">
            <div className="bg-muted border-border text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border">
              {laneIcon(queueSlotMeta.laneKey)}
            </div>
          </div>
        </div>

        {/* Hover state: center Create button, hide everything else */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 ease-out group-hover:pointer-events-auto group-hover:opacity-100">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={queueSlotMeta.isPast}
            onClick={(e: MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              handleCreate();
            }}
          >
            Create
          </Button>
        </div>
      </div>
    );
  }

  const optimisticIndicator = optimisticLabel ? (
    <div className="bg-background/70 border-border text-muted-foreground pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span>{optimisticLabel}</span>
    </div>
  ) : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {isWide ? (
          <div
            ref={cardRef}
            role="button"
            tabIndex={0}
            onClick={handleOpen}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleOpen();
              }
            }}
            className={cn(
              'group bg-card hover:bg-muted/50 focus-visible:ring-ring relative flex h-[var(--calendar-card-h)] w-full cursor-pointer items-stretch gap-2 rounded-lg border p-2 text-left shadow-sm transition-colors select-none focus:outline-none focus-visible:ring-2',
              optimisticLabel && 'opacity-90'
            )}
            style={{ borderColor }}
          >
            {destinationAvatars ? (
              <div className="pointer-events-none absolute top-2 right-2 z-10 origin-top-right scale-90">
                {destinationAvatars}
              </div>
            ) : null}
            <div className="bg-muted relative w-14 shrink-0 self-stretch overflow-hidden rounded-md">
              {!imageReady && <div className="bg-muted absolute inset-0 animate-pulse" />}
              <img
                src={getPostImageOrPlaceholder(previewUrl)}
                alt=""
                onLoad={() => setImageReady(true)}
                onError={() => setImageReady(true)}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
                  imageReady ? 'opacity-100' : 'opacity-0'
                }`}
                loading="lazy"
                decoding="async"
              />
              {showMediaBadge ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <MediaTypeBadge type={mediaBadgeType} />
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PostStatusTimeBadge status={status} variant="inline">
                        {displayTime ? (
                          <span>{displayTime}</span>
                        ) : (
                          <span className="italic">No time</span>
                        )}
                      </PostStatusTimeBadge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span className="capitalize">
                        {status === 'placeholder' ? 'Future AI' : status}
                      </span>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              <div className="text-foreground mt-1 line-clamp-1 min-h-[1.4em] text-[12px] leading-snug">
                {(item as any)?.caption || '\u00A0'}
              </div>
            </div>
            {optimisticIndicator}
          </div>
        ) : (
          <div
            ref={cardRef}
            role="button"
            tabIndex={0}
            onClick={handleOpen}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleOpen();
              }
            }}
            className={cn(
              'group bg-card hover:bg-muted/50 focus-visible:ring-ring relative flex h-[var(--calendar-card-h)] w-full cursor-pointer flex-col justify-start gap-2 rounded-lg border p-2 text-left shadow-sm transition-colors select-none focus:outline-none focus-visible:ring-2',
              optimisticLabel && 'opacity-90'
            )}
            style={{ borderColor }}
          >
            {destinationAvatars ? (
              <div className="pointer-events-none absolute top-2 right-2 z-10 origin-top-right scale-90">
                {destinationAvatars}
              </div>
            ) : null}
            {/* Top row: time/status */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PostStatusTimeBadge status={status} variant="inline">
                        {displayTime ? (
                          <span>{displayTime}</span>
                        ) : (
                          <span className="italic">No time</span>
                        )}
                      </PostStatusTimeBadge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span className="capitalize">
                        {status === 'placeholder' ? 'Future AI' : status}
                      </span>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            {/* Second row: image + caption */}
            <div className="flex min-w-0 items-start gap-3 text-[12px] leading-snug">
              <div className="bg-muted relative h-[2.75em] w-[2.75em] shrink-0 overflow-hidden rounded-md">
                {!imageReady && <div className="bg-muted absolute inset-0 animate-pulse" />}
                <img
                  src={getPostImageOrPlaceholder(previewUrl)}
                  alt=""
                  onLoad={() => setImageReady(true)}
                  onError={() => setImageReady(true)}
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
                    imageReady ? 'opacity-100' : 'opacity-0'
                  }`}
                  loading="lazy"
                  decoding="async"
                />
                {showMediaBadge ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <MediaTypeBadge type={mediaBadgeType} />
                  </div>
                ) : null}
              </div>

              <div className="text-foreground line-clamp-2 min-w-0 flex-1">
                {(item as any)?.caption || ''}
              </div>
            </div>
            {optimisticIndicator}
          </div>
        )}
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <ContextMenuItem
          onSelect={() => openSidebar('post', { id: (item as any).id })}
          className="gap-2"
        >
          <ExternalLink className="h-4 w-4" />
          Open Post
        </ContextMenuItem>
        {item.type !== 'placeholder' && (item as any)?.status !== 'published' && (
          <ContextMenuItem onSelect={() => onReschedule && onReschedule(item)} className="gap-2">
            <CalendarClock className="h-4 w-4" />
            Reschedule
          </ContextMenuItem>
        )}
        {item.type !== 'placeholder' && (item as any)?.status === 'scheduled' && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <ContextMenuItem className="gap-2">
                <Clock className="h-4 w-4" />
                {groupMeta ? 'Unschedule all destinations' : 'Unschedule to Draft'}
              </ContextMenuItem>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {groupMeta ? 'Unschedule these posts?' : 'Unschedule this post?'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {groupMeta ? (
                    <>
                      We’ll cancel the scheduled publish time for{' '}
                      <span className="font-medium">{groupMeta.destinationCount} destinations</span>{' '}
                      and move them back to Drafts. They will no longer publish automatically.
                    </>
                  ) : (
                    <>
                      We’ll cancel the scheduled publish time and move this post back to Drafts. It
                      will no longer publish automatically.
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={unscheduleMutation.isPending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    unscheduleMutation.mutate(
                      groupMeta
                        ? {
                            kind: 'group',
                            contentGroupId: groupMeta.contentGroupId,
                            destinationCount: groupMeta.destinationCount,
                          }
                        : { kind: 'content', contentId: (item as any).id }
                    )
                  }
                  disabled={unscheduleMutation.isPending}
                >
                  {groupMeta
                    ? 'Unschedule all and move to Drafts'
                    : 'Unschedule and move to Drafts'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {item.type !== 'placeholder' && (
          <ContextMenuItem onSelect={handleDuplicate} className="gap-2">
            <Copy className="h-4 w-4" />
            Duplicate as Draft
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {item.type !== 'placeholder' && (
          <ContextMenuItem
            className="text-destructive focus:text-destructive gap-2"
            onSelect={() =>
              deleteMutation.mutate(
                groupMeta
                  ? {
                      kind: 'group',
                      contentGroupId: groupMeta.contentGroupId,
                      destinationCount: groupMeta.destinationCount,
                    }
                  : { kind: 'content', contentId: (item as any).id }
              )
            }
          >
            <Trash2 className="h-4 w-4" />
            {groupMeta ? 'Delete all destinations' : 'Delete'}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
