import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import type { CalendarItem } from '../types/calendar';
import { formatInTimeZone } from 'date-fns-tz';
import { CheckCircle2, Clock, AlertTriangle, ExternalLink, CalendarClock } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { content as contentApi } from '@/lib/api';
// import { convertLocalToUTC } from '@/lib/timezone';
import { toast } from 'sonner';
import { Copy, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getStoredCampaignColor } from '@/utils/campaign-color-storage';
import { getPostImageOrPlaceholder } from '@/lib/placeholders';
import { getPostStatusBorderColor, getPostStatusTextClass } from '@/utils/post-status-colors';
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

interface PostPreviewCardProps {
  item: CalendarItem;
  timezone: string;
  onReschedule?: (item: CalendarItem) => void;
}

// Lightweight preview card shown inside the Month grid
export function PostPreviewCard({ item, timezone, onReschedule }: PostPreviewCardProps) {
  const navigate = useNavigate();
  const { openSidebar } = useRightSidebarRouter();

  const { status, displayTime, campaignColor } = useMemo(() => {
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

    const directColor = (item as any)?.campaignColor || null;
    const stored = getStoredCampaignColor((item as any)?.campaignId) || null;
    const campaignColor = directColor || stored;

    return { status, displayTime, campaignColor };
  }, [item, timezone]);

  const [imageReady, setImageReady] = useState(false);
  const imageUrl = (item as any)?.imageUrl;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    setImageReady(false);
  }, [imageUrl]);

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
      // Open create in sidebar; CreatePost reads current location query if needed
      openSidebar('post-create');
      return;
    }
    openSidebar('post', { id: (item as any).id });
  };

  const iconByStatus: Record<string, ReactNode> = {
    draft: <Clock className="h-3.5 w-3.5" />,
    scheduled: <Clock className="h-3.5 w-3.5" />,
    published: <CheckCircle2 className="h-3.5 w-3.5" />,
    failed: <AlertTriangle className="h-3.5 w-3.5" />,
    skipped: <AlertTriangle className="h-3.5 w-3.5" />,
    placeholder: <Clock className="h-3.5 w-3.5" />,
  };

  // Status-tinted border to match calendar cards
  const borderColor = getPostStatusBorderColor(status);
  const statusTextClass = getPostStatusTextClass(status);

  // Mutations
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: (id: string) => contentApi.deletePost(id),
    onSuccess: () => {
      toast.success('Post deleted');
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['content'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to delete post'),
  });

  const unscheduleMutation = useMutation({
    mutationFn: (id: string) =>
      contentApi.updateContent({
        contentId: id,
        scheduledAt: null,
      }),
    onSuccess: () => {
      toast.success('Post unscheduled and moved to Drafts');
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['content'] });
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
            className="group bg-card hover:bg-muted/50 focus-visible:ring-ring flex h-[var(--calendar-card-h)] w-full cursor-pointer items-stretch gap-3 rounded-lg border p-3 text-left shadow-sm transition-colors select-none focus:outline-none focus-visible:ring-2"
            style={{ borderColor }}
          >
            <div className="bg-muted relative w-14 shrink-0 self-stretch overflow-hidden rounded-md">
              {!imageReady && <div className="bg-muted absolute inset-0 animate-pulse" />}
              <img
                src={getPostImageOrPlaceholder(imageUrl)}
                alt=""
                onLoad={() => setImageReady(true)}
                onError={() => setImageReady(true)}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
                  imageReady ? 'opacity-100' : 'opacity-0'
                }`}
                loading="lazy"
                decoding="async"
              />
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={`flex shrink-0 items-center gap-1.5 text-[11px] leading-none whitespace-nowrap ${statusTextClass}`}
                      >
                        {iconByStatus[status]}
                        {displayTime ? (
                          <span>{displayTime}</span>
                        ) : (
                          <span className="italic">No time</span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span className="capitalize">
                        {status === 'placeholder' ? 'Future AI' : status}
                      </span>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <div className="flex min-w-0 items-center gap-1">
                  {item.campaignName ? (
                    <a
                      href={item.campaignId ? `/campaigns/${item.campaignId}` : undefined}
                      onClick={(e) => {
                        if (!item.campaignId) return;
                        e.stopPropagation();
                      }}
                      className="inline-flex max-w-[10rem] min-w-0 items-center gap-2 overflow-hidden rounded-full px-2 py-0.5 text-[11px] font-medium text-ellipsis whitespace-nowrap"
                      style={{
                        backgroundColor: campaignColor || 'hsl(var(--muted))',
                        color: campaignColor ? 'white' : 'hsl(var(--foreground))',
                      }}
                      title={item.campaignName}
                    >
                      <span className="block min-w-0 truncate">{item.campaignName}</span>
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="text-foreground line-clamp-1 min-h-[1.4em] text-[12px] leading-snug">
                {(item as any)?.caption || '\u00A0'}
              </div>
            </div>
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
            className="group bg-card hover:bg-muted/50 focus-visible:ring-ring flex h-[var(--calendar-card-h)] w-full cursor-pointer flex-col justify-start gap-2 rounded-lg border p-3 text-left shadow-sm transition-colors select-none focus:outline-none focus-visible:ring-2"
            style={{ borderColor }}
          >
            {/* Top row: time/status + campaign */}
            <div className="flex items-center justify-between gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`flex shrink-0 items-center gap-1.5 text-[11px] leading-none whitespace-nowrap ${statusTextClass}`}
                    >
                      {iconByStatus[status]}
                      {displayTime ? (
                        <span>{displayTime}</span>
                      ) : (
                        <span className="italic">No time</span>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span className="capitalize">
                      {status === 'placeholder' ? 'Future AI' : status}
                    </span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <div className="flex min-w-0 items-center gap-1">
                {item.campaignName ? (
                  <a
                    href={item.campaignId ? `/campaigns/${item.campaignId}` : undefined}
                    onClick={(e) => {
                      if (!item.campaignId) return;
                      e.stopPropagation();
                    }}
                    className="inline-flex max-w-[8.5rem] min-w-0 items-center gap-2 overflow-hidden rounded-full px-2 py-0.5 text-[11px] font-medium text-ellipsis whitespace-nowrap"
                    style={{
                      backgroundColor: campaignColor || 'hsl(var(--muted))',
                      color: campaignColor ? 'white' : 'hsl(var(--foreground))',
                    }}
                    title={item.campaignName}
                  >
                    <span className="block min-w-0 truncate">{item.campaignName}</span>
                  </a>
                ) : null}
              </div>
            </div>

            {/* Second row: image + caption */}
            <div className="flex min-w-0 items-start gap-3 text-[12px] leading-snug">
              <div className="bg-muted relative h-[2.75em] w-[2.75em] shrink-0 overflow-hidden rounded-md">
                {!imageReady && <div className="bg-muted absolute inset-0 animate-pulse" />}
                <img
                  src={getPostImageOrPlaceholder(imageUrl)}
                  alt=""
                  onLoad={() => setImageReady(true)}
                  onError={() => setImageReady(true)}
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
                    imageReady ? 'opacity-100' : 'opacity-0'
                  }`}
                  loading="lazy"
                  decoding="async"
                />
              </div>

              <div className="text-foreground line-clamp-2 min-w-0 flex-1">
                {(item as any)?.caption || ''}
              </div>
            </div>
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
                Unschedule to Draft
              </ContextMenuItem>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unschedule this post?</AlertDialogTitle>
                <AlertDialogDescription>
                  We’ll cancel the scheduled publish time and move this post back to Drafts. It will
                  no longer publish automatically.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={unscheduleMutation.isPending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => unscheduleMutation.mutate((item as any).id)}
                  disabled={unscheduleMutation.isPending}
                >
                  Unschedule and move to Drafts
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
            onSelect={() => deleteMutation.mutate((item as any).id)}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
