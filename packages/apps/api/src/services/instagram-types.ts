export interface InstagramPost {
  id: string;
  caption: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url: string;
  permalink: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
  hashtags?: string[];
}

export interface InstagramProfile {
  id: string;
  username: string;
  account_type: string;
  media_count: number;
  followers_count: number;
  follows_count: number;
  name: string;
  biography: string;
  website: string;
  profile_picture_url: string;
}

export interface PublishMediaRequest {
  cdnImageUrl: string;
  caption: string;
}

export interface PublishMediaResult {
  id: string;
  permalink: string;
  published: boolean;
}

export interface MediaInsights {
  impressions: number;
  reach: number;
  engagement: number;
  saves?: number;
  video_views?: number;
}

export type InstagramAudienceDemographicsStatus =
  'available' | 'no_data' | 'not_connected' | 'insufficient_permissions' | 'error';

export interface InstagramAudienceDemographics {
  totalAudience: number;
  updatedAt: string;
  gender: Array<{ gender: 'M' | 'F' | 'U'; value: number }>;
  age: Array<{ range: string; value: number }>;
  countries: Array<{ code: string; value: number }>;
  cities: Array<{ name: string; value: number }>;
  locales: Array<{ locale: string; value: number }>;
}

export interface InstagramAudienceDemographicsResult {
  status: InstagramAudienceDemographicsStatus;
  demographics?: InstagramAudienceDemographics;
  errorMessage?: string;
}

interface InstagramWebhookChange {
  field?: string;
  value?: unknown;
}

interface InstagramWebhookEntry {
  id?: string;
  time?: number;
  changes?: InstagramWebhookChange[];
}

export interface InstagramWebhookEvent {
  object?: string;
  entry?: InstagramWebhookEntry[];
  [key: string]: unknown;
}

export interface BrandData {
  id: string;
}

interface MediaInsightValue {
  value?: number;
  end_time?: string;
}

export interface MediaInsightMetric {
  name: string;
  period?: string;
  values?: MediaInsightValue[];
  title?: string;
  description?: string;
}

export interface InstagramComment {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
}
