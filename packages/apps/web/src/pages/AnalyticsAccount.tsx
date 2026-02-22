import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBrandStore } from '@/stores/brandStore';
import { AccountHealthScore } from '@/components/analytics-common/account-health-score';
import { ForecastCharts } from '@/components/analytics-common/forecast-charts';
import { InsightsPanel } from '@/components/analytics-common/insights-panel';
import { KPICard } from '@/components/analytics-common/kpi-card';
import { PostsPerformanceTable } from '@/components/analytics-common/posts-performance-table';
import { RecommendationsPanel } from '@/components/analytics-common/recommendations-panel';
import { TopPostsGrid } from '@/components/analytics-common/top-posts-grid';
import { formatNumber, formatPercent } from '@/utils/formatNumber';
import {
  useAccountAIInsights,
  useAccountForecasts,
  useAccountHealth,
  useAccountPosts,
  useAccountRecommendations,
  useAccountSummary,
  useAccountTopPosts,
  useConnectedAccounts,
  useRefreshAccountAnalytics,
} from '@/features/analytics/hooks';
import type { Period } from '@/features/analytics/types';
import { daysFromPeriod } from '@/features/analytics/utils';
import { type AnalyticsTabKey, getPlatformAnalyticsModule } from '@/features/analytics/platforms';
import { AnalyticsPeriodSelect } from '@/features/analytics/components/AnalyticsPeriodSelect';
import { getPlatformIcon } from '@/lib/platform-icons';

const TAB_LABELS: Record<AnalyticsTabKey, string> = {
  overview: 'Overview',
  posts: 'Posts',
  insights: 'AI Insights',
  recommendations: 'Recommendations',
  forecasts: 'Forecasts',
};

export default function AnalyticsAccount() {
  const navigate = useNavigate();
  const { socialAccountId } = useParams<{ socialAccountId: string }>();
  const { selectedBrand } = useBrandStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = useState<Period>('30d');
  const days = daysFromPeriod(period);

  const accountsQuery = useConnectedAccounts(selectedBrand?.id);
  const accounts = useMemo(() => accountsQuery.data?.socialAccounts || [], [accountsQuery.data]);

  const currentAccount = useMemo(() => {
    if (!socialAccountId) {
      return null;
    }
    return accounts.find((a) => a.id === socialAccountId) || null;
  }, [accounts, socialAccountId]);

  const platformModule = useMemo(() => {
    return getPlatformAnalyticsModule(currentAccount?.platform);
  }, [currentAccount?.platform]);

  const selectedTabParam = (searchParams.get('tab') || 'overview') as AnalyticsTabKey;
  const tab: AnalyticsTabKey = platformModule.tabs.includes(selectedTabParam)
    ? selectedTabParam
    : 'overview';

  useEffect(() => {
    if (tab !== selectedTabParam) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', tab);
          return next;
        },
        { replace: true }
      );
    }
  }, [selectedTabParam, setSearchParams, tab]);

  const summaryQuery = useAccountSummary(socialAccountId, period);
  const healthQuery = useAccountHealth(socialAccountId, period);

  const [postsSortBy, setPostsSortBy] = useState<
    'publishedAt' | 'engagement' | 'reach' | 'engagementRate'
  >('publishedAt');
  const [postsOrder, setPostsOrder] = useState<'asc' | 'desc'>('desc');
  const [postsOffset, setPostsOffset] = useState(0);

  const postsQuery = useAccountPosts({
    socialAccountId: tab === 'posts' ? socialAccountId : undefined,
    period,
    sortBy: postsSortBy,
    order: postsOrder,
    limit: 20,
    offset: postsOffset,
  });

  const topPostsQuery = useAccountTopPosts(socialAccountId, period);
  const insightsQuery = useAccountAIInsights(socialAccountId, days);
  const forecastsQuery = useAccountForecasts(socialAccountId, 30, 90);
  const recommendationsQuery = useAccountRecommendations(socialAccountId, 90);
  const refreshMutation = useRefreshAccountAnalytics(socialAccountId);

  const summary = summaryQuery.data?.data || null;
  const healthScore = healthQuery.data?.data || null;
  const posts = (postsQuery.data?.data || []).map((post) => ({
    ...post,
    thumbnailUrl: post.thumbnailUrl ?? undefined,
    permalink: post.permalink ?? undefined,
    publishedAt: post.publishedAt ?? undefined,
  }));
  const pagination = postsQuery.data?.pagination;
  const topPosts = (topPostsQuery.data?.data || []).map((post) => ({
    ...post,
    thumbnailUrl: post.thumbnailUrl ?? undefined,
    permalink: post.permalink ?? undefined,
    publishedAt: post.publishedAt ?? undefined,
  }));

  if (!socialAccountId) {
    return (
      <Alert className="mt-6">
        <AlertDescription>Missing social account id.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div>
      <PageHeader title="Analytics" description="Performance metrics and insights" />

      {/* Account Selection Tabs */}
      <div className="mt-6">
        <Tabs
          value={socialAccountId}
          onValueChange={(nextId) => {
            setPostsOffset(0);
            navigate(`/analytics/accounts/${nextId}?tab=overview`);
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList className="h-auto flex-wrap justify-start">
              {accounts.map((a) => (
                <TabsTrigger key={a.id} value={a.id} disabled={a.disconnected} className="gap-2">
                  {getPlatformIcon(a.platform)}
                  <span>{a.displayName || a.username || 'Account'}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="flex flex-wrap items-center gap-3">
              <AnalyticsPeriodSelect
                value={period}
                onChange={(next) => {
                  setPeriod(next);
                  setPostsOffset(0);
                }}
              />

              <Button
                variant="outline"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
              >
                {refreshMutation.isPending ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          </div>
        </Tabs>
      </div>

      {summaryQuery.isLoading ? (
        <Card className="mt-6">
          <CardContent className="py-8">
            <Skeleton className="h-8 w-48" />
          </CardContent>
        </Card>
      ) : summaryQuery.isError ? (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>Failed to load analytics summary.</AlertDescription>
        </Alert>
      ) : null}

      {summary ? (
        <Tabs
          value={tab}
          onValueChange={(next) => {
            setSearchParams((prev) => {
              const params = new URLSearchParams(prev);
              params.set('tab', next);
              return params;
            });
          }}
          className="mt-6"
        >
          <TabsList className="w-full justify-start overflow-x-auto">
            {platformModule.tabs.map((k) => (
              <TabsTrigger key={k} value={k}>
                {TAB_LABELS[k]}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* KPI Summary Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KPICard
                title="Posts"
                value={formatNumber(summary.totalPosts || 0)}
                change={summary.previousPeriodComparison?.totalPosts?.change}
                loading={false}
              />
              <KPICard
                title="Views"
                value={formatNumber(summary.totalImpressions || 0)}
                change={summary.previousPeriodComparison?.impressions?.change}
                loading={false}
              />
              <KPICard
                title="Reach"
                value={formatNumber(summary.totalReach || 0)}
                change={summary.previousPeriodComparison?.reach?.change}
                loading={false}
              />
              <KPICard
                title="Engagement Rate"
                value={formatPercent(summary.averageEngagementRate || 0)}
                change={summary.previousPeriodComparison?.engagementRate?.change}
                loading={false}
              />
            </div>

            {/* Account Health Score */}
            <AccountHealthScore
              healthScore={healthScore || undefined}
              loading={healthQuery.isLoading}
            />

            {/* AI Insights */}
            <InsightsPanel insights={insightsQuery.data} loading={insightsQuery.isLoading} />

            {/* Recommendations */}
            <RecommendationsPanel
              recommendations={recommendationsQuery.data || undefined}
              loading={recommendationsQuery.isLoading}
            />

            {/* Predictive Analytics */}
            <ForecastCharts
              forecasts={forecastsQuery.data || undefined}
              loading={forecastsQuery.isLoading}
            />

            {/* Top Posts */}
            <TopPostsGrid
              posts={topPosts}
              loading={topPostsQuery.isLoading}
              onPostClick={(contentId: string) => navigate(`/posts/${contentId}`)}
            />
          </TabsContent>

          <TabsContent value="posts" className="space-y-6">
            <TopPostsGrid
              posts={topPosts}
              loading={topPostsQuery.isLoading}
              onPostClick={(contentId: string) => navigate(`/posts/${contentId}`)}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-muted-foreground text-sm">Posts performance (server-sorted)</div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={postsSortBy}
                  onValueChange={(v) => setPostsSortBy(v as typeof postsSortBy)}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="publishedAt">Recent</SelectItem>
                    <SelectItem value="engagement">Engagement</SelectItem>
                    <SelectItem value="reach">Reach</SelectItem>
                    <SelectItem value="engagementRate">Eng. Rate</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPostsOrder(postsOrder === 'asc' ? 'desc' : 'asc')}
                >
                  {postsOrder === 'desc' ? '↓' : '↑'}
                </Button>
              </div>
            </div>

            <PostsPerformanceTable
              posts={posts}
              loading={postsQuery.isLoading}
              pagination={pagination}
              onPageChange={(offset) => setPostsOffset(offset)}
              onPostClick={(contentId) => navigate(`/posts/${contentId}`)}
            />
          </TabsContent>

          <TabsContent value="insights" className="space-y-6">
            <InsightsPanel insights={insightsQuery.data} loading={insightsQuery.isLoading} />
          </TabsContent>

          <TabsContent value="recommendations" className="space-y-6">
            <RecommendationsPanel
              recommendations={recommendationsQuery.data || undefined}
              loading={recommendationsQuery.isLoading}
            />
          </TabsContent>

          <TabsContent value="forecasts" className="space-y-6">
            <ForecastCharts
              forecasts={forecastsQuery.data || undefined}
              loading={forecastsQuery.isLoading}
            />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
