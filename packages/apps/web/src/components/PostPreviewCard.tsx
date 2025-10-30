import { type ReactNode, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import type { CalendarItem } from '../types/calendar';
import { formatCompact } from '../lib/timezone';
import {
  MoreHorizontal,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Pencil,
  ExternalLink,
  CalendarClock,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { content as contentApi } from '@/lib/api';
// import { convertLocalToUTC } from '@/lib/timezone';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Copy, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { getStoredCampaignColor } from '@/utils/campaign-color-storage';
import { getPostImageOrPlaceholder } from '@/lib/placeholders';

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
      // Format in brand timezone, compact without trailing tz
      displayTime = formatCompact(ts, 'h:mm a', timezone);
    }

    const directColor = (item as any)?.campaignColor || null;
    const stored = getStoredCampaignColor((item as any)?.campaignId) || null;
    const campaignColor = directColor || stored;

    return { status, displayTime, campaignColor };
  }, [item, timezone]);

  const handleOpen = () => {
    // Navigate to post details or create from placeholder
    if (item.type === 'placeholder') {
      // Open create in sidebar; CreatePost reads current location query if needed
      openSidebar('post-create');
      return;
    }
    openSidebar('post', { id: (item as any).id });
  };

  // Visual styles by status (subtle tints)
  const statusStyles: Record<string, string> = {
    draft: 'bg-muted hover:bg-accent/50',
    scheduled: 'bg-info/10 hover:bg-info/15',
    published: 'bg-success/10 hover:bg-success/15',
    failed: 'bg-destructive/10 hover:bg-destructive/15',
    skipped: 'bg-warning/10 hover:bg-warning/15',
    placeholder: 'bg-warning/10 hover:bg-warning/15',
  };

  const iconByStatus: Record<string, ReactNode> = {
    draft: <Clock className="h-3.5 w-3.5" />,
    scheduled: <Clock className="h-3.5 w-3.5" />,
    published: <CheckCircle2 className="h-3.5 w-3.5" />,
    failed: <AlertTriangle className="h-3.5 w-3.5" />,
    skipped: <AlertTriangle className="h-3.5 w-3.5" />,
    placeholder: <Clock className="h-3.5 w-3.5" />,
  };

  // Campaign accent removed - no longer using left border
  const campaignAccent = {};

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
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
      className={`hover:bg-muted group w-full rounded-md border px-2 py-2 text-left shadow-sm transition-colors ${
        statusStyles[status] || statusStyles.draft
      }`}
      style={campaignAccent}
    >
      {/* Top row: status icon + time, and tiny image thumbnail if present */}
      <div className="mb-1 flex items-start justify-between">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={`flex items-center gap-1.5 text-[11px] leading-none ${
                  status === 'published'
                    ? 'text-success'
                    : status === 'scheduled'
                      ? 'text-info'
                      : status === 'placeholder'
                        ? 'text-warning'
                        : status === 'failed'
                          ? 'text-destructive'
                          : status === 'skipped'
                            ? 'text-warning'
                            : 'text-muted-foreground'
                }`}
              >
                {iconByStatus[status]}
                {displayTime && <span className="font-medium">{displayTime}</span>}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <span className="capitalize">{status === 'placeholder' ? 'Future AI' : status}</span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="ml-2 h-6 w-8 shrink-0 overflow-hidden rounded-sm">
          {/* Use native img to avoid pulling in heavier components; fallback to placeholder */}
          <img
            src={getPostImageOrPlaceholder((item as any)?.imageUrl)}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>

      {/* Caption, clamped to two lines */}
      <div className="text-foreground line-clamp-2 text-[12px] leading-snug">
        {(item as any)?.caption || ''}
      </div>

      {/* Campaign badge (clickable) */}
      {item.campaignName ? (
        <div className="mt-1">
          <a
            href={item.campaignId ? `/campaigns/${item.campaignId}` : undefined}
            onClick={(e) => {
              if (!item.campaignId) return;
              e.stopPropagation();
            }}
            className="inline-flex max-w-full items-center gap-2 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              backgroundColor: campaignColor || 'hsl(var(--muted))',
              color: campaignColor ? 'white' : 'hsl(var(--foreground))',
            }}
            title={item.campaignName}
          >
            <span className="truncate">{item.campaignName}</span>
          </a>
        </div>
      ) : null}

      {/* Bottom row: edit (hidden for published) + menu */}
      <div className="mt-1 flex items-center justify-between">
        <div>
          {status !== 'published' && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 items-center justify-center p-1.5"
                    aria-label="Edit post"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (item.type === 'placeholder') {
                        const params = new URLSearchParams();
                        if ((item as any).campaignId)
                          params.set('campaignId', (item as any).campaignId);
                        if ((item as any).scheduledAt)
                          params.set('scheduledAt', (item as any).scheduledAt);
                        openSidebar('post-create');
                      } else {
                        openSidebar('post', { id: (item as any).id });
                      }
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit post</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <span
              className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex cursor-pointer rounded p-1.5 focus:outline-none focus-visible:ring-2"
              title="More options"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <MoreHorizontal className="h-4 w-4" />
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              onClick={() => openSidebar('post', { id: (item as any).id })}
              className="gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              Open Post
            </DropdownMenuItem>
            {item.type !== 'placeholder' && (item as any)?.status !== 'published' && (
              <DropdownMenuItem
                onClick={() => onReschedule && onReschedule(item)}
                className="gap-2"
              >
                <CalendarClock className="h-4 w-4" />
                Reschedule
              </DropdownMenuItem>
            )}
            {item.type !== 'placeholder' && (
              <DropdownMenuItem onClick={handleDuplicate} className="gap-2">
                <Copy className="h-4 w-4" />
                Duplicate as Draft
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {item.type !== 'placeholder' && (
              <DropdownMenuItem
                className="text-destructive gap-2"
                onClick={() => deleteMutation.mutate((item as any).id)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
