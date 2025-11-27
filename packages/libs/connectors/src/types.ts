export type PlatformName = 'instagram' | 'facebook' | 'linkedin' | 'x' | 'youtube' | 'tiktok';

export interface RateLimits {
  postsPerHour?: number;
  postsPerDay?: number;
  apiCallsPerHour?: number;
}

export interface ConnectorCapabilities {
  publish?: boolean;
  accountInsights?: boolean;
  mediaInsights?: boolean;
  comments?: boolean;
  pagination?: boolean;
  ads?: boolean;
  directMessages?: boolean; // Threads + messages support
  bestTime?: boolean; // Can compute best time natively or via insights
}

export interface PublishRequest {
  caption: string;
  imageUrl?: string;
  mediaUrl?: string;
  // mediaType maps to Instagram Graph API media_type semantics:
  // - IMAGE / VIDEO: feed posts
  // - REELS: short‑form video in Reels
  // - STORIES: ephemeral story (image or video)
  // - CAROUSEL_ALBUM: multi‑media carousel
  mediaType?: 'IMAGE' | 'VIDEO' | 'REELS' | 'STORIES' | 'CAROUSEL_ALBUM';
  thumbOffset?: number; // Thumbnail offset in milliseconds (for videos)
  shareToFeed?: boolean; // For reels: show in both feed and Reels tab
  metadata?: Record<string, unknown>;
}

export interface PublishResult {
  externalPostId: string;
  permalink?: string;
  publishedAt: string;
  metadata?: Record<string, unknown>;
}

export interface AccountIdentity {
  platform: PlatformName;
  externalAccountId: string;
  externalPageId?: string | null; // FB/IG
  username?: string | null;
}

export interface Credentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface PostSummary {
  id: string;
  caption: string;
  mediaType?: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'TEXT' | 'LINK';
  mediaUrl?: string;
  permalink?: string;
  postedAt?: string;
}

export interface Pagination<TCursor = string> {
  cursor?: TCursor | null;
  hasMore: boolean;
}

export interface ListPostsResult extends Pagination<string> {
  data: PostSummary[];
}

export type MetricName =
  | 'impressions'
  | 'reach'
  | 'likes'
  | 'comments'
  | 'saves'
  | 'shares'
  | 'video_views'
  | 'engagement'
  | 'profile_views'
  | 'followers'
  | 'link_clicks'
  | 'website_clicks';

export interface MediaMetrics {
  metrics: Partial<Record<MetricName, number>>;
  asOf: string;
}

export interface AccountMetrics {
  metrics: Partial<Record<MetricName, number>>;
  asOf: string;
  period?: 'day' | 'lifetime';
}

export interface CommentItem {
  id: string;
  text?: string;
  username?: string;
  createdAt?: string;
  likeCount?: number;
  parentId?: string | null;
}

export interface Connector {
  readonly platform: PlatformName;
  readonly capabilities: ConnectorCapabilities;
  readonly rateLimits: RateLimits;

  publish?(
    req: PublishRequest,
    creds: Credentials,
    account: AccountIdentity
  ): Promise<PublishResult>;

  listRecentPosts(
    creds: Credentials,
    account: AccountIdentity,
    limit?: number,
    cursor?: string | null
  ): Promise<ListPostsResult>;

  getAccountInsights?(
    creds: Credentials,
    account: AccountIdentity,
    window?: '7d' | '30d' | '90d'
  ): Promise<AccountMetrics>;

  getMediaInsights(
    creds: Credentials,
    account: AccountIdentity,
    mediaId: string
  ): Promise<MediaMetrics>;

  getMediaFields?(
    creds: Credentials,
    account: AccountIdentity,
    mediaId: string
  ): Promise<Partial<Record<MetricName, number>>>;

  getComments?(
    creds: Credentials,
    account: AccountIdentity,
    mediaId: string,
    limit?: number
  ): Promise<{ data: CommentItem[]; total?: number }>;
}
