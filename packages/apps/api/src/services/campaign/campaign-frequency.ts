import {
  ONE_DAY_MS,
  VALID_CAMPAIGN_FREQUENCIES,
  type CampaignFrequency,
} from './campaign-constants.js';

export function isValidCampaignFrequency(frequency: string): frequency is CampaignFrequency {
  return VALID_CAMPAIGN_FREQUENCIES.includes(frequency as CampaignFrequency);
}

export function getPostsPerWeek(frequency: string): number {
  switch (frequency) {
    case 'daily':
      return 7;
    case 'every2days':
      return 3.5; // Every 2 days = 3.5 posts per week
    case '3weekly':
      return 3;
    default:
      return 1;
  }
}

export function calculateEstimatedPosts(durationDays: number, frequency: string): number {
  return Math.ceil((durationDays / 7) * getPostsPerWeek(frequency));
}

export function calculateDurationDays(startDate: Date, endDate: Date): number {
  return Math.ceil((endDate.getTime() - startDate.getTime()) / ONE_DAY_MS);
}
