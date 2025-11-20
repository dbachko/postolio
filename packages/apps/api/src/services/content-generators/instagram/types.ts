export type CampaignContext = {
  id: string;
  name: string;
  campaignType?: string | null;
  contentPillars?: { pillars?: Array<{ name: string; percentage?: number }> } | null;
  urgencyTactics?: {
    discountPercentage?: number;
    promoCode?: string;
    limitedQuantity?: boolean;
  } | null;
  seasonalContext?: unknown;
  config?: { themes?: string[]; seasonalityAssist?: boolean } | null;
};

export type RecentItem = {
  caption: string | null;
  hashtags: string[] | null;
  createdAt: Date;
};

export type BrandLocationContext = {
  postingTimezone?: string | null;
  countryCode?: string | null;
};
