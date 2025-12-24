import type { AIInsight, ForecastsData, RecommendationsData } from './types';

export type Period = '7d' | '30d' | '90d';

export type { AIInsight, ForecastsData, RecommendationsData };

export type Pagination = {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type ApiResponse<T> = {
  success: boolean;
  data: T;
};

export type ApiPaginatedResponse<T> = ApiResponse<T> & {
  pagination: Pagination;
};

export type ConnectedAccount = {
  id: string;
  platform: string;
  externalAccountId: string;
  externalPageId?: string | null;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  disconnected: boolean;
  tokenStatus?: 'healthy' | 'expiring' | 'expired' | 'unknown' | 'disconnected';
  tokenExpiresAt?: string | null;
  metadata?: any;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ConnectedAccountsResponse = {
  brandId: string;
  primarySocialAccountId: string | null;
  defaultPostSocialAccountIds: string[];
  socialAccounts: ConnectedAccount[];
};

export type AccountSummary = {
  account: {
    id: string;
    brandId: string;
    platform: string;
    externalAccountId: string;
    externalPageId: string | null;
    username: string | null;
    displayName: string | null;
    profilePictureUrl: string | null;
  };
  period: Period;
  totalPosts: number;
  totalImpressions: number;
  totalReach: number;
  totalEngagement: number;
  averageEngagementRate: number;
  previousPeriodComparison?: {
    totalPosts?: { current: number; previous: number; change: number };
    impressions?: { current: number; previous: number; change: number };
    reach?: { current: number; previous: number; change: number };
    engagement?: { current: number; previous: number; change: number };
    engagementRate?: { current: number; previous: number; change: number };
  };
};

export type PostMetrics = {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  engagement: number;
  engagementRate: number;
};

export type AccountPost = {
  publicationId: string;
  contentId: string;
  platform: string;
  caption: string;
  thumbnailUrl?: string | null;
  permalink?: string | null;
  publishedAt?: string | null;
  metrics: PostMetrics;
};

export type AccountPostsResponse = ApiPaginatedResponse<AccountPost[]>;

export interface AccountHealthScore {
  score: number;
  level: 'excellent' | 'good' | 'needs_improvement' | 'action_required';
  color: string;
  factors: {
    engagementRate: number;
    followerGrowthRate: number;
    contentConsistency: number;
    commentResponseRate: number;
    publishingFrequency: number;
  };
  primaryFactor: {
    name: string;
    value: number;
    suggestion: string;
  };
}

export type AIInsightsReport = {
  brandId: string;
  generatedAt: string;
  insights: AIInsight[];
  summary: {
    totalInsights: number;
    highPriority: number;
    mediumPriority: number;
    lowPriority: number;
  };
};

export type RecommendationsReport = RecommendationsData & {
  brandId: string;
  generatedAt: string;
};

export type ForecastReport = {
  brandId: string;
  generatedAt: string;
  period: number;
  forecasts: ForecastsData;
  recommendations: string[];
};
