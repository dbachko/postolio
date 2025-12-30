import type { MutableRefObject } from 'react';

export type CampaignType =
  | 'promotional'
  | 'educational'
  | 'seasonal'
  | 'thought_leadership'
  | 'custom';

export type ImageSource = 'ai' | 'assets' | 'stock' | 'mix';

export type ImageProvider = 'dalle-3' | 'gemini-2.5-flash' | 'gemini-3-pro';

export interface PromotionDetails {
  discountPercentage?: number;
  promoCode?: string;
  limitedQuantity?: boolean;
}

export interface Timeline {
  startDate: string; // ISO yyyy-MM-dd
  endDate: string; // ISO yyyy-MM-dd
}

export interface CampaignWizardState {
  currentStep: number; // 1..6 (updated for 6-step wizard)
  brandId: string | null;
  name: string;
  campaignType: CampaignType | null;
  goals: string[];
  timeline: Timeline | null;
  themes: string[];
  style: string[];
  imageSource: ImageSource | null; // NEW: Image source preference
  imageProvider: ImageProvider | null; // NEW: Image generation provider (for AI images)
  frequency: string; // allow custom schedules
  postingTime: string; // HH:mm
  useDefaultDestinations: boolean;
  targetSocialAccountIds: string[];
  priority: number;
  promotionDetails: PromotionDetails | null;
  contentPillars?: {
    pillars: Array<{ name: string; percentage: number; themes?: string[] }>;
  } | null;
  acceptedRecommendations?: string[];
  saveStatus: 'saved' | 'saving' | 'error' | 'idle';
  skipUnsavedWarning: boolean;
  allowNavigationRef?: MutableRefObject<boolean>; // Ref to allow navigation without warning
  draftId?: string;
  seasonalityAssist: boolean;
  // Persisted AI strategy results to avoid losing them on refresh/navigation
  strategyPredictions: {
    estimatedPosts: number;
    reach: { low: number; high: number };
    engagementRate: number;
  } | null;
  strategyPredictionsMeta: {
    basis: 'historical' | 'heuristic';
    samples: { engagement: number; reach: number };
  } | null;
  strategySchedule: {
    phases: Array<{
      phase: string;
      startOffsetDays: number;
      frequency: 'daily' | 'every2days' | '3weekly';
      rationale: string;
    }>;
    postingTime: string | null;
  } | null;
}

export interface CampaignTypeConfig {
  id: CampaignType;
  name: string;
  icon?: string;
  description: string;
  defaultFrequency: 'daily' | 'every2days' | '3weekly';
  defaultDuration: { days: number };
  urgencyEnabled?: boolean;
}
