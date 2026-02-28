import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { PostEditor } from '@/components/post-editor/post-editor';
import { Card } from '@/components/ui/card';
import { usePageMeta } from '@/contexts/PageMetaContext';
import { useTimezone } from '@/contexts/TimezoneContext';
import { usePostDetail } from '@/hooks/usePostDetail';
import { content as contentApi, analytics } from '@/lib/api';
import { isMultiDestinationEnabled } from '@/lib/feature-flags';
import { useAuthStore } from '@/stores/authStore';

import { PostActionsCard } from './components/post-actions-card';
import { PostDetailsCard } from './components/post-details-card';
import { PostInformationCard } from './components/post-information-card';
import { PostPerformanceCard } from './components/post-performance-card';
import { usePublicationButtons } from './publication-buttons';
import type { PostInsights } from './types';

function usePostPageMeta(params: {
  isCreate: boolean;
  isPosted: boolean;
  post: ReturnType<typeof usePostDetail>['data'];
  setPageMetaOverride: (value: { title: string; description?: string } | null) => void;
}) {
  useEffect(() => {
    if (params.isCreate) {
      params.setPageMetaOverride({
        title: 'Create Post',
        description: 'Create and schedule a new post.',
      });
      return () => params.setPageMetaOverride(null);
    }

    const title = params.isPosted ? 'View Post' : 'Edit Post';
    const description = (() => {
      if (!params.post) {
        return undefined;
      }
      if (params.isPosted) {
        return 'Published posts are read-only.';
      }
      if (params.post.status === 'scheduled') {
        return 'Tip: Update the time or unschedule to draft.';
      }
      return 'Tip: Set a time below to schedule when ready.';
    })();

    params.setPageMetaOverride({ title: params.post ? title : 'Post', description });
    return () => params.setPageMetaOverride(null);
  }, [params]);
}

function useBrandTimezone(
  postBrandId: string | undefined,
  timezone: string,
  getBrandTimezone: (id: string) => Promise<string | null>
) {
  const [brandTimezone, setBrandTimezone] = useState<string>(timezone);

  useEffect(() => {
    let mounted = true;
    const resolveTimezone = async () => {
      if (!postBrandId) {
        return;
      }
      try {
        const resolved = await getBrandTimezone(postBrandId);
        if (mounted && resolved) {
          setBrandTimezone(resolved);
        }
      } catch {
        if (mounted) {
          setBrandTimezone(timezone);
        }
      }
    };

    void resolveTimezone();
    return () => {
      mounted = false;
    };
  }, [getBrandTimezone, postBrandId, timezone]);

  return brandTimezone;
}

function usePublicationData(params: {
  postId?: string;
  resolvedPostId: string;
  postStatus?: string;
  postInstagramPermalink?: string | null;
}) {
  const publicationsQuery = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ['v2-publications', params.postId],
    queryFn: async () => analytics.getPublicationsByContent(params.resolvedPostId),
    enabled: Boolean(params.postId) && params.postStatus === 'published',
    staleTime: 30000,
  });

  const selectedPublicationId = useMemo(() => {
    const pubs = publicationsQuery.data?.data || [];
    if (!pubs.length) {
      return undefined;
    }
    const preferred = pubs.find((pub: any) => pub.platform === 'instagram');
    return (preferred || pubs[0])?.id as string | undefined;
  }, [publicationsQuery.data?.data]);

  const latestQuery = useQuery<{ success: boolean; data: any } | undefined>({
    queryKey: ['v2-latest', selectedPublicationId],
    queryFn: async () =>
      selectedPublicationId
        ? await analytics.getPublicationLatest(selectedPublicationId)
        : undefined,
    enabled: Boolean(selectedPublicationId),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const insights = useMemo<PostInsights | undefined>(() => {
    const latest = latestQuery.data?.data;
    if (!latest) {
      return undefined;
    }
    return {
      metrics: {
        reach: Number(latest.reach || 0),
        engagement: Number(latest.engagement || 0),
        saves: Number(latest.saves || 0),
        shares: Number(latest.shares || 0),
        comments_count: Number(latest.comments || 0),
        likes_count: Number(latest.likes || 0),
      },
      lastUpdated: latest.lastUpdated || new Date().toISOString(),
    };
  }, [latestQuery.data?.data]);

  const publicationButtons = usePublicationButtons(
    publicationsQuery.data?.data || [],
    params.postStatus,
    params.postInstagramPermalink
  );

  return { publicationsQuery, selectedPublicationId, insights, publicationButtons };
}

function refreshPublicationWithToast(
  selectedPublicationId: string | undefined,
  successMessage: string
) {
  if (!selectedPublicationId) {
    return;
  }
  void analytics
    .refreshPublication(selectedPublicationId)
    .then(() => toast.success(successMessage))
    .catch(() => toast.error('Unable to enqueue refresh'));
}

function usePostMutations(params: {
  queryClient: ReturnType<typeof useQueryClient>;
  navigate: ReturnType<typeof useNavigate>;
  postId?: string;
  resolvedPostId: string;
  isMultiDestinationGroup: boolean;
  contentGroupId: string | null;
}) {
  const publishNowMutation = useMutation({
    mutationFn: async () =>
      params.isMultiDestinationGroup && params.contentGroupId
        ? contentApi.publishContentGroupNow(params.contentGroupId)
        : contentApi.publishNow(params.resolvedPostId),
    onSuccess: () => {
      toast.success(
        params.isMultiDestinationGroup
          ? 'Publishing started for all destinations'
          : 'Publishing started'
      );
      params.queryClient.invalidateQueries({ queryKey: ['post', params.postId] });
      if (params.contentGroupId) {
        params.queryClient.invalidateQueries({
          queryKey: ['content-group', params.contentGroupId],
        });
      }
    },
    onError: () => toast.error('Failed to publish post'),
  });

  const deletePostMutation = useMutation({
    mutationFn: async () =>
      params.isMultiDestinationGroup && params.contentGroupId
        ? contentApi.deleteContentGroup(params.contentGroupId)
        : contentApi.deletePost(params.resolvedPostId),
    onSuccess: () => {
      toast.success('Post deleted successfully');
      params.navigate(-1);
    },
    onError: () => toast.error('Failed to delete post'),
  });

  return { publishNowMutation, deletePostMutation };
}

function usePostPageGroupState(params: {
  post: ReturnType<typeof usePostDetail>['data'];
  multiDestinationEnabled: boolean;
}) {
  const contentGroupId = useMemo(() => {
    const raw = params.post?.contentGroupId;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }, [params.post?.contentGroupId]);

  const contentGroupQuery = useQuery({
    queryKey: ['content-group', contentGroupId],
    enabled: Boolean(contentGroupId) && params.multiDestinationEnabled,
    queryFn: () => contentApi.getContentGroup(contentGroupId!),
    staleTime: 10000,
  });

  const isMultiDestinationGroup = useMemo(() => {
    if (!contentGroupId || !params.multiDestinationEnabled) {
      return false;
    }
    const raw = contentGroupQuery.data as any;
    const destinations = Array.isArray(raw?.destinations) ? raw.destinations : [];
    return destinations.length > 1;
  }, [contentGroupId, contentGroupQuery.data, params.multiDestinationEnabled]);

  return { contentGroupId, isMultiDestinationGroup };
}

function PostPageContent({
  postId,
  isLoading,
  post,
  isPosted,
  brandTimezone,
  publicationButtons,
  insights,
  comments,
  selectedPublicationId,
  publishNowMutation,
  deletePostMutation,
  isMultiDestinationGroup,
}: {
  postId?: string;
  isLoading: boolean;
  post: ReturnType<typeof usePostDetail>['data'];
  isPosted: boolean;
  brandTimezone: string;
  publicationButtons: React.ReactNode[];
  insights: PostInsights | undefined;
  comments: Array<{ username: string; text: string }>;
  selectedPublicationId: string | undefined;
  publishNowMutation: ReturnType<typeof usePostMutations>['publishNowMutation'];
  deletePostMutation: ReturnType<typeof usePostMutations>['deletePostMutation'];
  isMultiDestinationGroup: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
      <div className="lg:col-span-2">
        <PostEditor id={postId} layout="page" showHeader={false} />
      </div>

      <div className="space-y-4 lg:space-y-6">
        {isLoading || !post ? (
          <Card className="p-4 md:p-6">
            <div className="text-muted-foreground text-sm">Loading…</div>
          </Card>
        ) : (
          <>
            <PostDetailsCard
              post={post}
              isPosted={isPosted}
              publicationButtons={publicationButtons}
            />
            <PostInformationCard post={post} brandTimezone={brandTimezone} />
            {post.status === 'published' ? (
              <PostPerformanceCard
                insights={insights}
                comments={comments}
                selectedPublicationId={selectedPublicationId}
                onRefreshMetrics={() =>
                  refreshPublicationWithToast(selectedPublicationId, 'Metrics refresh enqueued')
                }
                onRefreshComments={() =>
                  refreshPublicationWithToast(selectedPublicationId, 'Comments refresh enqueued')
                }
              />
            ) : null}

            <PostActionsCard
              isPosted={isPosted}
              isMultiDestinationGroup={isMultiDestinationGroup}
              postStatus={post.status}
              publishPending={publishNowMutation.isPending}
              deletePending={deletePostMutation.isPending}
              onPublishNow={() => publishNowMutation.mutate()}
              onDelete={() => deletePostMutation.mutate()}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function PostPage() {
  const { postId } = useParams<{ postId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { timezone, getBrandTimezone } = useTimezone();
  const { setOverride: setPageMetaOverride } = usePageMeta();
  const user = useAuthStore((state) => state.user);

  const isCreate = !postId;
  const resolvedPostId = postId || '';
  const multiDestinationEnabled = isMultiDestinationEnabled(user);

  const { data: post, isLoading } = usePostDetail(postId);
  const isPosted = Boolean(post?.postedAt) || post?.status === 'published';
  const { contentGroupId, isMultiDestinationGroup } = usePostPageGroupState({
    post,
    multiDestinationEnabled,
  });

  usePostPageMeta({ isCreate, isPosted, post, setPageMetaOverride });

  const brandTimezone = useBrandTimezone(post?.brand?.id, timezone, getBrandTimezone);
  const publicationData = usePublicationData({
    postId,
    resolvedPostId,
    postStatus: post?.status,
    postInstagramPermalink: post?.instagramPermalink,
  });

  const commentsQuery = useQuery<{ comments: Array<{ username: string; text: string }> }>({
    queryKey: ['post-comments', postId],
    queryFn: async () => (await contentApi.getPostComments(resolvedPostId)).data,
    enabled: Boolean(postId) && post?.status === 'published',
    staleTime: 60000,
  });
  const mutations = usePostMutations({
    queryClient,
    navigate,
    postId,
    resolvedPostId,
    isMultiDestinationGroup,
    contentGroupId,
  });

  if (isCreate) {
    return <PostEditor layout="page" showHeader={false} />;
  }

  return (
    <PostPageContent
      postId={postId}
      isLoading={isLoading}
      post={post}
      isPosted={isPosted}
      brandTimezone={brandTimezone}
      publicationButtons={publicationData.publicationButtons}
      insights={publicationData.insights}
      comments={commentsQuery.data?.comments || []}
      selectedPublicationId={publicationData.selectedPublicationId}
      publishNowMutation={mutations.publishNowMutation}
      deletePostMutation={mutations.deletePostMutation}
      isMultiDestinationGroup={isMultiDestinationGroup}
    />
  );
}
