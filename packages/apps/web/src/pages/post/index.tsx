import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, Instagram } from 'lucide-react';

import { content as contentApi, analytics } from '@/lib/api';
import { PostEditor } from '@/components/post-editor/post-editor';
import { useTimezone } from '@/contexts/TimezoneContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { usePostDetail } from '@/hooks/usePostDetail';
import { usePageMeta } from '@/contexts/PageMetaContext';

import type { PostInsights } from './types';
import { PostDetailsCard } from './components/post-details-card';
import { PostInformationCard } from './components/post-information-card';
import { PostPerformanceCard } from './components/post-performance-card';
import { PostActionsCard } from './components/post-actions-card';

type PublicationLink = { key: string; platform: string; permalink: string };

export default function PostPage() {
  const { postId } = useParams<{ postId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { timezone, getBrandTimezone } = useTimezone();
  const { setOverride: setPageMetaOverride } = usePageMeta();

  const isCreate = !postId;
  const resolvedPostId = postId || '';

  const { data: post, isLoading } = usePostDetail(postId);
  const [brandTimezone, setBrandTimezone] = useState<string>(timezone);

  const isPosted = Boolean(post?.postedAt) || post?.status === 'published';

  const contentGroupId = useMemo(() => {
    const raw = post?.contentGroupId;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : null;
  }, [post?.contentGroupId]);

  const contentGroupQuery = useQuery({
    queryKey: ['content-group', contentGroupId],
    enabled: Boolean(contentGroupId),
    queryFn: () => contentApi.getContentGroup(contentGroupId!),
    staleTime: 10000,
  });

  const isMultiDestinationGroup = useMemo(() => {
    if (!contentGroupId) return false;
    const raw = contentGroupQuery.data as any;
    const destinations = Array.isArray(raw?.destinations) ? raw.destinations : [];
    return destinations.length > 1;
  }, [contentGroupId, contentGroupQuery.data]);

  useEffect(() => {
    if (isCreate) {
      setPageMetaOverride({
        title: 'Create Post',
        description: 'Create and schedule a new post.',
      });
      return () => setPageMetaOverride(null);
    }

    const title = isPosted ? 'View Post' : 'Edit Post';
    const description = (() => {
      if (!post) return undefined;
      if (isPosted) return 'Published posts are read-only.';
      if (post.status === 'scheduled') return 'Tip: Update the time or unschedule to draft.';
      return 'Tip: Set a time below to schedule when ready.';
    })();
    setPageMetaOverride({
      title: post ? title : 'Post',
      description,
    });
    return () => setPageMetaOverride(null);
  }, [isCreate, isPosted, post, setPageMetaOverride]);

  useEffect(() => {
    let mounted = true;
    const resolveBrandTimezone = async () => {
      const brandId = post?.brand?.id;
      if (!brandId) return;
      try {
        const tz = await getBrandTimezone(brandId);
        if (mounted && tz) setBrandTimezone(tz);
      } catch {
        if (mounted) setBrandTimezone(timezone);
      }
    };
    void resolveBrandTimezone();
    return () => {
      mounted = false;
    };
  }, [getBrandTimezone, post?.brand?.id, timezone]);

  const publicationsQuery = useQuery<{ success: boolean; data: Array<any> }>({
    queryKey: ['v2-publications', postId],
    queryFn: async () => analytics.getPublicationsByContent(resolvedPostId),
    enabled: Boolean(postId) && post?.status === 'published',
    staleTime: 30000,
  });

  const selectedPublicationId = useMemo(() => {
    const pubs = publicationsQuery.data?.data || [];
    if (!pubs.length) return undefined;
    const preferred = pubs.find((p: any) => p.platform === 'instagram');
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
    if (!latest) return undefined;
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

  const { data: commentsData } = useQuery<{
    comments: { username: string; text: string }[];
  }>({
    queryKey: ['post-comments', postId],
    queryFn: async () => (await contentApi.getPostComments(resolvedPostId)).data,
    enabled: Boolean(postId) && post?.status === 'published',
    staleTime: 60000,
  });

  const refreshPublication = async (successMessage: string) => {
    if (!selectedPublicationId) return;
    try {
      await analytics.refreshPublication(selectedPublicationId);
      toast.success(successMessage);
    } catch {
      toast.error('Unable to enqueue refresh');
    }
  };

  const publishNowMutation = useMutation({
    mutationFn: async () => {
      if (isMultiDestinationGroup && contentGroupId) {
        return contentApi.publishContentGroupNow(contentGroupId);
      }
      return contentApi.publishNow(resolvedPostId);
    },
    onSuccess: () => {
      toast.success(
        isMultiDestinationGroup ? 'Publishing started for all destinations' : 'Publishing started'
      );
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      if (contentGroupId)
        queryClient.invalidateQueries({ queryKey: ['content-group', contentGroupId] });
    },
    onError: () => toast.error('Failed to publish post'),
  });

  const deletePostMutation = useMutation({
    mutationFn: async () => {
      if (isMultiDestinationGroup && contentGroupId) {
        return contentApi.deleteContentGroup(contentGroupId);
      }
      return contentApi.deletePost(resolvedPostId);
    },
    onSuccess: () => {
      toast.success('Post deleted successfully');
      navigate(-1);
    },
    onError: () => toast.error('Failed to delete post'),
  });

  const publicationButtons = useMemo(() => {
    const platformLabel = (platform: string) => {
      const normalized = String(platform || '').toLowerCase();
      const labels: Record<string, string> = {
        instagram: 'Instagram',
        tiktok: 'TikTok',
        linkedin: 'LinkedIn',
        youtube: 'YouTube',
        facebook: 'Facebook',
        threads: 'Threads',
        x: 'X',
      };
      if (labels[normalized]) return labels[normalized];
      if (!platform) return 'Link';
      return platform.charAt(0).toUpperCase() + platform.slice(1);
    };

    const pubs = (publicationsQuery.data?.data || []) as any[];
    const links: PublicationLink[] = pubs
      .filter((pub) => Boolean(pub?.permalink))
      .map((pub: any) => ({
        key: String(pub.id || `${pub.platform || 'platform'}:${pub.permalink}`),
        platform: String(pub.platform || ''),
        permalink: String(pub.permalink || ''),
      }));

    if (post?.status === 'published' && post.instagramPermalink) {
      links.push({
        key: 'post:instagramPermalink',
        platform: 'instagram',
        permalink: String(post.instagramPermalink),
      });
    }

    const seen = new Set<string>();
    const deduped = links.filter((link) => {
      const permalink = String(link.permalink || '').trim();
      if (!permalink) return false;
      if (seen.has(permalink)) return false;
      seen.add(permalink);
      return true;
    });

    deduped.sort((a, b) => {
      const aIsIg = a.platform === 'instagram';
      const bIsIg = b.platform === 'instagram';
      if (aIsIg === bIsIg) return 0;
      return aIsIg ? -1 : 1;
    });

    return deduped.map((link) => (
      <Button
        key={link.key}
        variant="outline"
        size="sm"
        onClick={() => window.open(link.permalink, '_blank', 'noopener,noreferrer')}
        className="w-full justify-start gap-2"
      >
        {link.platform === 'instagram' ? (
          <Instagram className="h-4 w-4" />
        ) : (
          <ExternalLink className="h-4 w-4" />
        )}
        <span className="truncate">View on {platformLabel(link.platform)}</span>
      </Button>
    ));
  }, [publicationsQuery.data?.data, post?.instagramPermalink, post?.status]);

  if (isCreate) {
    return <PostEditor layout="page" showHeader={false} />;
  }

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
                comments={commentsData?.comments || []}
                selectedPublicationId={selectedPublicationId}
                onRefreshMetrics={() => {
                  void refreshPublication('Metrics refresh enqueued');
                }}
                onRefreshComments={() => {
                  void refreshPublication('Comments refresh enqueued');
                }}
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
