export interface EventDetail {
  scheduleId?: string;
  contentId?: string;
  publicationId?: string;
  brandId?: string;
  socialAccountId?: string;
  platform?: string;
  platformPostId?: string;
  permalink?: string;
  publishedAt?: string;
  scheduledAt?: string;
  error?: string;
  attemptNumber?: number;
  reason?: string;
  status?: string;
  updates?: { scheduledAt?: string };
}
