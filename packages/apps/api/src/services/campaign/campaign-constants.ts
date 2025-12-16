export const VALID_CAMPAIGN_FREQUENCIES = ['daily', 'every2days', '3weekly'] as const;
export type CampaignFrequency = (typeof VALID_CAMPAIGN_FREQUENCIES)[number];

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const CONCURRENT_EDIT_WINDOW_MS = 5 * 60 * 1000;
export const SCHEDULING_BUFFER_MS = 5 * 60 * 1000;
export const CAMPAIGN_PREVIEW_STUCK_THRESHOLD_MS = 15 * 60 * 1000;
