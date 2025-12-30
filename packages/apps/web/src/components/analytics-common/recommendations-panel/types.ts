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

export interface RecommendationsPanelProps {
  recommendations?: {
    contentOptimizations?: ContentRecommendation[];
    hashtags?: HashtagRecommendation[];
    postingTimes?: PostingTimeRecommendation[];
    summary?: {
      totalRecommendations: number;
      highImpactCount: number;
      implementationDifficulty: 'easy' | 'moderate' | 'complex';
      estimatedImpact: string;
    };
  };
  loading?: boolean;
  onViewHashtags?: () => void;
  onViewSchedule?: () => void;
}
