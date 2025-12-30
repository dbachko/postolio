import type { CampaignType } from '@/types/campaign-wizard';

export interface GoalSuggestion {
  value: string;
  score: number;
  source: 'cached' | 'template' | 'fallback' | 'user';
  badge?: string;
  reasons?: string[];
}

export interface GoalCardGridProps {
  brandId: string;
  campaignType: CampaignType;
  selectedGoals: string[];
  onChange: (goals: string[]) => void;
  maxGoals?: number;
}
