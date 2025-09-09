import type { Content } from "../lib/api";

export interface Placeholder {
  id: string;
  type: "placeholder";
  campaignId: string;
  campaignName: string;
  scheduledAt: string;
  status: "placeholder";
  message: string;
  caption: string;
  hashtags: string[];
  imageUrl: undefined;
  brandId: string;
  createdAt: string;
  postedAt: undefined;
}

export type CalendarItem = (Content & { type: "content" }) | Placeholder;
