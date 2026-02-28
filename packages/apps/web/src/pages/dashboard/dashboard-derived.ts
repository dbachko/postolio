import { useMemo } from 'react';

import { usePostEditorQueueAvailability } from '@/components/post-editor/post-editor/hooks/use-post-editor-queue-availability';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import type { Content } from '@/lib/api';

import type { CommentsInboxItem } from './types';
import type { useDashboardQueries } from './index';

function useDashboardPostData(queries: ReturnType<typeof useDashboardQueries>) {
  const contentHistory = useMemo(
    () => ((queries.contentHistoryQuery.data as any)?.content || []) as Content[],
    [queries.contentHistoryQuery.data]
  );
  const failedPosts = useMemo(
    () => contentHistory.filter((post) => post.status === 'failed'),
    [contentHistory]
  );
  const failedPreviewPosts = useMemo(() => failedPosts.slice(0, 3), [failedPosts]);
  const failedPreviewAssets = useAssetsByIds(failedPreviewPosts.map((post) => post.primaryAssetId));

  const upcomingPosts = useMemo(() => {
    const now = Date.now();
    return contentHistory
      .filter(
        (post) =>
          post.status === 'scheduled' &&
          post.scheduledAt &&
          new Date(post.scheduledAt).getTime() > now
      )
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
      .slice(0, 3);
  }, [contentHistory]);
  const upcomingAssets = useAssetsByIds(upcomingPosts.map((post) => post.primaryAssetId));

  const drafts = useMemo(
    () => ((queries.draftsQuery.data as any)?.content || []) as Content[],
    [queries.draftsQuery.data]
  );
  const unscheduledDrafts = useMemo(() => drafts.filter((draft) => !draft.scheduledAt), [drafts]);
  const draftPreviewDrafts = useMemo(() => unscheduledDrafts.slice(0, 3), [unscheduledDrafts]);
  const draftPreviewAssets = useAssetsByIds(
    draftPreviewDrafts.map((draft) => draft.primaryAssetId)
  );

  return {
    failedPosts,
    failedPreviewPosts,
    failedPreviewAssets,
    upcomingPosts,
    upcomingAssets,
    drafts,
    unscheduledDrafts,
    draftPreviewDrafts,
    draftPreviewAssets,
  };
}

function useDashboardQueueState(queries: ReturnType<typeof useDashboardQueries>) {
  const connectedSocialAccountIds = useMemo(() => {
    const raw = queries.connectedAccountsQuery.data as any;
    const socialAccounts = Array.isArray(raw?.socialAccounts) ? raw.socialAccounts : [];
    return socialAccounts
      .filter((account: any) => account?.disconnected !== true && typeof account?.id === 'string')
      .map((account: any) => account.id as string);
  }, [queries.connectedAccountsQuery.data]);

  const queueAvailability = usePostEditorQueueAvailability({
    socialAccountIds: connectedSocialAccountIds,
  });
  const showScheduleSetupReminder = useMemo(() => {
    if (!connectedSocialAccountIds.length) {
      return false;
    }
    const allResolved = queueAvailability.uniqueSocialAccountIds.every((id) => {
      if (queueAvailability.queueSlotsLoadingBySocialAccountId[id]) {
        return false;
      }
      if (queueAvailability.queueSlotsErrorBySocialAccountId[id]) {
        return false;
      }
      return queueAvailability.hasQueueSlotsBySocialAccountId[id] !== null;
    });
    if (!allResolved) {
      return false;
    }
    return !queueAvailability.uniqueSocialAccountIds.some(
      (id) => queueAvailability.hasQueueSlotsBySocialAccountId[id] === true
    );
  }, [connectedSocialAccountIds.length, queueAvailability]);

  return { showScheduleSetupReminder };
}

function useDashboardInboxState(
  inboxEnabled: boolean,
  commentsInboxQuery: ReturnType<typeof useDashboardQueries>['commentsInboxQuery']
) {
  const commentsInboxItems = useMemo(() => {
    if (!inboxEnabled) {
      return [] as CommentsInboxItem[];
    }
    const items = ((commentsInboxQuery.data as any)?.items || []) as any[];
    return items
      .filter((item) => item?.type === 'comment_thread')
      .map((item) => ({
        postId: item.postId,
        caption: item.caption ?? null,
        permalink: item.permalink ?? null,
        postedAt: item.postedAt ?? null,
        totalComments: Number(item.totalComments || 0),
        resolvedCount: Number(item.resolvedCount || 0),
        newCount: Number(item.newCount || 0),
      }))
      .sort((a, b) => (b.newCount || 0) - (a.newCount || 0)) satisfies CommentsInboxItem[];
  }, [commentsInboxQuery.data, inboxEnabled]);

  const newCommentsCount = useMemo(
    () => commentsInboxItems.reduce((sum, item) => sum + (item.newCount || 0), 0),
    [commentsInboxItems]
  );

  return { commentsInboxItems, newCommentsCount };
}

export function useDashboardDerived(
  inboxEnabled: boolean,
  queries: ReturnType<typeof useDashboardQueries>
) {
  const posts = useDashboardPostData(queries);
  const queue = useDashboardQueueState(queries);
  const inbox = useDashboardInboxState(inboxEnabled, queries.commentsInboxQuery);

  const needsAttentionCount = useMemo(() => {
    const igConnected =
      queries.instagramStatusQuery.data && typeof queries.instagramStatusQuery.data === 'object'
        ? Boolean((queries.instagramStatusQuery.data as any).connected)
        : true;
    const connectionIssue = queries.instagramStatusQuery.isSuccess && !igConnected ? 1 : 0;
    return posts.failedPosts.length + connectionIssue;
  }, [
    posts.failedPosts.length,
    queries.instagramStatusQuery.data,
    queries.instagramStatusQuery.isSuccess,
  ]);

  return { ...posts, ...queue, ...inbox, needsAttentionCount };
}
