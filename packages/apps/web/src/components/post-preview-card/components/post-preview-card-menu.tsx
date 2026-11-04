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

type MenuTarget =
  { kind: 'content'; contentId: string } | { kind: 'group'; contentGroupId: string };

function getMenuTarget(item: CalendarItem, groupMeta: GroupMeta | null): MenuTarget {
  return groupMeta
    ? { kind: 'group', contentGroupId: groupMeta.contentGroupId }
    : { kind: 'content', contentId: item.id };
}

function usePostPreviewCardMutations(groupMeta: GroupMeta | null) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (target: MenuTarget) => {
      return target.kind === 'group'
        ? contentApi.deleteContentGroup(target.contentGroupId)
        : contentApi.deletePost(target.contentId);
    },
    onSuccess: () => {
      toast.success(groupMeta ? 'Posts deleted' : 'Post deleted');
      invalidateCalendarQueries(queryClient);
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, 'Failed to delete post')),
  });

  const unscheduleMutation = useMutation({
    mutationFn: (target: MenuTarget) => {
      return target.kind === 'group'
        ? contentApi.scheduleContentGroup(target.contentGroupId, null)
        : contentApi.updateContent({ contentId: target.contentId, scheduledAt: null });
    },
    onSuccess: () => {
      toast.success(
        groupMeta ? 'Posts unscheduled and moved to Drafts' : 'Post unscheduled and moved to Drafts'
      );
      invalidateCalendarQueries(queryClient);
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, 'Failed to unschedule post')),
  });

  return { deleteMutation, unscheduleMutation };
}

function UnscheduleMenuItem({
  groupMeta,
  pending,
  onConfirm,
}: {
  groupMeta: GroupMeta | null;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
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
                <span className="font-medium">{groupMeta.destinationCount} destinations</span> and
                move them back to Drafts. They will no longer publish automatically.
              </>
            ) : (
              <>
                We’ll cancel the scheduled publish time and move this post back to Drafts. It will
                no longer publish automatically.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            {groupMeta ? 'Unschedule all and move to Drafts' : 'Unschedule and move to Drafts'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PostPreviewCardMenu({
  item,
  status,
  groupMeta,
  onOpen,
  onReschedule,
  onDuplicate,
  children,
}: PostPreviewCardMenuProps) {
  const target = getMenuTarget(item, groupMeta);
  const { deleteMutation, unscheduleMutation } = usePostPreviewCardMutations(groupMeta);
  const canManage = item.type !== 'placeholder';
  const canReschedule = canManage && status !== 'published';
  const canUnschedule = canManage && status === 'scheduled';

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={onOpen} className="gap-2">
          <ExternalLink className="h-4 w-4" />
          {item.type === 'placeholder' ? 'Create Post' : 'Open Post'}
        </ContextMenuItem>

        {canReschedule ? (
          <ContextMenuItem onSelect={() => onReschedule?.(item)} className="gap-2">
            <CalendarClock className="h-4 w-4" />
            Reschedule
          </ContextMenuItem>
        ) : null}

        {canUnschedule ? (
          <UnscheduleMenuItem
            groupMeta={groupMeta}
            pending={unscheduleMutation.isPending}
            onConfirm={() => unscheduleMutation.mutate(target)}
          />
        ) : null}

        {canManage ? (
          <ContextMenuItem onSelect={onDuplicate} className="gap-2">
            <Copy className="h-4 w-4" />
            Duplicate as Draft
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />

        {canManage ? (
          <ContextMenuItem
            className="text-destructive focus:text-destructive gap-2"
            onSelect={() => deleteMutation.mutate(target)}
          >
            <Trash2 className="h-4 w-4" />
            {groupMeta ? 'Delete all destinations' : 'Delete'}
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
