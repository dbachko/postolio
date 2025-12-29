import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CalendarClock, CheckCircle2, MessageSquare, Megaphone } from 'lucide-react';
import { brand as brandApi, campaign as campaignApi, content as contentApi } from '@/lib/api';
import type { Campaign, Content } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import { formatInUserTimezone } from '@/lib/timezone';
import { useInstagramBestTime, useRefreshInstagramBestTime } from '@/hooks/useBestTime';
import { getPostImageOrPlaceholder } from '@/lib/placeholders';
import { getMediaBadgeType } from '@/utils/media-type';
import { MediaTypeBadge } from '@/components/MediaTypeBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { DashboardPostCard } from '@/components/dashboard/DashboardPostCard';

export function Dashboard() {
  const { brands, selectedBrand, setBrands, initializeSelectedBrand } = useBrandStore();
  const brandId = selectedBrand?.id;
  const { openSidebar } = useRightSidebarRouter();

  const { data: brandsData, isLoading: brandsLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: () => brandApi.getBrands(),
  });

  useEffect(() => {
    if (brandsData?.brands) {
      setBrands(brandsData.brands);
      initializeSelectedBrand(brandsData.brands);
    }
  }, [brandsData, setBrands, initializeSelectedBrand]);

  const instagramStatusQuery = useQuery({
    queryKey: ['social-status', brandId, 'instagram'],
    queryFn: () => brandApi.getSocialConnectionStatus(brandId!, 'instagram'),
    enabled: Boolean(brandId),
    staleTime: 30_000,
  });

  const contentHistoryQuery = useQuery({
    queryKey: ['content-history', brandId],
    queryFn: () => contentApi.getContentHistory(brandId!),
    enabled: Boolean(brandId),
    staleTime: 10_000,
  });

  const draftsQuery = useQuery({
    queryKey: ['drafts', brandId],
    queryFn: () => contentApi.getDrafts(brandId!),
    enabled: Boolean(brandId),
    staleTime: 10_000,
  });

  const campaignsQuery = useQuery({
    queryKey: ['campaigns', brandId],
    queryFn: () => campaignApi.listCampaigns(brandId),
    enabled: Boolean(brandId),
    staleTime: 15_000,
  });

  const inboxItemsQuery = useQuery({
    queryKey: ['inbox-items', brandId, 'dashboard'],
    queryFn: () => brandApi.getInboxItems(brandId!, { view: 'to_review', limit: 50 }),
    enabled: Boolean(brandId),
    staleTime: 10_000,
  });

  const {
    data: bestTimeData,
    isLoading: bestTimeLoading,
    isError: bestTimeError,
  } = useInstagramBestTime(brandId);
  const refreshBestTime = useRefreshInstagramBestTime(brandId);

  const contentHistory = useMemo(
    () => ((contentHistoryQuery.data as any)?.content || []) as Content[],
    [contentHistoryQuery.data]
  );
  const failedPosts = useMemo(
    () => contentHistory.filter((post) => post.status === 'failed'),
    [contentHistory]
  );
  const failedPreviewPosts = useMemo(() => failedPosts.slice(0, 3), [failedPosts]);
  const failedPreviewAssetIds = useMemo(
    () => failedPreviewPosts.map((post) => post.primaryAssetId),
    [failedPreviewPosts]
  );
  const failedPreviewAssetsQuery = useAssetsByIds(failedPreviewAssetIds);
  const scheduledPosts = useMemo(() => {
    const now = Date.now();
    return contentHistory
      .filter(
        (post) =>
          post.status === 'scheduled' &&
          post.scheduledAt &&
          new Date(post.scheduledAt).getTime() > now
      )
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
  }, [contentHistory]);

  const upcomingScheduledPosts = useMemo(() => scheduledPosts.slice(0, 3), [scheduledPosts]);
  const upcomingAssetIds = useMemo(
    () => upcomingScheduledPosts.map((post) => post.primaryAssetId),
    [upcomingScheduledPosts]
  );
  const upcomingAssetsQuery = useAssetsByIds(upcomingAssetIds);

  const drafts = useMemo(
    () => ((draftsQuery.data as any)?.content || []) as Content[],
    [draftsQuery.data]
  );
  const unscheduledDrafts = useMemo(() => drafts.filter((d) => !d.scheduledAt), [drafts]);
  const draftPreviewDrafts = useMemo(() => unscheduledDrafts.slice(0, 3), [unscheduledDrafts]);
  const draftPreviewAssetIds = useMemo(
    () => draftPreviewDrafts.map((draft) => draft.primaryAssetId),
    [draftPreviewDrafts]
  );
  const draftPreviewAssetsQuery = useAssetsByIds(draftPreviewAssetIds);

  const campaigns = useMemo(
    () => ((campaignsQuery.data as any)?.campaigns || []) as Campaign[],
    [campaignsQuery.data]
  );
  const activeCampaigns = useMemo(
    () => campaigns.filter((campaign) => campaign.status === 'active'),
    [campaigns]
  );

  const inboxItems = useMemo(() => {
    const data = inboxItemsQuery.data as any;
    const items = (data?.items || []) as Array<any>;
    return items;
  }, [inboxItemsQuery.data]);

  const inboxSummary = useMemo(() => {
    let commentThreads = 0;
    let dmConversations = 0;
    for (const item of inboxItems) {
      if (item?.type === 'comment_thread') commentThreads += 1;
      if (item?.type === 'dm_conversation') dmConversations += 1;
    }
    return { total: inboxItems.length, commentThreads, dmConversations };
  }, [inboxItems]);

  const needsAttentionCount = useMemo(() => {
    const igConnected =
      instagramStatusQuery.data && typeof instagramStatusQuery.data === 'object'
        ? Boolean((instagramStatusQuery.data as any).connected)
        : true;
    const connectionIssue = instagramStatusQuery.isSuccess && !igConnected ? 1 : 0;
    return failedPosts.length + connectionIssue;
  }, [failedPosts.length, instagramStatusQuery.data, instagramStatusQuery.isSuccess]);

  if (brandsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="border-foreground h-8 w-8 animate-spin rounded-full border-b-2"></div>
      </div>
    );
  }

  const availableBrands = ((brandsData as any)?.brands || brands) as unknown[];

  if (availableBrands.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-16 text-center">
        <div className="space-y-2">
          <h2 className="text-foreground text-xl font-semibold">Welcome to Postolio</h2>
          <p className="text-muted-foreground text-sm">
            Create your first brand to start campaigns, plan content, and track performance.
          </p>
        </div>
        <Button size="lg" asChild>
          <Link to="/brands">Create Your First Brand</Link>
        </Button>
      </div>
    );
  }

  if (!selectedBrand) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-14" />
                <Skeleton className="mt-3 h-4 w-40" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const brandTimezone = selectedBrand.postingTimezone || undefined;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Needs Attention</CardTitle>
            <AlertCircle className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{needsAttentionCount}</div>
            <p className="text-muted-foreground text-xs">Failed posts or connection issues.</p>
            <div className="mt-3">
              <Button asChild size="sm" variant="link" className="h-auto p-0">
                <a href="#needs-attention">Review issues →</a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inbox to review</CardTitle>
            <MessageSquare className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inboxSummary.total}</div>
            <p className="text-muted-foreground text-xs">
              {inboxSummary.commentThreads} comment thread
              {inboxSummary.commentThreads === 1 ? '' : 's'} • {inboxSummary.dmConversations} DM
              {inboxSummary.dmConversations === 1 ? '' : 's'}
            </p>
            <div className="mt-3">
              <Button asChild size="sm" variant="link" className="h-auto p-0">
                <Link to="/inbox">Open inbox →</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
            <Megaphone className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCampaigns.length}</div>
            <p className="text-muted-foreground text-xs">Keep your schedule consistent.</p>
            <div className="mt-3">
              <Button asChild size="sm" variant="link" className="h-auto p-0">
                <Link to="/campaigns">View campaigns →</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card id="needs-attention" className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>Needs attention</CardTitle>
              <p className="text-muted-foreground text-sm">
                Fix these first to avoid missed posts and lost engagement.
              </p>
            </div>
            <Button variant="outline" asChild size="sm">
              <Link to="/notifications">View alerts</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {instagramStatusQuery.isLoading || contentHistoryQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                    <Skeleton className="h-8 w-20" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {instagramStatusQuery.isSuccess &&
                (instagramStatusQuery.data as any)?.connected === false ? (
                  <Alert variant="warning">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    <div>
                      <AlertTitle>Instagram disconnected</AlertTitle>
                      <AlertDescription>
                        Reconnect your account to publish and sync data.
                        <div className="mt-2">
                          <Button asChild size="sm">
                            <Link to="/brands">Reconnect</Link>
                          </Button>
                        </div>
                      </AlertDescription>
                    </div>
                  </Alert>
                ) : null}

                {failedPosts.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">Failed posts</h3>
                        <Badge variant="destructive">{failedPosts.length}</Badge>
                      </div>
                      <Button asChild variant="ghost" size="sm" className="gap-1">
                        <Link to="/content">
                          View calendar <span aria-hidden="true">→</span>
                        </Link>
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {failedPreviewPosts.map((post) => {
                        const primaryAsset = post.primaryAssetId
                          ? (failedPreviewAssetsQuery.data?.[post.primaryAssetId] ?? null)
                          : null;
                        const previewThumbnail =
                          primaryAsset?.fileType === 'video'
                            ? {
                                kind: 'video' as const,
                                src: primaryAsset.url,
                                posterSrc: primaryAsset.thumbnailUrl || null,
                              }
                            : {
                                kind: 'image' as const,
                                src: getPostImageOrPlaceholder(
                                  primaryAsset?.thumbnailUrl || primaryAsset?.url || null
                                ),
                              };
                        const mediaBadgeType = getMediaBadgeType({
                          contentType: post.contentType,
                          mediaAssets: post.mediaAssets,
                          mediaAssetCount: post.mediaAssetCount,
                          primaryAssetFileType: primaryAsset?.fileType ?? null,
                        });

                        return (
                          <DashboardPostCard
                            key={post.id}
                            thumbnail={previewThumbnail}
                            action={
                              <Button asChild size="sm" variant="outline">
                                <Link to={`/posts/${post.id}`}>Review</Link>
                              </Button>
                            }
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <MediaTypeBadge
                                type={mediaBadgeType}
                                className="pointer-events-none p-0.5"
                                iconClassName="h-3 w-3"
                              />
                              <span className="text-sm font-medium">
                                Last updated:{' '}
                                {formatInUserTimezone(
                                  post.updatedAt,
                                  'EEE, MMM d • h:mm a',
                                  brandTimezone
                                )}
                              </span>
                              {post.campaignName ? (
                                <Badge variant="secondary">{post.campaignName}</Badge>
                              ) : null}
                            </div>
                            <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">
                              {post.caption?.trim() ? post.caption.trim() : 'Untitled post'}
                            </p>
                          </DashboardPostCard>
                        );
                      })}
                      {failedPosts.length > 3 ? (
                        <p className="text-muted-foreground text-xs">
                          And {failedPosts.length - 3} more failed post
                          {failedPosts.length - 3 === 1 ? '' : 's'}.
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {needsAttentionCount === 0 ? (
                  <Alert variant="success">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    <div>
                      <AlertTitle>All clear</AlertTitle>
                      <AlertDescription>No failures or disconnects detected.</AlertDescription>
                    </div>
                  </Alert>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>Inbox</CardTitle>
              <p className="text-muted-foreground text-sm">Everything that needs your attention.</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/inbox">Open</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {inboxItemsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-9 w-9 rounded" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-3 w-5/6" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-5 w-10 rounded-full" />
                  </div>
                ))}
              </div>
            ) : inboxItems.length === 0 ? (
              <p className="text-muted-foreground text-sm">No items to review.</p>
            ) : (
              <div className="space-y-2">
                {inboxItems.slice(0, 5).map((item) => (
                  <div
                    key={item.type === 'comment_thread' ? item.publicationId : item.conversationId}
                    className="flex items-start justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        <span className="line-clamp-2">
                          {item.type === 'comment_thread'
                            ? item.caption?.trim()
                              ? item.caption.trim()
                              : 'Post'
                            : item.participantUsername
                              ? `@${item.participantUsername}`
                              : 'Direct message'}
                        </span>
                      </div>
                      {item.type === 'comment_thread' && item.postedAt ? (
                        <div className="text-muted-foreground mt-1 text-xs">
                          Posted {formatInUserTimezone(item.postedAt, 'MMM d', brandTimezone)}
                        </div>
                      ) : null}
                      {item.type === 'dm_conversation' && item.lastMessageAt ? (
                        <div className="text-muted-foreground mt-1 text-xs">
                          Last message{' '}
                          {formatInUserTimezone(item.lastMessageAt, 'MMM d', brandTimezone)}
                        </div>
                      ) : null}
                      {item.type === 'comment_thread' && item.previewText ? (
                        <div className="text-muted-foreground mt-1 line-clamp-1 text-xs">
                          {item.previewAuthorUsername ? `@${item.previewAuthorUsername}: ` : ''}
                          {item.previewText}
                        </div>
                      ) : null}
                      {item.type === 'dm_conversation' && item.lastMessageText ? (
                        <div className="text-muted-foreground mt-1 line-clamp-1 text-xs">
                          {item.lastMessageText}
                        </div>
                      ) : null}
                      {item.type === 'comment_thread' && item.permalink ? (
                        <a
                          className="text-muted-foreground hover:text-foreground mt-1 inline-flex items-center gap-1 text-xs underline"
                          href={item.permalink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View on {String(item.platform || 'platform')}{' '}
                          <span aria-hidden="true">↗</span>
                        </a>
                      ) : null}
                    </div>
                    {item.type === 'comment_thread' ? (
                      <Badge variant={item.newCount > 0 ? 'info' : 'secondary'}>
                        {item.newCount}
                      </Badge>
                    ) : (
                      <Badge variant="info">DM</Badge>
                    )}
                  </div>
                ))}
                {inboxItems.length > 5 ? (
                  <p className="text-muted-foreground text-xs">
                    And {inboxItems.length - 5} more item{inboxItems.length - 5 === 1 ? '' : 's'}.
                  </p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>Up next</CardTitle>
              <p className="text-muted-foreground text-sm">Your next scheduled posts.</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/content">
                <CalendarClock className="mr-2 h-4 w-4" aria-hidden="true" />
                Calendar
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {contentHistoryQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-md" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </div>
                    <Skeleton className="h-8 w-16" />
                  </div>
                ))}
              </div>
            ) : upcomingScheduledPosts.length === 0 ? (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  Nothing scheduled yet. Start a campaign or schedule a post to stay consistent.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <Link to="/campaigns/create">Start Campaign</Link>
                  </Button>
                  <Button variant="outline" onClick={() => openSidebar('post-create')}>
                    Create Post
                  </Button>
                  <Button asChild variant="ghost">
                    <Link to="/drafts">View Drafts</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingScheduledPosts.map((post) => {
                  const primaryAsset = post.primaryAssetId
                    ? (upcomingAssetsQuery.data?.[post.primaryAssetId] ?? null)
                    : null;
                  const previewThumbnail =
                    primaryAsset?.fileType === 'video'
                      ? {
                          kind: 'video' as const,
                          src: primaryAsset.url,
                          posterSrc: primaryAsset.thumbnailUrl || null,
                        }
                      : {
                          kind: 'image' as const,
                          src: getPostImageOrPlaceholder(
                            primaryAsset?.thumbnailUrl || primaryAsset?.url || null
                          ),
                        };
                  const mediaBadgeType = getMediaBadgeType({
                    contentType: post.contentType,
                    mediaAssets: post.mediaAssets,
                    mediaAssetCount: post.mediaAssetCount,
                    primaryAssetFileType: primaryAsset?.fileType ?? null,
                  });

                  return (
                    <DashboardPostCard
                      key={post.id}
                      thumbnail={previewThumbnail}
                      action={
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/posts/${post.id}`}>Open</Link>
                        </Button>
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <MediaTypeBadge
                          type={mediaBadgeType}
                          className="pointer-events-none p-0.5"
                          iconClassName="h-3 w-3"
                        />
                        <span className="text-sm font-medium">
                          Scheduled:{' '}
                          {formatInUserTimezone(
                            post.scheduledAt!,
                            'EEE, MMM d • h:mm a',
                            brandTimezone
                          )}
                        </span>
                        {post.campaignName ? (
                          <Badge variant="secondary">{post.campaignName}</Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">
                        {post.caption?.trim() ? post.caption.trim() : 'Untitled post'}
                      </p>
                    </DashboardPostCard>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>Campaigns</CardTitle>
              <p className="text-muted-foreground text-sm">Launch content in minutes.</p>
            </div>
            <Button asChild size="sm">
              <Link to="/campaigns/create">Start</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {campaignsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-2 rounded-md border p-3">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : campaigns.length === 0 ? (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  No campaigns yet. Campaigns keep you consistent with less effort.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link to="/campaigns/create">Create your first campaign</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {campaigns
                  .filter((c) => ['active', 'preview', 'paused'].includes(c.status))
                  .slice(0, 3)
                  .map((campaign) => (
                    <Link
                      key={campaign.id}
                      to={`/campaigns/${campaign.id}`}
                      className="hover:bg-accent block rounded-md border p-3 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium">{campaign.name}</span>
                            <Badge
                              variant={
                                campaign.status === 'active'
                                  ? 'success'
                                  : campaign.status === 'paused'
                                    ? 'warning'
                                    : 'secondary'
                              }
                            >
                              {campaign.status}
                            </Badge>
                          </div>
                          <div className="text-muted-foreground mt-1 text-xs">
                            {typeof campaign.scheduledCount === 'number'
                              ? `${campaign.scheduledCount} scheduled`
                              : '—'}{' '}
                            •{' '}
                            {typeof campaign.publishedCount === 'number'
                              ? `${campaign.publishedCount} published`
                              : '—'}
                          </div>
                        </div>
                        <span className="text-muted-foreground mt-0.5 text-sm" aria-hidden="true">
                          →
                        </span>
                      </div>
                    </Link>
                  ))}
                <Button asChild variant="ghost" size="sm" className="mt-1 w-full justify-between">
                  <Link to="/campaigns">
                    View all campaigns <span aria-hidden="true">→</span>
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>Drafts</CardTitle>
              <p className="text-muted-foreground text-sm">Quick wins you can schedule anytime.</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/drafts">Open drafts</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {draftsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-md" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </div>
                    <Skeleton className="h-8 w-16" />
                  </div>
                ))}
              </div>
            ) : drafts.length === 0 ? (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">No drafts yet.</p>
                <Button onClick={() => openSidebar('post-create')}>Create your first post</Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant={unscheduledDrafts.length > 0 ? 'info' : 'secondary'}>
                    {unscheduledDrafts.length} unscheduled
                  </Badge>
                  <Badge variant="secondary">{drafts.length} total</Badge>
                </div>
                <div className="space-y-2">
                  {draftPreviewDrafts.map((draft) => {
                    const primaryAsset = draft.primaryAssetId
                      ? (draftPreviewAssetsQuery.data?.[draft.primaryAssetId] ?? null)
                      : null;
                    const previewThumbnail =
                      primaryAsset?.fileType === 'video'
                        ? {
                            kind: 'video' as const,
                            src: primaryAsset.url,
                            posterSrc: primaryAsset.thumbnailUrl || null,
                          }
                        : {
                            kind: 'image' as const,
                            src: getPostImageOrPlaceholder(
                              primaryAsset?.thumbnailUrl || primaryAsset?.url || null
                            ),
                          };
                    const mediaBadgeType = getMediaBadgeType({
                      contentType: draft.contentType,
                      mediaAssets: draft.mediaAssets,
                      mediaAssetCount: draft.mediaAssetCount,
                      primaryAssetFileType: primaryAsset?.fileType ?? null,
                    });

                    return (
                      <DashboardPostCard
                        key={draft.id}
                        thumbnail={previewThumbnail}
                        action={
                          <Button asChild size="sm" variant="outline">
                            <Link to={`/posts/${draft.id}`}>Open</Link>
                          </Button>
                        }
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <MediaTypeBadge
                            type={mediaBadgeType}
                            className="pointer-events-none p-0.5"
                            iconClassName="h-3 w-3"
                          />
                          <span className="text-sm font-medium">
                            Last updated:{' '}
                            {formatInUserTimezone(
                              draft.updatedAt,
                              'EEE, MMM d • h:mm a',
                              brandTimezone
                            )}
                          </span>
                          {draft.campaignName ? (
                            <Badge variant="secondary">{draft.campaignName}</Badge>
                          ) : null}
                        </div>
                        <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">
                          {draft.caption?.trim() ? draft.caption.trim() : 'Untitled draft'}
                        </p>
                      </DashboardPostCard>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>Best time to post</CardTitle>
              <p className="text-muted-foreground text-sm">AI-powered timing suggestions.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refreshBestTime.mutate()}
              disabled={refreshBestTime.isPending}
            >
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {bestTimeLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-2 rounded-md border p-3">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                ))}
              </div>
            ) : bestTimeError || !bestTimeData ? (
              <p className="text-muted-foreground text-sm">
                Recommendations are unavailable right now.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {bestTimeData.source || 'unknown'} •{' '}
                    {Math.round((bestTimeData.confidence || 0) * 100)}%
                  </Badge>
                </div>
                {bestTimeData.topWindows?.slice(0, 3).map((win) => (
                  <div key={win.startUTC} className="space-y-1 rounded-md border p-3">
                    <div className="text-sm font-medium">
                      {formatInUserTimezone(win.startUTC, 'EEE • h:mm a', brandTimezone)}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {win.explanation || 'Recommended window'} • {Math.round(win.score * 100)}{' '}
                      score
                    </div>
                  </div>
                ))}
                <Button asChild variant="ghost" size="sm" className="w-full justify-between">
                  <Link to="/analytics">
                    Improve performance <span aria-hidden="true">→</span>
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
