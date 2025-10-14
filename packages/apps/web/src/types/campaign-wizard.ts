export type CampaignType =
  | 'promotional'
  | 'educational'
  | 'seasonal'
  | 'thought_leadership'
  | 'custom';

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
  currentStep: number; // 1..5
  brandId: string | null;
  name: string;
  campaignType: CampaignType | null;
  goals: string;
  timeline: Timeline | null;
  themes: string[];
  style: string;
  frequency: 'daily' | 'every2days' | '3weekly' | '';
  postingTime: string; // HH:mm
  priority: number;
  promotionDetails: PromotionDetails | null;
  contentPillars?: {
    pillars: Array<{ name: string; percentage: number; themes?: string[] }>;
  } | null;
  saveStatus: 'saved' | 'saving' | 'error' | 'idle';
  draftId?: string;
}

export interface CampaignTypeConfig {
  id: CampaignType;
  name: string;
  icon?: string;
  description: string;
  defaultFrequency: 'daily' | 'every2days' | '3weekly';
  defaultDuration: { days: number };
  urgencyEnabled?: boolean;
  commonThemes?: string[];
}
