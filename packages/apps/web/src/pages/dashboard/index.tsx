import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { brand as brandApi, campaign as campaignApi, content as contentApi } from '@/lib/api';
import type { Campaign, Content } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import { useInstagramBestTime, useRefreshInstagramBestTime } from '@/hooks/useBestTime';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import type { CommentsInboxItem } from './types';
import { BestTimeCard } from './components/best-time-card';
import { CampaignsCard } from './components/campaigns-card';
import { CommentsCard } from './components/comments-card';
import { DashboardKpis } from './components/dashboard-kpis';
import { DraftsCard } from './components/drafts-card';
import { NeedsAttentionCard } from './components/needs-attention-card';
import { UpNextCard } from './components/up-next-card';

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

  const commentsInboxQuery = useQuery({
    queryKey: ['inbox-items', brandId, 'comments'],
    queryFn: () =>
      brandApi.getInboxItems(brandId!, {
        channels: ['comments'],
        view: 'to_review',
        limit: 200,
      }),
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

  const commentsInboxItems = useMemo(() => {
    const items = ((commentsInboxQuery.data as any)?.items || []) as Array<any>;

    const threads = items
      .filter((item) => item?.type === 'comment_thread')
      .map((item) => ({
        postId: item.postId,
        caption: item.caption ?? null,
        permalink: item.permalink ?? null,
        postedAt: item.postedAt ?? null,
        totalComments: Number(item.totalComments || 0),
        resolvedCount: Number(item.resolvedCount || 0),
        newCount: Number(item.newCount || 0),
      })) satisfies CommentsInboxItem[];

    return threads.sort((a, b) => (b.newCount || 0) - (a.newCount || 0));
  }, [commentsInboxQuery.data]);

  const newCommentsCount = useMemo(
    () => commentsInboxItems.reduce((sum, item) => sum + (item.newCount || 0), 0),
    [commentsInboxItems]
  );

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
        <div className="border-foreground h-8 w-8 animate-spin rounded-full border-b-2" />
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
  const instagramDisconnected =
    instagramStatusQuery.isSuccess && (instagramStatusQuery.data as any)?.connected === false;

  return (
    <div className="space-y-6">
      <DashboardKpis
        needsAttentionCount={needsAttentionCount}
        newCommentsCount={newCommentsCount}
        commentsInboxPostsCount={commentsInboxItems.length}
        activeCampaignsCount={activeCampaigns.length}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <NeedsAttentionCard
          isLoading={instagramStatusQuery.isLoading || contentHistoryQuery.isLoading}
          instagramDisconnected={instagramDisconnected}
          failedPosts={failedPosts}
          failedPreviewPosts={failedPreviewPosts}
          failedPreviewAssets={failedPreviewAssetsQuery.data}
          needsAttentionCount={needsAttentionCount}
          brandTimezone={brandTimezone}
        />

        <CommentsCard
          isLoading={commentsInboxQuery.isLoading}
          items={commentsInboxItems}
          brandTimezone={brandTimezone}
        />

        <UpNextCard
          isLoading={contentHistoryQuery.isLoading}
          upcomingPosts={upcomingScheduledPosts}
          upcomingAssets={upcomingAssetsQuery.data}
          brandTimezone={brandTimezone}
          onCreatePost={() => openSidebar('post-create')}
        />

        <CampaignsCard isLoading={campaignsQuery.isLoading} campaigns={campaigns} />

        <DraftsCard
          isLoading={draftsQuery.isLoading}
          drafts={drafts}
          unscheduledDrafts={unscheduledDrafts}
          draftPreviewDrafts={draftPreviewDrafts}
          draftPreviewAssets={draftPreviewAssetsQuery.data}
          brandTimezone={brandTimezone}
          onCreatePost={() => openSidebar('post-create')}
        />

        <BestTimeCard
          bestTime={bestTimeData}
          isLoading={bestTimeLoading}
          isError={bestTimeError}
          onRefresh={() => refreshBestTime.mutate()}
          isRefreshing={refreshBestTime.isPending}
          brandTimezone={brandTimezone}
        />
      </div>
    </div>
  );
}
