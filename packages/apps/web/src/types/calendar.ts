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

export type CalendarItem = (Content & { type: 'content' }) | Placeholder;
