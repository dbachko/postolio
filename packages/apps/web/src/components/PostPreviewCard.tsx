import { type ReactNode, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CalendarItem } from '../types/calendar';
import { formatCompact } from '../lib/timezone';
import { Pencil, MoreHorizontal, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
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
} from './ui/dropdown-menu';
import { ExternalLink, CalendarClock, Copy, Trash2 } from 'lucide-react';

interface PostPreviewCardProps {
  item: CalendarItem;
  timezone: string;
  onReschedule?: (item: CalendarItem) => void;
}

// Lightweight preview card shown inside the Month grid
export function PostPreviewCard({ item, timezone, onReschedule }: PostPreviewCardProps) {
  const navigate = useNavigate();

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

    const campaignColor = (item as any)?.campaignColor || null;

    return { status, displayTime, campaignColor };
  }, [item, timezone]);

  const handleOpen = () => {
    // Navigate to post details or create from placeholder
    if (item.type === 'placeholder') {
      const params = new URLSearchParams();
      if (item.campaignId) params.set('campaignId', item.campaignId);
      if (item.scheduledAt) params.set('scheduledAt', item.scheduledAt);
      navigate(`/posts/create?${params.toString()}`);
      return;
    }
    navigate(`/posts/${item.id}`);
  };

  // Visual styles by status
  const statusStyles: Record<string, string> = {
    draft: 'bg-white border-gray-300',
    scheduled: 'bg-white border-blue-300',
    published: 'bg-green-50 border-green-300',
    failed: 'bg-red-50 border-red-300',
    skipped: 'bg-yellow-50 border-yellow-300',
    placeholder: 'bg-amber-50 border-amber-300',
  };

  const iconByStatus: Record<string, ReactNode> = {
    draft: <Clock className="h-3.5 w-3.5 text-gray-500" />,
    scheduled: <Clock className="h-3.5 w-3.5 text-blue-600" />,
    published: <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />,
    failed: <AlertTriangle className="h-3.5 w-3.5 text-red-600" />,
    skipped: <AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />,
    placeholder: <Clock className="h-3.5 w-3.5 text-amber-600" />,
  };

  // Campaign accent (thin left border)
  const campaignAccent = campaignColor
    ? { borderLeftColor: campaignColor, borderLeftWidth: 3, borderLeftStyle: 'solid' as const }
    : {};

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
    <button
      type="button"
      onClick={handleOpen}
      className={`group w-full rounded-md border px-2 py-2 text-left shadow-sm transition-colors hover:bg-gray-50 ${
        statusStyles[status] || statusStyles.draft
      }`}
      style={campaignAccent}
    >
      {/* Top row: status icon + time, and tiny image thumbnail if present */}
      <div className="mb-1 flex items-start justify-between">
        <div className="flex items-center gap-1.5 text-[11px] leading-none text-gray-600">
          {iconByStatus[status]}
          {displayTime && <span className="font-medium">{displayTime}</span>}
        </div>
        {item.imageUrl ? (
          <div className="ml-2 h-6 w-8 shrink-0 overflow-hidden rounded-sm">
            {/* Use native img to avoid pulling in heavier components */}
            <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
          </div>
        ) : null}
      </div>

      {/* Caption, clamped to two lines */}
      <div className="line-clamp-2 text-[12px] leading-snug text-gray-900">
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
            className="inline-flex max-w-full items-center gap-2 rounded-full border px-2 py-0.5 text-[11px] font-medium"
            style={{
              borderColor: campaignColor || '#3b82f6',
              color: '#111827',
            }}
            title={item.campaignName}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: campaignColor || '#3b82f6' }}
            />
            <span className="truncate">{item.campaignName}</span>
          </a>
        </div>
      ) : null}

      {/* Bottom row: icon-only Edit + menu */}
      <div className="mt-1 flex items-center justify-between">
        <button
          type="button"
          className="inline-flex items-center justify-center rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:bg-gray-200"
          title="Edit post"
          aria-label="Edit post"
          onClick={(e) => {
            e.stopPropagation();
            if (item.type === 'placeholder') return;
            window.location.href = `/posts/${(item as any).id}?edit=1`;
          }}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <span
              className="inline-flex cursor-pointer rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:bg-gray-200"
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
              onClick={() => navigate(`/posts/${(item as any).id}`)}
              className="gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              Open Post
            </DropdownMenuItem>
            {item.type !== 'placeholder' && (
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
                className="gap-2 text-red-600"
                onClick={() => deleteMutation.mutate((item as any).id)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </button>
  );
}
