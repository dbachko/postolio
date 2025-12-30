export interface HealthScoreFactors {
  engagementRate: number;
  followerGrowthRate: number;
  contentConsistency: number;
  commentResponseRate: number;
  publishingFrequency: number;
}

export type HealthScoreLevel = 'excellent' | 'good' | 'needs_improvement' | 'action_required';

export interface HealthScorePrimaryFactor {
  name: string;
  value: number;
  suggestion: string;
}

export interface HealthScoreData {
  score: number;
  level: HealthScoreLevel;
  color: string;
  factors: HealthScoreFactors;
  primaryFactor: HealthScorePrimaryFactor;
}

export interface BrandHealthScoreProps {
  healthScore?: HealthScoreData;
  loading?: boolean;
}
