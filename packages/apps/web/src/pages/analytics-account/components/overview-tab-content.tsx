import { TabsContent } from '@/components/ui/tabs';
import { AccountHealthScore } from '@/components/analytics-common/account-health-score';
import { ForecastCharts } from '@/components/analytics-common/forecast-charts';
import { InsightsPanel } from '@/components/analytics-common/insights-panel';
import { KPICard } from '@/components/analytics-common/kpi-card';
import { RecommendationsPanel } from '@/components/analytics-common/recommendations-panel';
import { TopPostsGrid } from '@/components/analytics-common/top-posts-grid';
import { formatNumber, formatPercent } from '@/utils/formatNumber';

import type { AnalyticsOverviewData } from '../types';

function OverviewKpiCards({ summary }: { summary: AnalyticsOverviewData['summary'] }) {
  return (
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
  );
}

interface OverviewTabContentProps extends AnalyticsOverviewData {
  onPostClick: (contentId: string) => void;
}

export function OverviewTabContent(props: OverviewTabContentProps) {
  return (
    <TabsContent value="overview" className="space-y-6">
      <OverviewKpiCards summary={props.summary} />
      <AccountHealthScore
        healthScore={props.healthScore || undefined}
        loading={props.healthLoading}
      />
      <InsightsPanel insights={props.insights} loading={props.insightsLoading} />
      <RecommendationsPanel
        recommendations={props.recommendations || undefined}
        loading={props.recommendationsLoading}
      />
      <ForecastCharts forecasts={props.forecasts || undefined} loading={props.forecastsLoading} />
      <TopPostsGrid
        posts={props.topPosts}
        loading={props.topPostsLoading}
        onPostClick={props.onPostClick}
      />
    </TabsContent>
  );
}
