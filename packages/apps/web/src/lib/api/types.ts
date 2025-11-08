export interface User {
  id: string;
  email: string;
  name: string | null;
  instagramUsername: string | null;
  subscriptionTier: string;
  timezone?: string | null;
  timezoneAutoDetected?: boolean;
  theme?: 'system' | 'light' | 'dark';
  weekStart?: 'monday' | 'sunday';
  createdAt: string;
}

export interface Brand {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  countryCode?: string | null;
  postingTimezone?: string | null; // Brand-specific posting timezone (null = use user's timezone)
}

export interface Content {
  id: string;
  caption: string;
  hashtags: string[];
  primaryAssetId?: string | null;
  imageUrl?: string | null;
  primaryAssetCdnUrl?: string | null;
  primaryAssetWidth?: number | null;
  primaryAssetHeight?: number | null;
  status: 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';
  scheduledAt: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
  brandId: string;
  campaignId?: string | null;
  campaignName?: string | null;
  campaignColor?: string | null;
  instagramPostId?: string | null;
  instagramPermalink?: string | null;
  schedulingError?: string | null;
}

export interface AuthResponse {
  user: User;
  message: string;
}

export interface Session {
  id: string;
  deviceName: string;
  deviceFingerprint?: string | null;
  ipAddress?: string | null;
  location?: {
    city?: string;
    country?: string;
    region?: string;
  } | null;
  userAgent?: string | null;
  lastActivityAt: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
  trusted: boolean;
  trustedUntil?: string | null;
}

export interface SessionsResponse {
  sessions: Session[];
  total: number;
}

export interface SecuritySummary {
  activeSessions: number;
  lastPasswordChange: string | null;
  passwordAuthEnabled?: boolean;
  oauthProviders?: string[];
  recentLogins: number;
  suspiciousActivity: number;
  lastLogin: {
    timestamp: string;
    location?: { city?: string; country?: string } | null;
    device: string;
  } | null;
}

export interface LoginHistoryItem {
  timestamp: string;
  device: string;
  location?: { city?: string; country?: string } | null;
  ipAddress?: string | null;
  status: 'active' | 'revoked';
  revokedReason?: string | null;
}

export interface LoginHistoryResponse {
  history: LoginHistoryItem[];
  total: number;
}

export interface CampaignConfig {
  name: string;
  brandId: string;
  duration: { start: string | Date; end: string | Date };
  frequency: string;
  themes: string[];
  style: string;
  postingTime: string;
  priority?: number;
  campaignType?: 'promotional' | 'educational' | 'seasonal' | 'thought_leadership' | 'custom';
  promotionDetails?: { discountPercentage?: number; promoCode?: string; limitedQuantity?: boolean };
  contentPillars?: { pillars: Array<{ name: string; percentage: number; themes: string[] }> };
  goals?: string[];
  seasonalityAssist?: boolean;
}

export interface CampaignPreview {
  campaignId: string;
  configId: string;
  examplePosts: Content[];
  campaignPlan: {
    name: string;
    duration: { start: string; end: string };
    estimatedTotalPosts: number;
    postingSchedule: string;
    themes: string[];
    style: string;
    postingTime: string;
  };
}

export interface Campaign {
  id: string;
  name: string;
  status: 'creating' | 'preview' | 'active' | 'paused' | 'completed' | 'failed' | 'processing';
  brandId: string;
  color?: string | null;
  config?: {
    duration?: { start: string; end: string };
    frequency?: string;
    themes?: string[];
    style?: string;
    postingTime?: string;
    priority?: number;
  };
  // In list views, content is omitted to reduce payload. Keep optional.
  content?: Content[];
  // Lightweight counts returned by list endpoint
  contentCount?: number;
  scheduledCount?: number;
  publishedCount?: number;
  errorMessage?: string | null;
  previewGenerated?: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  lastModifiedAt?: string;
  lastModifiedBy?: string;
}

export interface Notification {
  id: string;
  type: string;
  category: string;
  severity: 'info' | 'warning' | 'error' | string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  createdAt: string;
  readAt?: string | null;
}

export interface NotificationPreference {
  id?: string;
  brandId?: string | null;
  category: string;
  type: string;
  channel: 'in_app' | 'email' | 'digest' | 'push' | 'slack';
  enabled: boolean;
  frequency?: 'instant' | 'daily' | 'weekly' | null;
  digestTime?: string | null;
}
