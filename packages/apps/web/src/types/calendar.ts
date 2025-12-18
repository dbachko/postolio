import type { Content } from '../lib/api';

export interface Placeholder {
  id: string;
  type: 'placeholder';
  campaignId: string;
  campaignName: string;
  campaignColor: string | null;
  scheduledAt: string;
  status: 'placeholder';
  message: string;
  caption: string;
  hashtags: string[];
  brandId: string;
  createdAt: string;
  postedAt: undefined;
}

export type CalendarContentItem = Content & {
  type: 'content';
  isMultiDestination?: boolean;
  destinationSocialAccountIds?: string[];
  destinationContentIds?: string[];
};

export type CalendarItem = CalendarContentItem | Placeholder;
