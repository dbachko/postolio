import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { useInstagramBestTime, useRefreshInstagramBestTime } from '@/hooks/useBestTime';
import { brand as brandApi, content as contentApi } from '@/lib/api';
import { isInboxEnabled } from '@/lib/feature-flags';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useBrandStore, type BrandState } from '@/stores/brandStore';

import { BestTimeCard } from './components/best-time-card';
import { CommentsCard } from './components/comments-card';
import { DashboardKpis } from './components/dashboard-kpis';
import { DraftsCard } from './components/drafts-card';
import { NeedsAttentionCard } from './components/needs-attention-card';
import { ScheduleSetupReminderCard } from './components/schedule-setup-reminder-card';
import { UpNextCard } from './components/up-next-card';
import { useDashboardDerived } from './dashboard-derived';

type DashboardStoreState = {
  brands: BrandState['brands'];
  selectedBrand: BrandState['selectedBrand'];
  setBrands: BrandState['setBrands'];
  initializeSelectedBrand: BrandState['initializeSelectedBrand'];
  inboxEnabled: boolean;
};

function useDashboardStoreState(): DashboardStoreState {
  const { brands, selectedBrand, setBrands, initializeSelectedBrand } = useBrandStore();
  const user = useAuthStore((state) => state.user);

  return {
    brands,
    selectedBrand,
    setBrands,
    initializeSelectedBrand,
    inboxEnabled: isInboxEnabled(user),
  };
}

export function useDashboardQueries(brandId: string | undefined, inboxEnabled: boolean) {
  const brandsQuery = useQuery({ queryKey: ['brands'], queryFn: () => brandApi.getBrands() });
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
  const connectedAccountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandId],
    queryFn: () => brandApi.getConnectedAccounts(brandId!),
    enabled: Boolean(brandId),
    staleTime: 30_000,
  });
  const draftsQuery = useQuery({
    queryKey: ['drafts', brandId],
    queryFn: () => contentApi.getDrafts(brandId!),
    enabled: Boolean(brandId),
    staleTime: 10_000,
  });
  const commentsInboxQuery = useQuery({
    queryKey: ['inbox-items', brandId, 'comments'],
    queryFn: () =>
      brandApi.getInboxItems(brandId!, {
        channels: ['comments'],
        view: 'to_review',
        limit: 200,
      }),
    enabled: Boolean(brandId) && inboxEnabled,
    staleTime: 10_000,
  });

  return {
    brandsQuery,
    instagramStatusQuery,
    contentHistoryQuery,
    connectedAccountsQuery,
    draftsQuery,
    commentsInboxQuery,
  };
}

function EmptyBrandsState() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 text-center">
      <div className="space-y-2">
        <h2 className="text-foreground text-xl font-semibold">Welcome to Postolio</h2>
        <p className="text-muted-foreground text-sm">
          Create your first brand to start planning content and tracking performance.
        </p>
      </div>
      <Button size="lg" asChild>
        <Link to="/brands">Create Your First Brand</Link>
      </Button>
    </div>
  );
}

function NoBrandSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
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

function DashboardCardsGrid({
  inboxEnabled,
  queries,
  derived,
  brandTimezone,
  instagramDisconnected,
  bestTimeData,
  bestTimeLoading,
  bestTimeError,
  refreshBestTime,
  onCreatePost,
}: {
  inboxEnabled: boolean;
  queries: ReturnType<typeof useDashboardQueries>;
  derived: ReturnType<typeof useDashboardDerived>;
  brandTimezone: string | undefined;
  instagramDisconnected: boolean;
  bestTimeData: ReturnType<typeof useInstagramBestTime>['data'];
  bestTimeLoading: boolean;
  bestTimeError: boolean;
  refreshBestTime: ReturnType<typeof useRefreshInstagramBestTime>;
  onCreatePost: () => void;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-6',
        inboxEnabled ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2'
      )}
    >
      <NeedsAttentionCard
        isLoading={queries.instagramStatusQuery.isLoading || queries.contentHistoryQuery.isLoading}
        instagramDisconnected={instagramDisconnected}
        failedPosts={derived.failedPosts}
        failedPreviewPosts={derived.failedPreviewPosts}
        failedPreviewAssets={derived.failedPreviewAssets.data}
        needsAttentionCount={derived.needsAttentionCount}
        brandTimezone={brandTimezone}
      />
      {inboxEnabled ? (
        <CommentsCard
          isLoading={queries.commentsInboxQuery.isLoading}
          items={derived.commentsInboxItems}
          brandTimezone={brandTimezone}
        />
      ) : null}
      <UpNextCard
        isLoading={queries.contentHistoryQuery.isLoading}
        upcomingPosts={derived.upcomingPosts}
        upcomingAssets={derived.upcomingAssets.data}
        brandTimezone={brandTimezone}
        onCreatePost={onCreatePost}
      />
      <DraftsCard
        isLoading={queries.draftsQuery.isLoading}
        drafts={derived.drafts}
        unscheduledDrafts={derived.unscheduledDrafts}
        draftPreviewDrafts={derived.draftPreviewDrafts}
        draftPreviewAssets={derived.draftPreviewAssets.data}
        brandTimezone={brandTimezone}
        onCreatePost={onCreatePost}
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
  );
}

function DashboardMainContent({
  inboxEnabled,
  derived,
  queries,
  brandTimezone,
  instagramDisconnected,
  bestTimeData,
  bestTimeLoading,
  bestTimeError,
  refreshBestTime,
  onCreatePost,
}: {
  inboxEnabled: boolean;
  derived: ReturnType<typeof useDashboardDerived>;
  queries: ReturnType<typeof useDashboardQueries>;
  brandTimezone: string | undefined;
  instagramDisconnected: boolean;
  bestTimeData: ReturnType<typeof useInstagramBestTime>['data'];
  bestTimeLoading: boolean;
  bestTimeError: boolean;
  refreshBestTime: ReturnType<typeof useRefreshInstagramBestTime>;
  onCreatePost: () => void;
}) {
  return (
    <div className="space-y-6">
      <DashboardKpis
        needsAttentionCount={derived.needsAttentionCount}
        newCommentsCount={derived.newCommentsCount}
        commentsInboxPostsCount={derived.commentsInboxItems.length}
        inboxEnabled={inboxEnabled}
      />
      {derived.showScheduleSetupReminder ? <ScheduleSetupReminderCard /> : null}
      <DashboardCardsGrid
        inboxEnabled={inboxEnabled}
        queries={queries}
        derived={derived}
        brandTimezone={brandTimezone}
        instagramDisconnected={instagramDisconnected}
        bestTimeData={bestTimeData}
        bestTimeLoading={bestTimeLoading}
        bestTimeError={bestTimeError}
        refreshBestTime={refreshBestTime}
        onCreatePost={onCreatePost}
      />
    </div>
  );
}

export function Dashboard() {
  const { brands, selectedBrand, setBrands, initializeSelectedBrand, inboxEnabled } =
    useDashboardStoreState();
  const { openSidebar } = useRightSidebarRouter();
  const brandId = selectedBrand?.id;
  const queries = useDashboardQueries(brandId, inboxEnabled);
  const derived = useDashboardDerived(inboxEnabled, queries);
  const {
    data: bestTimeData,
    isLoading: bestTimeLoading,
    isError: bestTimeError,
  } = useInstagramBestTime(brandId);
  const refreshBestTime = useRefreshInstagramBestTime(brandId);
  const fetchedBrands = queries.brandsQuery.data?.brands;

  useEffect(() => {
    if (fetchedBrands) {
      setBrands(fetchedBrands);
      initializeSelectedBrand(fetchedBrands);
    }
  }, [fetchedBrands, initializeSelectedBrand, setBrands]);

  if (queries.brandsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="border-foreground h-8 w-8 animate-spin rounded-full border-b-2" />
      </div>
    );
  }

  const availableBrands = ((queries.brandsQuery.data as any)?.brands || brands) as unknown[];
  if (availableBrands.length === 0) {
    return <EmptyBrandsState />;
  }
  if (!selectedBrand) {
    return <NoBrandSkeleton />;
  }

  const brandTimezone = selectedBrand.postingTimezone || undefined;
  const instagramDisconnected =
    queries.instagramStatusQuery.isSuccess &&
    (queries.instagramStatusQuery.data as any)?.connected === false;

  return (
    <DashboardMainContent
      inboxEnabled={inboxEnabled}
      derived={derived}
      queries={queries}
      brandTimezone={brandTimezone}
      instagramDisconnected={instagramDisconnected}
      bestTimeData={bestTimeData}
      bestTimeLoading={bestTimeLoading}
      bestTimeError={bestTimeError}
      refreshBestTime={refreshBestTime}
      onCreatePost={() => openSidebar('post-create')}
    />
  );
}
