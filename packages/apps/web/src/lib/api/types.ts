export interface User {
  id: string;
  email: string;
  name: string | null;
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
  campaignId?: string | null;
  campaignName?: string | null;
  campaignColor?: string | null;
  permalink?: string | null;
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
  };
  // In list views, content is omitted to reduce payload. Keep optional.
  content?: Content[];
  // Lightweight counts returned by list endpoint
  contentCount?: number;
  scheduledCount?: number;
  publishedCount?: number;
  errorMessage?: string | null;
  previewGenerated?: boolean;
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

// Instagram Best Time Recommendation
export interface BestTimeWindow {
  startLocal: string; // ISO with offset
  startUTC: string; // ISO UTC
  durationMinutes: number;
  score: number; // 0..1
  explanation?: string;
}

export interface BestTimePayload {
  brandId: string;
  platform: 'instagram';
  timezone: string;
  source: 'instagram_insights' | 'history' | 'heuristic';
  confidence: number; // 0..1
  generatedAt: string; // ISO
  ttlSeconds: number;
  heatmap: number[][]; // 7x24 normalized values
  topWindows: BestTimeWindow[];
  notes?: string[];
}

export interface BestTimeStatus {
  cacheTTL: number;
  cached: boolean;
  source?: BestTimePayload['source'];
  confidence?: number;
  generatedAt?: string;
  nextRefreshAt?: string | null;
}

// Analytics Types - Aligned with component expectations

// Insights Panel
export type InsightType = 'performance' | 'timing' | 'content' | 'audience' | 'competitive';
export type InsightPriority = 'high' | 'medium' | 'low';

export interface AIInsight {
  id: string;
  type: InsightType;
  priority: InsightPriority;
  title: string;
  description: string;
  impact: string;
  actionable: boolean;
  action?: {
    label: string;
    type: string;
    data?: any;
  };
  supportingData?: Array<{
    metric: string;
    value: number | string;
    change?: number;
    trend?: 'up' | 'down' | 'stable';
  }>;
  timestamp: Date;
}

// Forecast Charts
export interface ForecastDataPoint {
  date: string;
  predicted: number;
  confidence: {
    lower: number;
    upper: number;
  };
}

export interface ForecastData {
  current: number;
  predicted: ForecastDataPoint[];
  trend: 'increasing' | 'decreasing' | 'stable';
  confidence: number;
}

// API response format for forecasts (before transformation)
export interface ApiForecastsData {
  engagement?: ForecastData;
  followerGrowth?: ForecastData;
  engagementRate?: ForecastData;
  reach?: ForecastData;
}

// Container for all forecast types - matches ForecastCharts component expectations (after transformation)
export interface ForecastsData {
  engagement?: ForecastData;
  followerGrowth?: ForecastData & { expectedGrowth: number; expectedFollowers: number };
  engagementRate?: ForecastData;
  reach?: ForecastData & { expectedReach: number };
}

// Recommendations Panel
export interface ContentRecommendation {
  type: string;
  title: string;
  description: string;
  currentValue: string | number;
  recommendedValue: string | number;
  impact: 'high' | 'medium' | 'low';
  evidence: string;
  actionItems: string[];
}

export interface HashtagRecommendation {
  hashtag: string;
  score: number;
  avgEngagement: number;
  avgEngagementRate: number;
  usageCount: number;
  category: 'high-performer' | 'trending' | 'niche' | 'suggested';
  reason: string;
}

export interface PostingTimeRecommendation {
  dayOfWeek: string;
  hour: number;
  score: number;
  avgEngagement: number;
  postCount: number;
  confidence: number;
  reason: string;
}

export interface RecommendationsData {
  contentOptimizations?: ContentRecommendation[];
  hashtags?: HashtagRecommendation[];
  postingTimes?: PostingTimeRecommendation[];
  summary?: {
    totalRecommendations: number;
    highImpactCount: number;
    implementationDifficulty: 'easy' | 'moderate' | 'complex';
    estimatedImpact: string;
  };
}

// Brand Health Score
export interface BrandHealthScore {
  score: number;
  level: 'excellent' | 'good' | 'needs_improvement' | 'action_required';
  color: string;
  factors: {
    engagementRate: number;
    followerGrowthRate: number;
    contentConsistency: number;
    commentResponseRate: number;
    publishingFrequency: number;
  };
  primaryFactor: {
    name: string;
    value: number;
    suggestion: string;
  };
}

// Growth Projections
export interface GrowthProjection {
  current: number;
  predicted: number;
  growth: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  confidence: number;
}

// Instagram Types
export interface InstagramHashtag {
  hashtag: string;
  uses: number;
  avgReach: number;
  avgEngagement: number;
  avgImpressions: number;
  bestPost?: {
    contentId: string;
    engagementRate: number;
  };
}

export type InstagramAudienceDemographicsStatus =
  | 'available'
  | 'no_data'
  | 'not_connected'
  | 'insufficient_permissions'
  | 'error';

export interface InstagramAudienceDemographics {
  totalAudience: number;
  updatedAt: string;
  gender: Array<{ gender: 'M' | 'F' | 'U'; value: number }>;
  age: Array<{ range: string; value: number }>;
  countries: Array<{ code: string; value: number }>;
  cities: Array<{ name: string; value: number }>;
  locales: Array<{ locale: string; value: number }>;
}

export interface InstagramAudienceInsights {
  demographics?: InstagramAudienceDemographics | null;
  demographicsStatus?: InstagramAudienceDemographicsStatus;
  demographicsError?: string | null;
  followerGrowth?: {
    current: number;
    change: number;
    changeRate: string;
    timeline: Array<{ date: string; followers: number }>;
  };
  activityHeatmap?: number[][];
  bestPostingTimes?: Array<{
    day: number;
    dayName: string;
    hour: number;
    timeFormatted: string;
    avgEngagement: number;
  }>;
}

export interface InstagramPostDetailed {
  publicationId: string;
  contentId: string;
  platform: string;
  caption: string;
  thumbnailUrl?: string;
  permalink?: string;
  publishedAt?: string;
  metrics: {
    impressions: number;
    reach: number;
    likes: number;
    comments: number;
    saves: number;
    shares: number;
    engagement: number;
    engagementRate: number;
  };
}

// ============================================
// DM Automation Types
// ============================================

export type DMTriggerType = 'comment_keyword' | 'dm_keyword' | 'comment_any' | 'dm_any';
export type DMActionType = 'send_dm' | 'reply_comment' | 'send_dm_and_reply';
export type DMRuleStatus = 'active' | 'paused' | 'archived';

export interface DMTriggerConfig {
  keywords: string[];
  matchType: 'exact' | 'contains' | 'regex';
}

export interface DMActiveHours {
  start: string; // HH:MM format
  end: string; // HH:MM format
  timezone?: string;
}

export interface DMAutomationRule {
  id: string;
  brandId: string;
  name: string;
  triggerType: DMTriggerType;
  triggerConfig: DMTriggerConfig;
  actionType: DMActionType;
  messageTemplate: string;
  commentReplyTemplate: string | null;
  status: DMRuleStatus;
  priority: number;
  maxUsesPerUser: number | null;
  cooldownMinutes: number | null;
  activeHours: DMActiveHours | null;
  activeDays: number[] | null; // 0=Sunday, 6=Saturday
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface CreateRuleInput {
  name: string;
  triggerType: DMTriggerType;
  triggerConfig: DMTriggerConfig;
  actionType: DMActionType;
  messageTemplate: string;
  commentReplyTemplate?: string;
  maxUsesPerUser?: number;
  cooldownMinutes?: number;
  activeHours?: DMActiveHours;
  activeDays?: number[];
  priority?: number;
}

export interface UpdateRuleInput extends Partial<CreateRuleInput> {
  status?: DMRuleStatus;
}

export interface DMAutomationAnalytics {
  period: {
    days: number;
    since: string;
  };
  overview: {
    totalEvents: number;
    messagesSent: number;
    commentRepliesSent: number;
    rateLimitedEvents: number;
    uniqueUsers: number;
    successRate: number;
  };
  byRule: Array<{
    ruleId: string;
    ruleName: string;
    totalEvents: number;
    messagesSent: number;
    commentRepliesSent: number;
    rateLimited: number;
  }>;
}

export type ConversationState = 'active' | 'archived' | 'spam';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'sent' | 'failed' | 'delivered' | 'read';

export interface DMConversation {
  id: string;
  brandId: string;
  ruleId: string | null;
  instagramUserId: string;
  instagramUsername: string;
  state: ConversationState;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
  rule?: {
    id: string;
    name: string;
  } | null;
  messageCount?: number;
  lastMessage?: {
    text: string;
    direction: MessageDirection;
    createdAt: Date;
  } | null;
}

export interface DMMessage {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  messageText: string;
  externalMessageId: string | null;
  externalCommentId: string | null;
  status: MessageStatus;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedReply {
  id: string;
  brandId: string;
  userId: string;
  title: string;
  body: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSavedReplyInput {
  title: string;
  body: string;
  isDefault?: boolean;
}

export interface UpdateSavedReplyInput {
  title?: string;
  body?: string;
  isDefault?: boolean;
}
