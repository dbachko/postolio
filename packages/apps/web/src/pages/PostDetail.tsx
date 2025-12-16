import { memo, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { content as contentApi, analytics } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PostSidebar } from '@/right-sidebar/PostSidebar';
import { PostStatusBadge } from '@/components/PostStatusBadge';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatInUserTimezone } from '@/lib/timezone';
import { format } from 'date-fns';
import {
  AlertCircle,
  CheckCircle,
  ExternalLink,
  Instagram,
  Megaphone,
  RefreshCw,
  Trash2,
} from 'lucide-react';
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
import { usePostDetail } from '@/hooks/usePostDetail';
import { usePageMeta } from '@/contexts/PageMetaContext';

interface PostInsights {
  metrics: {
    reach: number;
    engagement: number;
    saves: number;
    shares: number;
    comments_count: number;
    likes_count: number;
  };
  lastUpdated: string;
}

const MetricsGrid = memo(({ insights }: { insights: PostInsights }) => (
  <div className="grid grid-cols-2 gap-3">
    <div className="bg-muted rounded-lg p-3">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">Likes</span>
      </div>
      <p className="mt-1 text-lg font-bold">{insights.metrics.likes_count.toLocaleString()}</p>
    </div>

    <div className="bg-muted rounded-lg p-3">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">Comments</span>
      </div>
      <p className="mt-1 text-lg font-bold">{insights.metrics.comments_count.toLocaleString()}</p>
    </div>

    <div className="bg-muted rounded-lg p-3">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">Reach</span>
      </div>
      <p className="mt-1 text-lg font-bold">{insights.metrics.reach.toLocaleString()}</p>
    </div>

    <div className="bg-muted rounded-lg p-3">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">Shares</span>
      </div>
      <p className="mt-1 text-lg font-bold">{insights.metrics.shares.toLocaleString()}</p>
    </div>
  </div>
));

export default function PostDetail() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { timezone, getBrandTimezone } = useTimezone();
  const { setOverride: setPageMetaOverride } = usePageMeta();

  const { data: post, isLoading } = usePostDetail(postId);
  const [brandTimezone, setBrandTimezone] = useState<string>(timezone);

  const isPosted = Boolean(post?.postedAt) || post?.status === 'published';

  useEffect(() => {
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
  }, [isPosted, post, setPageMetaOverride]);

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
    queryFn: async () => analytics.getPublicationsByContent(postId!),
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
    queryFn: async () => (await contentApi.getPostComments(postId!)).data,
    enabled: Boolean(postId) && post?.status === 'published',
    staleTime: 60000,
  });

  const publishNowMutation = useMutation({
    mutationFn: async () => contentApi.publishPost(postId!),
    onSuccess: () => {
      toast.success('Post published successfully');
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
    },
    onError: () => toast.error('Failed to publish post'),
  });

  const deletePostMutation = useMutation({
    mutationFn: async () => contentApi.deletePost(postId!),
    onSuccess: () => {
      toast.success('Post deleted successfully');
      navigate(-1);
    },
    onError: () => toast.error('Failed to delete post'),
  });

  const publicationButtons = useMemo(() => {
    const pubs = (publicationsQuery.data?.data || []) as any[];
    return pubs
      .filter((pub) => Boolean(pub?.permalink))
      .map((pub: any) => {
        return (
          <Button
            key={pub.id}
            variant="outline"
            size="sm"
            onClick={() => window.open(pub.permalink, '_blank')}
            className="w-full justify-start gap-2"
          >
            {pub.platform === 'instagram' ? (
              <Instagram className="h-4 w-4" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            <span className="truncate">View on {pub.platform}</span>
          </Button>
        );
      });
  }, [publicationsQuery.data?.data]);

  if (!postId) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
      <div className="lg:col-span-2">
        <PostSidebar id={postId} layout="page" showHeader={false} />
      </div>

      <div className="space-y-4 lg:space-y-6">
        {isLoading || !post ? (
          <Card className="p-4 md:p-6">
            <div className="text-muted-foreground text-sm">Loading…</div>
          </Card>
        ) : (
          <>
            <Card className="p-4 md:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold md:text-lg">
                    {isPosted ? 'Post Details' : 'Post Editor'}
                  </h3>
                  <div className="text-muted-foreground mt-1 text-xs">
                    Created {format(new Date(post.createdAt || Date.now()), 'MMM d, yyyy')}
                  </div>
                </div>
                <PostStatusBadge
                  status={post.status as any}
                  generationParams={post.generationParams as any}
                  schedulingError={post.schedulingError || null}
                  scheduledAt={post.scheduledAt || undefined}
                  className="shrink-0"
                />
              </div>

              {post.status === 'failed' && post.schedulingError ? (
                <Alert variant="destructive" className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{post.schedulingError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="mt-4 space-y-2">
                {post.status === 'published' && post.instagramPermalink ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start gap-2"
                    onClick={() => window.open(post.instagramPermalink!, '_blank')}
                  >
                    <Instagram className="h-4 w-4" />
                    View on Instagram
                  </Button>
                ) : null}
                {publicationButtons.length ? (
                  <div className="space-y-2">{publicationButtons}</div>
                ) : null}
              </div>
            </Card>

            <Card className="p-4 md:p-6">
              <h3 className="mb-3 flex items-center gap-2 text-base font-semibold md:mb-4 md:text-lg">
                Information
              </h3>
              <div className="space-y-2 text-xs md:space-y-3 md:text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Brand</span>
                  <span className="font-medium">{post.brand?.name || '—'}</span>
                </div>

                {post.campaign?.id ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Megaphone className="h-3.5 w-3.5" />
                      Campaign
                    </span>
                    <Link
                      to={`/campaigns/${post.campaign.id}`}
                      className="text-foreground font-medium hover:underline"
                      title={`View campaign: ${post.campaign.name}`}
                    >
                      {post.campaign.name}
                    </Link>
                  </div>
                ) : null}

                {post.scheduledAt ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Scheduled</span>
                    <span className="font-medium">
                      {formatInUserTimezone(post.scheduledAt, 'MMM d, h:mm a', brandTimezone)}
                    </span>
                  </div>
                ) : null}

                {post.postedAt ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Published</span>
                    <span className="font-medium">
                      {formatInUserTimezone(post.postedAt, 'MMM d, h:mm a', brandTimezone)}
                    </span>
                  </div>
                ) : null}

                {brandTimezone ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Timezone</span>
                    <span className="font-medium">{brandTimezone}</span>
                  </div>
                ) : null}
              </div>
            </Card>

            {post.status === 'published' ? (
              <Card className="p-4 md:p-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-semibold md:text-lg">Performance</h3>
                  {selectedPublicationId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await analytics.refreshPublication(selectedPublicationId);
                          toast.success('Refresh enqueued');
                        } catch (e: any) {
                          const status = e?.status;
                          const next = e?.data?.nextRefreshAllowed;
                          if (status === 429) {
                            toast.error(
                              next
                                ? `Refresh throttled. Try after ${new Date(next).toLocaleTimeString()}`
                                : 'Refresh throttled. Try later.'
                            );
                          } else {
                            toast.error('Refresh throttled or failed');
                          }
                        }
                      }}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" /> Refresh
                    </Button>
                  ) : null}
                </div>

                <Tabs defaultValue="metrics" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="metrics">Metrics</TabsTrigger>
                    <TabsTrigger value="comments">Comments</TabsTrigger>
                  </TabsList>

                  <TabsContent value="metrics" className="mt-4">
                    <div className="text-muted-foreground mb-3 text-xs">
                      {insights
                        ? `Last updated: ${new Date(insights.lastUpdated).toLocaleString()}`
                        : 'No metrics yet'}
                    </div>
                    {insights ? (
                      <MetricsGrid insights={insights} />
                    ) : (
                      <p className="text-muted-foreground py-6 text-center text-sm">
                        Metrics may take a few minutes to appear after publishing. Use Refresh to
                        request an update.
                      </p>
                    )}
                  </TabsContent>

                  <TabsContent value="comments" className="mt-4">
                    {commentsData?.comments && commentsData.comments.length > 0 ? (
                      <div className="max-h-[360px] space-y-3 overflow-y-auto">
                        {commentsData.comments.map(
                          (comment: { username: string; text: string }, index: number) => (
                            <div
                              key={index}
                              className="bg-muted flex items-start gap-3 rounded-lg p-3"
                            >
                              <div className="mt-0.5">
                                <Avatar name={comment.username} size="sm" />
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium">{comment.username}</p>
                                <p className="text-foreground mt-1 text-sm">{comment.text}</p>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    ) : insights && insights.metrics.comments_count > 0 && selectedPublicationId ? (
                      <div className="text-muted-foreground flex flex-col items-center gap-3 py-6 text-center text-sm">
                        <p>
                          {insights.metrics.comments_count.toLocaleString()} comment
                          {insights.metrics.comments_count === 1 ? '' : 's'} on Instagram. They may
                          not be synced yet.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            try {
                              await analytics.refreshPublication(selectedPublicationId);
                              toast.success('Comments refresh enqueued');
                            } catch {
                              toast.error('Unable to enqueue refresh');
                            }
                          }}
                        >
                          <RefreshCw className="mr-2 h-4 w-4" /> Refresh Comments
                        </Button>
                      </div>
                    ) : (
                      <p className="text-muted-foreground py-6 text-center text-sm">
                        No comments yet
                      </p>
                    )}
                  </TabsContent>
                </Tabs>
              </Card>
            ) : null}

            <Card className="p-4 md:p-6">
              <h3 className="mb-3 text-base font-semibold md:mb-4 md:text-lg">Actions</h3>
              <div className="space-y-2">
                {post.status === 'scheduled' ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        className="w-full"
                        variant="outline"
                        disabled={publishNowMutation.isPending}
                      >
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Publish Now
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Publish this post now?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will publish immediately and may override the scheduled time.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={publishNowMutation.isPending}>
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => publishNowMutation.mutate()}
                          disabled={publishNowMutation.isPending}
                        >
                          Publish Now
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      className="w-full"
                      variant="destructive"
                      disabled={deletePostMutation.isPending}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Post
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this post?</AlertDialogTitle>
                      <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={deletePostMutation.isPending}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deletePostMutation.mutate()}
                        disabled={deletePostMutation.isPending}
                      >
                        Delete Post
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
