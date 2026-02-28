import type {
  AccountHealthScore,
  AccountPost,
  AccountSummary,
  AIInsight,
  ConnectedAccount,
  ForecastsData,
  Pagination,
  RecommendationsData,
  Period,
} from '@/features/analytics/types';
import type { AnalyticsTabKey } from '@/features/analytics/platforms';

export type AnalyticsPostsSortBy = 'publishedAt' | 'engagement' | 'reach' | 'engagementRate';

export type AnalyticsPost = Omit<AccountPost, 'thumbnailUrl' | 'permalink' | 'publishedAt'> & {
  thumbnailUrl?: string;
  permalink?: string;
  publishedAt?: string;
};

export interface AnalyticsOverviewData {
  summary: AccountSummary;
  healthScore: AccountHealthScore | null;
  healthLoading: boolean;
  insights: AIInsight[] | undefined;
  insightsLoading: boolean;
  recommendations: RecommendationsData | undefined;
  recommendationsLoading: boolean;
  forecasts: ForecastsData | undefined;
  forecastsLoading: boolean;
  topPosts: AnalyticsPost[];
  topPostsLoading: boolean;
}

export interface AnalyticsPostsData {
  topPosts: AnalyticsPost[];
  topPostsLoading: boolean;
  posts: AnalyticsPost[];
  postsLoading: boolean;
  pagination: Pagination | undefined;
  sortBy: AnalyticsPostsSortBy;
  order: 'asc' | 'desc';
}

export interface AnalyticsAccountSelection {
  socialAccountId?: string;
  accounts: ConnectedAccount[];
  period: Period;
  tab: AnalyticsTabKey;
  platformTabs: AnalyticsTabKey[];
}
