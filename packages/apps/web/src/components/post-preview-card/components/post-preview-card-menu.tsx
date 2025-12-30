import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Clock, Copy, ExternalLink, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CalendarItem } from '@/types/calendar';
import { content as contentApi } from '@/lib/api';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { GroupMeta, PostStatus } from '../types';
import { getErrorMessage, invalidateCalendarQueries } from '../utils';

type PostPreviewCardMenuProps = {
  item: CalendarItem;
  status: PostStatus;
  groupMeta: GroupMeta | null;
  onOpen: () => void;
  onReschedule?: (item: CalendarItem) => void;
  onDuplicate: () => void;
  children: ReactNode;
};

export function PostPreviewCardMenu({
  item,
  status,
  groupMeta,
  onOpen,
  onReschedule,
  onDuplicate,
  children,
}: PostPreviewCardMenuProps) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (
      target: { kind: 'content'; contentId: string } | { kind: 'group'; contentGroupId: string }
    ) => {
      if (target.kind === 'group') {
        return contentApi.deleteContentGroup(target.contentGroupId);
      }
      return contentApi.deletePost(target.contentId);
    },
    onSuccess: () => {
      toast.success(groupMeta ? 'Posts deleted' : 'Post deleted');
      invalidateCalendarQueries(queryClient);
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, 'Failed to delete post')),
  });

  const unscheduleMutation = useMutation({
    mutationFn: (
      target: { kind: 'content'; contentId: string } | { kind: 'group'; contentGroupId: string }
    ) => {
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
      invalidateCalendarQueries(queryClient);
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, 'Failed to unschedule post')),
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={onOpen} className="gap-2">
          <ExternalLink className="h-4 w-4" />
          {item.type === 'placeholder' ? 'Create Post' : 'Open Post'}
        </ContextMenuItem>

        {item.type !== 'placeholder' && status !== 'published' && (
          <ContextMenuItem
            onSelect={() => {
              onReschedule?.(item);
            }}
            className="gap-2"
          >
            <CalendarClock className="h-4 w-4" />
            Reschedule
          </ContextMenuItem>
        )}

        {item.type !== 'placeholder' && status === 'scheduled' && (
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
                        ? { kind: 'group', contentGroupId: groupMeta.contentGroupId }
                        : { kind: 'content', contentId: item.id }
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
          <ContextMenuItem onSelect={onDuplicate} className="gap-2">
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
                  ? { kind: 'group', contentGroupId: groupMeta.contentGroupId }
                  : { kind: 'content', contentId: item.id }
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
