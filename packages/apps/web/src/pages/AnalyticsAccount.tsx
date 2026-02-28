import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { AccountSelectorTabs } from './analytics-account/components/account-selector-tabs';
import { AnalyticsAccountTabsContent } from './analytics-account/components/analytics-account-tabs-content';
import { useAnalyticsAccountPageState } from './analytics-account/use-analytics-account-page-state';

function AnalyticsSummaryLoadState({
  isLoading,
  isError,
}: {
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) {
    return (
      <Card className="mt-6">
        <CardContent className="py-8">
          <Skeleton className="h-8 w-48" />
        </CardContent>
      </Card>
    );
  }
  if (isError) {
    return (
      <Alert variant="destructive" className="mt-6">
        <AlertDescription>Failed to load analytics summary.</AlertDescription>
      </Alert>
    );
  }
  return null;
}

export default function AnalyticsAccount() {
  const state = useAnalyticsAccountPageState();

  if (!state.socialAccountId) {
    return (
      <Alert className="mt-6">
        <AlertDescription>Missing social account id.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div>
      <PageHeader title="Analytics" description="Performance metrics and insights" />
      <div className="mt-6">
        <AccountSelectorTabs
          socialAccountId={state.socialAccountId}
          accounts={state.accounts}
          period={state.period}
          refreshPending={state.refreshMutation.isPending}
          onAccountChange={(nextId) => {
            state.setPostsOffset(0);
            state.navigate(`/analytics/accounts/${nextId}?tab=overview`);
          }}
          onPeriodChange={(nextPeriod) => {
            state.setPeriod(nextPeriod);
            state.setPostsOffset(0);
          }}
          onRefresh={() => state.refreshMutation.mutate()}
        />
      </div>
      <AnalyticsSummaryLoadState
        isLoading={state.summaryQuery.isLoading}
        isError={state.summaryQuery.isError}
      />

      {state.summary ? (
        <AnalyticsAccountTabsContent
          tab={state.tab}
          platformTabs={state.platformTabs}
          overviewData={{
            summary: state.summary,
            healthScore: state.healthScore,
            healthLoading: state.healthQuery.isLoading,
            insights: state.insightsQuery.data,
            insightsLoading: state.insightsQuery.isLoading,
            recommendations: state.recommendationsQuery.data || undefined,
            recommendationsLoading: state.recommendationsQuery.isLoading,
            forecasts: state.forecastsQuery.data || undefined,
            forecastsLoading: state.forecastsQuery.isLoading,
            topPosts: state.topPosts,
            topPostsLoading: state.topPostsQuery.isLoading,
          }}
          postsData={{
            topPosts: state.topPosts,
            topPostsLoading: state.topPostsQuery.isLoading,
            posts: state.posts,
            postsLoading: state.postsQuery.isLoading,
            pagination: state.pagination,
            sortBy: state.postsSortBy,
            order: state.postsOrder,
          }}
          onTabChange={(nextTab) => {
            state.setSearchParams((prev) => {
              const params = new URLSearchParams(prev);
              params.set('tab', nextTab);
              return params;
            });
          }}
          onOverviewPostClick={(contentId) => state.navigate(`/posts/${contentId}`)}
          onPostsSortByChange={state.setPostsSortBy}
          onPostsOrderToggle={() =>
            state.setPostsOrder(state.postsOrder === 'asc' ? 'desc' : 'asc')
          }
          onPostsPageChange={state.setPostsOffset}
          onPostsPostClick={(contentId) => state.navigate(`/posts/${contentId}`)}
        />
      ) : null}
    </div>
  );
}
