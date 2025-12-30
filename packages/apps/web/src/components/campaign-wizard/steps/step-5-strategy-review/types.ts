export type CampaignFrequency = 'daily' | 'every2days' | '3weekly';

export interface StrategyPredictions {
  estimatedPosts: number;
  reach: { low: number; high: number };
  engagementRate: number;
}

export interface StrategyPredictionsMeta {
  basis: 'historical' | 'heuristic';
  samples: { engagement: number; reach: number };
}

export interface SchedulePhase {
  phase: string;
  startOffsetDays: number;
  frequency: CampaignFrequency;
  rationale: string;
}

export interface PillarDraft {
  name: string;
  percentage: number;
}
