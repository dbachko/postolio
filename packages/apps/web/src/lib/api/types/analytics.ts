// Analytics Types - Aligned with component expectations

// Insights Panel
export type InsightType = 'performance' | 'timing' | 'content' | 'audience' | 'competitive';
export type InsightPriority = 'high' | 'medium' | 'low';

export interface AIInsight {
  id: string;
  type: InsightType;
  priority: InsightPriority;
  title: string;
  description: string;
  impact: string;
  actionable: boolean;
  action?: {
    label: string;
    type: string;
    data?: any;
  };
  supportingData?: Array<{
    metric: string;
    value: number | string;
    change?: number;
    trend?: 'up' | 'down' | 'stable';
  }>;
  timestamp: Date;
}

// Forecast Charts
export interface ForecastDataPoint {
  date: string;
  predicted: number;
  confidence: {
    lower: number;
    upper: number;
  };
}

export interface ForecastData {
  current: number;
  predicted: ForecastDataPoint[];
  trend: 'increasing' | 'decreasing' | 'stable';
  confidence: number;
}

// API response format for forecasts (before transformation)
export interface ApiForecastsData {
  engagement?: ForecastData;
  followerGrowth?: ForecastData;
  engagementRate?: ForecastData;
  reach?: ForecastData;
}

// Container for all forecast types - matches ForecastCharts component expectations (after transformation)
export interface ForecastsData {
  engagement?: ForecastData;
  followerGrowth?: ForecastData & { expectedGrowth: number; expectedFollowers: number };
  engagementRate?: ForecastData;
  reach?: ForecastData & { expectedReach: number };
}

// Recommendations Panel
export interface ContentRecommendation {
  type: string;
  title: string;
  description: string;
  currentValue: string | number;
  recommendedValue: string | number;
  impact: 'high' | 'medium' | 'low';
  evidence: string;
  actionItems: string[];
}

export interface HashtagRecommendation {
  hashtag: string;
  score: number;
  avgEngagement: number;
  avgEngagementRate: number;
  usageCount: number;
  category: 'high-performer' | 'trending' | 'niche' | 'suggested';
  reason: string;
}

export interface PostingTimeRecommendation {
  dayOfWeek: string;
  hour: number;
  score: number;
  avgEngagement: number;
  postCount: number;
  confidence: number;
  reason: string;
}

export interface RecommendationsData {
  contentOptimizations?: ContentRecommendation[];
  hashtags?: HashtagRecommendation[];
  postingTimes?: PostingTimeRecommendation[];
  summary?: {
    totalRecommendations: number;
    highImpactCount: number;
    implementationDifficulty: 'easy' | 'moderate' | 'complex';
    estimatedImpact: string;
  };
}

// Brand Health Score
export interface BrandHealthScore {
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

// Growth Projections
export interface GrowthProjection {
  current: number;
  predicted: number;
  growth: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  confidence: number;
}

// Instagram Types
export interface InstagramHashtag {
  hashtag: string;
  uses: number;
  avgReach: number;
  avgEngagement: number;
  avgImpressions: number;
  bestPost?: {
    contentId: string;
    engagementRate: number;
  };
}

export type InstagramAudienceDemographicsStatus =
  'available' | 'no_data' | 'not_connected' | 'insufficient_permissions' | 'error';

export interface InstagramAudienceDemographics {
  totalAudience: number;
  updatedAt: string;
  gender: Array<{ gender: 'M' | 'F' | 'U'; value: number }>;
  age: Array<{ range: string; value: number }>;
  countries: Array<{ code: string; value: number }>;
  cities: Array<{ name: string; value: number }>;
  locales: Array<{ locale: string; value: number }>;
}

export interface InstagramAudienceInsights {
  demographics?: InstagramAudienceDemographics | null;
  demographicsStatus?: InstagramAudienceDemographicsStatus;
  demographicsError?: string | null;
  followerGrowth?: {
    current: number;
    change: number;
    changeRate: string;
    timeline: Array<{ date: string; followers: number }>;
  };
  activityHeatmap?: number[][];
  bestPostingTimes?: Array<{
    day: number;
    dayName: string;
    hour: number;
    timeFormatted: string;
    avgEngagement: number;
  }>;
}

export interface InstagramPostDetailed {
  publicationId: string;
  contentId: string;
  platform: string;
  caption: string;
  thumbnailUrl?: string;
  permalink?: string;
  publishedAt?: string;
  metrics: {
    impressions: number;
    reach: number;
    likes: number;
    comments: number;
    saves: number;
    shares: number;
    engagement: number;
    engagementRate: number;
  };
}
