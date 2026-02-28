import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ForecastCharts } from '@/components/analytics-common/forecast-charts';
import { InsightsPanel } from '@/components/analytics-common/insights-panel';
import { RecommendationsPanel } from '@/components/analytics-common/recommendations-panel';
import type { AnalyticsTabKey } from '@/features/analytics/platforms';

import type { AnalyticsOverviewData, AnalyticsPostsData, AnalyticsPostsSortBy } from '../types';
import { OverviewTabContent } from './overview-tab-content';
import { PostsTabContent } from './posts-tab-content';

const TAB_LABELS: Record<AnalyticsTabKey, string> = {
  overview: 'Overview',
  posts: 'Posts',
  insights: 'AI Insights',
  recommendations: 'Recommendations',
  forecasts: 'Forecasts',
};

function TabTriggers({ tabs }: { tabs: AnalyticsTabKey[] }) {
  return (
    <TabsList className="w-full justify-start overflow-x-auto">
      {tabs.map((tab) => (
        <TabsTrigger key={tab} value={tab}>
          {TAB_LABELS[tab]}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

interface AnalyticsAccountTabsContentProps {
  tab: AnalyticsTabKey;
  platformTabs: AnalyticsTabKey[];
  overviewData: AnalyticsOverviewData;
  postsData: AnalyticsPostsData;
  onTabChange: (nextTab: string) => void;
  onOverviewPostClick: (contentId: string) => void;
  onPostsSortByChange: (value: AnalyticsPostsSortBy) => void;
  onPostsOrderToggle: () => void;
  onPostsPageChange: (offset: number) => void;
  onPostsPostClick: (contentId: string) => void;
}

export function AnalyticsAccountTabsContent({
  tab,
  platformTabs,
  overviewData,
  postsData,
  onTabChange,
  onOverviewPostClick,
  onPostsSortByChange,
  onPostsOrderToggle,
  onPostsPageChange,
  onPostsPostClick,
}: AnalyticsAccountTabsContentProps) {
  return (
    <Tabs value={tab} onValueChange={onTabChange} className="mt-6">
      <TabTriggers tabs={platformTabs} />
      <OverviewTabContent {...overviewData} onPostClick={onOverviewPostClick} />
      <PostsTabContent
        {...postsData}
        onSortByChange={onPostsSortByChange}
        onOrderToggle={onPostsOrderToggle}
        onPageChange={onPostsPageChange}
        onPostClick={onPostsPostClick}
      />
      <TabsContent value="insights" className="space-y-6">
        <InsightsPanel insights={overviewData.insights} loading={overviewData.insightsLoading} />
      </TabsContent>
      <TabsContent value="recommendations" className="space-y-6">
        <RecommendationsPanel
          recommendations={overviewData.recommendations || undefined}
          loading={overviewData.recommendationsLoading}
        />
      </TabsContent>
      <TabsContent value="forecasts" className="space-y-6">
        <ForecastCharts
          forecasts={overviewData.forecasts || undefined}
          loading={overviewData.forecastsLoading}
        />
      </TabsContent>
    </Tabs>
  );
}
