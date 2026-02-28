export interface User {
  id: string;
  email: string;
  name: string | null;
  subscriptionTier: string;
  featureFlags?: {
    multiDestination?: boolean;
    inbox?: boolean;
    snippets?: boolean;
  };
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
  contentGroupId?: string | null;
  contentSeriesId?: string | null;
  contentSeriesName?: string | null;
  contentSeriesColor?: string | null;
  contentSeriesKind?: 'batch' | 'rolling' | null;
  contentSeriesStatus?: 'active' | 'paused' | 'archived' | null;
  recipeRunId?: string | null;
  generatedByRecipe?: { id: string; slug: string; name: string } | null;
  targetSocialAccountId?: string | null;
  primaryAssetId?: string | null;
  contentType?: string | null;
  mediaAssets?: Array<{
    assetId: string;
    displayOrder: number;
  }> | null;
  mediaAssetCount?: number | null;
  shareToFeed?: boolean | null;
  firstComment?: string | null;
  firstCommentStatus?: 'pending' | 'posted' | 'failed' | 'retrying' | null;
  firstCommentPostedAt?: string | null;
  firstCommentError?: string | null;
  status: 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';
  scheduledAt: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
  brandId: string;
  permalink?: string | null;
  schedulingError?: string | null;
  publishingQueueItemId?: string | null;
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
