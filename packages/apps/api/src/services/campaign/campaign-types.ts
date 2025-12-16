import type { GeneratedContent } from '../content-generator.js';
import type { ImageProvider } from '../image-providers/types.js';

export interface CampaignConfig {
  name?: string; // Optional: Auto-generated if not provided
  brandId: string;
  duration: {
    start: Date;
    end: Date;
  };
  frequency: string; // 'daily', 'every2days', '3weekly', etc.
  themes: string[];
  style?: string;
  imageProvider?: ImageProvider;
  postingTime: string; // HH:MM format
  // Wizard-enhanced (Phase 1) optional fields
  campaignType?: 'promotional' | 'educational' | 'seasonal' | 'thought_leadership' | 'custom';
  contentPillars?: unknown; // Json structure { pillars: [{ name, percentage, themes }] }
  urgencyTactics?: unknown; // Json structure { hasUrgency, discountPercentage, promoCode, limitedQuantity }
  seasonalContext?: unknown; // Json structure { season, events, themes }
  goals?: string; // High-level goals/intent captured in wizard
  seasonalityAssist?: boolean; // Whether to include seasons/holidays in generation prompts
}

export interface CampaignPreview {
  campaignId: string;
  examplePosts: GeneratedContent[];
  estimatedPostCount: number;
  schedule: {
    frequency: string;
    duration: number; // days
    totalPosts: number;
  };
}

export interface CampaignStartResult {
  campaign: Record<string, unknown>;
  scheduledPosts: number;
}
