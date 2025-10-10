import axios from 'axios';
import { redisService } from './redis.js';
import * as crypto from 'crypto';
import { analyticsCache } from './analytics-cache.js';
import { PublisherCredentialsService } from './publisher-credentials.js';
import { prisma } from '../config/database.js';
import { uploadImageToS3, type ImageMetadata } from './s3-image.js';

export interface InstagramPost {
  id: string;
  caption: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url: string;
  permalink: string;
  timestamp: string;
  hashtags: string[];
  like_count?: number;
  comments_count?: number;
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
  hashtags: string[];
}

export interface PublishMediaResult {
  id: string;
  permalink: string;
  published: boolean;
}

export interface AccountInsights {
  followers: number;
  impressions: number;
  reach: number;
  profile_views?: number;
  website_clicks?: number;
}

export interface MediaInsights {
  impressions: number;
  reach: number;
  engagement: number;
  saves?: number;
  video_views?: number;
}

export interface AnalyticsOverview {
  data: AccountInsights;
  lastUpdated: string;
  fromCache: boolean;
}

export interface PostPerformance {
  posts: Array<{
    id: string;
    caption: string;
    impressions: number;
    engagement: number;
    media_url: string;
    posted_at: string;
  }>;
  lastUpdated: string;
}

// Webhook event type definitions (top-level to avoid class body syntax issues)
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

interface BrandData {
  id?: string;
  instagramAccessToken?: string | null;
  instagramAccountId?: string | null;
  instagramPageId?: string | null;
}

// Media insights types
interface MediaInsightValue {
  value?: number;
  end_time?: string;
}
interface MediaInsightMetric {
  name: string;
  period?: string;
  values?: MediaInsightValue[];
  title?: string;
  description?: string;
}

// Comments
interface InstagramComment {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
}

class InstagramService {
  private rateLimitWindow: Map<string, number> = new Map();
  constructor() {
    // Instagram service initialization
  }

  /**
   * Check if a brand has Instagram connected
   *
   * Breaking Change: This method now checks for both instagramAccountId and
   * instagramPageId instead of instagramAccessToken. Both IDs are required because:
   * - instagramAccountId: The Instagram Business Account ID used for API calls
   * - instagramPageId: The Facebook Page ID required for token management
   *
   * After Token Service integration, tokens are stored separately in the Token Service,
   * so we validate the connection by checking if both required IDs are present.
   */
  isConfigured(brand: BrandData): boolean {
    return !!(brand.instagramAccountId && brand.instagramPageId);
  }

  /**
   * Get credentials from Token Service
   */
  private async getCredentials(brand: BrandData) {
    if (!brand.id) {
      throw new Error('Brand ID is required to fetch credentials');
    }
    return PublisherCredentialsService.getCredentialsForBrand(brand.id);
  }

  /**
   * Get default profile picture URL when none is available
   */
  private getDefaultProfilePicture(): string {
    return 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y&s=150';
  }

  /**
   * Check rate limiting for Instagram API calls
   */
  private async checkRateLimit(identifier: string): Promise<boolean> {
    const key = `instagram_rate_limit:${identifier}`;

    if (redisService.isConnected()) {
      const count = await redisService.increment(key, 3600);
      return count ? count <= 200 : true;
    } else {
      // Fallback to in-memory rate limiting
      const now = Date.now();
      const windowStart = Math.floor(now / (60 * 60 * 1000)) * (60 * 60 * 1000);
      const windowKey = `${identifier}_${windowStart}`;

      const currentCount = this.rateLimitWindow.get(windowKey) || 0;
      if (currentCount >= 200) {
        return false;
      }

      this.rateLimitWindow.set(windowKey, currentCount + 1);

      // Clean up old windows
      for (const [key] of this.rateLimitWindow) {
        const keyTime = parseInt(key.split('_')[1] || '0');
        if (keyTime < windowStart - 60 * 60 * 1000) {
          this.rateLimitWindow.delete(key);
        }
      }

      return true;
    }
  }

  /**
   * Refresh Instagram access token
   */
  async refreshAccessToken(
    currentToken: string
  ): Promise<{ accessToken: string; expiresAt: string } | null> {
    try {
      const url = `https://graph.facebook.com/v23.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_APP_SECRET}&fb_exchange_token=${currentToken}`;

      const response = await axios.get(url);
      const data = response.data;

      if (data.access_token) {
        const expiresAt = data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000).toISOString()
          : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days default

        return {
          accessToken: data.access_token,
          expiresAt,
        };
      }

      return null;
    } catch (error) {
      console.error('Token refresh failed:', error);
      return null;
    }
  }

  /**
   * Validate webhook signature
   */
  static validateWebhookSignature(payload: string, signature: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', process.env.FACEBOOK_APP_SECRET || 'test_secret')
      .update(payload)
      .digest('hex');

    const receivedSignature = signature.replace('sha256=', '');
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(receivedSignature, 'hex')
    );
  }

  /**
   * Get Instagram profile information from Graph API
   */
  async getProfile(brand: BrandData): Promise<InstagramProfile> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not connected for this brand');
    }

    try {
      await this.checkRateLimit(brand.instagramAccountId!);

      // Get fresh credentials from Token Service
      const credentials = await this.getCredentials(brand);
      if (!credentials) {
        throw new Error('Failed to get Instagram credentials');
      }

      const fields =
        'id,username,name,biography,followers_count,media_count,profile_picture_url,website';
      const url = `https://graph.facebook.com/v23.0/${credentials.accountId || brand.instagramAccountId}?fields=${fields}&access_token=${credentials.accessToken}`;

      const response = await axios.get(url);
      const profile = response.data;

      return {
        id: profile.id,
        username: profile.username,
        account_type: 'BUSINESS', // Since we're using Instagram Business API, this is always a business account
        media_count: profile.media_count || 0,
        followers_count: profile.followers_count || 0,
        follows_count: profile.follows_count || 0,
        name: profile.name || '',
        biography: profile.biography || '',
        website: profile.website || '',
        profile_picture_url: profile.profile_picture_url || this.getDefaultProfilePicture(),
      };
    } catch (error) {
      console.error('Failed to fetch Instagram profile:', error);
      throw new Error(
        `Failed to fetch Instagram profile: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get recent posts from Instagram account
   */
  async getRecentPosts(brand: BrandData, limit: number = 25): Promise<InstagramPost[]> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not connected for this brand');
    }

    try {
      await this.checkRateLimit(brand.instagramAccountId!);

      // Get fresh credentials from Token Service
      const credentials = await this.getCredentials(brand);
      if (!credentials) {
        throw new Error('Failed to get Instagram credentials');
      }

      const fields =
        'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count';
      const url = `https://graph.facebook.com/v23.0/${credentials.accountId || brand.instagramAccountId}/media?fields=${fields}&limit=${limit}&access_token=${credentials.accessToken}`;

      const response = await axios.get(url);
      const mediaData = response.data.data || [];

      interface RawMediaItem {
        id: string;
        caption?: string;
        media_type?: string;
        media_url?: string;
        permalink?: string;
        timestamp?: string;
        like_count?: number;
        comments_count?: number;
      }
      return mediaData.map((media: RawMediaItem) => {
        // Extract hashtags from caption
        const caption = media.caption || '';
        const hashtagMatches = caption.match(/#\w+/g) || [];
        const hashtags = hashtagMatches.map((tag: string) => tag.substring(1));

        return {
          id: media.id,
          caption: caption,
          media_type: media.media_type,
          media_url: media.media_url,
          permalink: media.permalink,
          timestamp: media.timestamp,
          hashtags: hashtags,
          like_count: media.like_count,
          comments_count: media.comments_count,
        };
      });
    } catch (error) {
      console.error('Failed to fetch Instagram posts:', error);
      throw new Error(
        `Failed to fetch Instagram posts: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Publish media to Instagram
   */
  async publishMedia(brand: BrandData, request: PublishMediaRequest): Promise<PublishMediaResult> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not connected for this brand');
    }

    try {
      await this.checkRateLimit(brand.instagramAccountId!);

      // Get fresh credentials from Token Service
      const credentials = await this.getCredentials(brand);
      if (!credentials) {
        throw new Error('Failed to get Instagram credentials');
      }

      // Step 1: Create media container
      const caption = `${request.caption}\n\n${request.hashtags.map((tag) => `#${tag}`).join(' ')}`;
      const containerUrl = `https://graph.facebook.com/v23.0/${credentials.accountId || brand.instagramAccountId}/media`;

      const containerData = {
        image_url: request.cdnImageUrl,
        caption: caption,
        access_token: credentials.accessToken,
      };

      const containerResponse = await axios.post(containerUrl, containerData);
      const containerId = containerResponse.data.id;

      // Step 2: Publish the media container
      const publishUrl = `https://graph.facebook.com/v23.0/${credentials.accountId || brand.instagramAccountId}/media_publish`;
      const publishData = {
        creation_id: containerId,
        access_token: credentials.accessToken,
      };

      const publishResponse = await axios.post(publishUrl, publishData);
      const mediaId = publishResponse.data.id;

      // Step 3: Get the permalink
      const permalinkUrl = `https://graph.facebook.com/v23.0/${mediaId}?fields=permalink&access_token=${credentials.accessToken}`;
      const permalinkResponse = await axios.get(permalinkUrl);

      return {
        id: mediaId,
        permalink: permalinkResponse.data.permalink,
        published: true,
      };
    } catch (error) {
      console.error('Failed to publish Instagram media:', error);
      throw new Error(
        `Failed to publish Instagram media: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get media insights for analytics
   */
  async getMediaInsights(brand: BrandData, mediaId: string): Promise<MediaInsightMetric[]> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not connected for this brand');
    }

    try {
      await this.checkRateLimit(brand.instagramAccountId!);

      // Get fresh credentials from Token Service
      const credentials = await this.getCredentials(brand);
      if (!credentials) {
        throw new Error('Failed to get Instagram credentials');
      }

      const metrics = 'impressions,reach,engagement,likes,comments,saves,shares';
      const url = `https://graph.facebook.com/v23.0/${mediaId}/insights?metric=${metrics}&access_token=${credentials.accessToken}`;

      const response = await axios.get(url);
      const data = response.data?.data;
      return Array.isArray(data) ? (data as MediaInsightMetric[]) : [];
    } catch (error) {
      console.error('Failed to fetch media insights:', error);
      throw new Error(
        `Failed to fetch media insights: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get comments for a specific media post
   */
  async getPostComments(
    brand: BrandData,
    mediaId: string,
    limit: number = 25
  ): Promise<{ data: InstagramComment[]; total: number }> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not connected for this brand');
    }

    try {
      await this.checkRateLimit(brand.instagramAccountId!);

      // Get fresh credentials from Token Service
      const credentials = await this.getCredentials(brand);
      if (!credentials) {
        throw new Error('Failed to get Instagram credentials');
      }

      // First, get the total count
      const countUrl = `https://graph.facebook.com/v23.0/${mediaId}?fields=comments_count&access_token=${credentials.accessToken}`;
      const countResponse = await axios.get(countUrl);
      const total = countResponse.data.comments_count || 0;

      // Then get the actual comments
      const url = `https://graph.facebook.com/v23.0/${mediaId}/comments?fields=id,text,username,timestamp,like_count&limit=${limit}&access_token=${credentials.accessToken}`;
      const response = await axios.get(url);
      const commentsRaw = Array.isArray(response.data?.data) ? response.data.data : [];
      const comments: InstagramComment[] = commentsRaw.map((c: unknown) => {
        const obj = c as Record<string, unknown>;
        return {
          id: String(obj.id ?? ''),
          text: typeof obj.text === 'string' ? obj.text : undefined,
          username: typeof obj.username === 'string' ? obj.username : undefined,
          timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : undefined,
          like_count: typeof obj.like_count === 'number' ? obj.like_count : undefined,
        };
      });
      return { data: comments, total };
    } catch (error) {
      console.error('Failed to fetch post comments:', error);
      throw new Error(
        `Failed to fetch post comments: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get account insights with caching
   */
  async getAccountInsights(
    brand: BrandData,
    timeRange: '7d' | '30d' | '90d' = '7d'
  ): Promise<AnalyticsOverview> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not configured for this brand');
    }

    const today = new Date().toISOString().split('T')[0];
    const cacheKey = `${brand.instagramAccountId || 'unknown'}_${timeRange}`;

    // Check cache first
    const cachedData = await analyticsCache.getAccountInsights(cacheKey!, today!);
    if (cachedData) {
      return {
        data: cachedData,
        lastUpdated: new Date().toISOString(),
        fromCache: true,
      };
    }

    // Check rate limit before API call
    const canMakeRequest = await this.checkRateLimit(brand.instagramAccountId!);
    if (!canMakeRequest) {
      throw new Error('Rate limit exceeded for Instagram API');
    }

    try {
      // Increment rate limit counter
      await analyticsCache.incrementRateLimit(cacheKey);

      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
      startDate.setDate(endDate.getDate() - days);

      // Get fresh credentials from Token Service
      const credentials = await this.getCredentials(brand);
      if (!credentials) {
        throw new Error('Failed to get Instagram credentials');
      }

      // Get follower count (lifetime metric)
      const followerUrl = `https://graph.facebook.com/v23.0/${credentials.accountId || brand.instagramAccountId}?fields=followers_count&access_token=${credentials.accessToken}`;
      const followerResponse = await axios.get(followerUrl);

      // Get insights for the time range
      const metricsUrl = `https://graph.facebook.com/v23.0/${credentials.accountId || brand.instagramAccountId}/insights?metric=impressions,reach,profile_views&period=day&since=${startDate.toISOString().split('T')[0]}&until=${endDate.toISOString().split('T')[0]}&access_token=${credentials.accessToken}`;
      const insightsResponse = await axios.get(metricsUrl);

      // Process insights data
      const insights = insightsResponse.data.data;
      const processedData: AccountInsights = {
        followers: followerResponse.data.followers_count || 0,
        impressions: this.aggregateInsightValues(insights, 'impressions'),
        reach: this.aggregateInsightValues(insights, 'reach'),
        profile_views: this.aggregateInsightValues(insights, 'profile_views'),
      };

      // Cache the result
      await analyticsCache.setAccountInsights(cacheKey!, today!, processedData);

      return {
        data: processedData,
        lastUpdated: new Date().toISOString(),
        fromCache: false,
      };
    } catch (error) {
      console.error('Failed to fetch account insights:', error);
      throw new Error(
        `Failed to fetch account insights: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get recent posts with performance data
   */
  async getRecentPostsPerformance(brand: BrandData, limit: number = 10): Promise<PostPerformance> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not configured for this brand');
    }

    // Check cache first
    const cachedPosts = await analyticsCache.getRecentPosts(brand.instagramAccountId!);
    if (cachedPosts) {
      type CachedPost = {
        id?: unknown;
        caption?: unknown;
        impressions?: unknown;
        engagement?: unknown;
        media_url?: unknown;
        posted_at?: unknown;
      };
      const posts = cachedPosts.posts
        .filter(
          (
            p: CachedPost
          ): p is Required<
            Pick<
              PostPerformance['posts'][number],
              'id' | 'caption' | 'impressions' | 'engagement' | 'media_url' | 'posted_at'
            >
          > =>
            typeof p.id === 'string' &&
            typeof p.caption === 'string' &&
            typeof p.impressions === 'number' &&
            typeof p.engagement === 'number' &&
            typeof p.media_url === 'string' &&
            typeof p.posted_at === 'string'
        )
        .slice(0, limit)
        .map((p) => ({
          id: p.id,
          caption: p.caption,
          impressions: p.impressions,
          engagement: p.engagement,
          media_url: p.media_url,
          posted_at: p.posted_at,
        }));
      return {
        posts: posts,
        lastUpdated: new Date().toISOString(),
      };
    }

    // Check rate limit
    const canMakeRequest = await this.checkRateLimit(brand.instagramAccountId!);
    if (!canMakeRequest) {
      throw new Error('Rate limit exceeded for Instagram API');
    }

    try {
      // Get fresh credentials from Token Service
      const credentials = await this.getCredentials(brand);
      if (!credentials) {
        throw new Error('Failed to get Instagram credentials');
      }

      // Get recent media
      const mediaUrl = `https://graph.facebook.com/v23.0/${credentials.accountId || brand.instagramAccountId}/media?fields=id,caption,media_type,media_url,permalink,timestamp&limit=${limit}&access_token=${credentials.accessToken}`;
      const mediaResponse = await axios.get(mediaUrl);

      const posts = [];

      // Get insights for each media item
      for (const media of mediaResponse.data.data) {
        try {
          const insightsUrl = `https://graph.facebook.com/v23.0/${media.id}/insights?metric=impressions,reach,engagement&access_token=${credentials.accessToken}`;
          const insightsResponse = await axios.get(insightsUrl);

          const insights = insightsResponse.data.data;
          posts.push({
            id: media.id,
            caption: media.caption || '',
            impressions: this.getInsightValue(insights, 'impressions'),
            engagement: this.getInsightValue(insights, 'engagement'),
            media_url: media.media_url,
            posted_at: media.timestamp,
          });
        } catch {
          // If insights fail for individual post, include it without metrics
          posts.push({
            id: media.id,
            caption: media.caption || '',
            impressions: 0,
            engagement: 0,
            media_url: media.media_url,
            posted_at: media.timestamp,
          });
        }
      }

      // Cache the results
      await analyticsCache.setRecentPosts(brand.instagramAccountId!, { posts });

      return {
        posts,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Failed to fetch recent posts performance:', error);
      throw new Error(
        `Failed to fetch recent posts performance: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Force refresh analytics data (bypass cache)
   */
  async refreshAnalyticsData(brand: BrandData): Promise<{
    success: boolean;
    message: string;
    nextRefreshAllowed: string;
  }> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not configured for this brand');
    }

    // Check if user is within rate limits
    const rateLimitCount = await analyticsCache.getRateLimit(brand.instagramAccountId!);
    if (rateLimitCount >= 180) {
      // Leave some buffer before 200 limit
      const nextRefresh = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      return {
        success: false,
        message: 'Rate limit nearly exceeded. Please wait before refreshing again.',
        nextRefreshAllowed: nextRefresh.toISOString(),
      };
    }

    try {
      // Clear existing cache for this brand
      // todayStr removed (unused)
      await analyticsCache.clear(); // This clears all analytics cache - in production you'd be more selective

      // Force fresh data fetch
      await this.getAccountInsights(brand, '7d');
      await this.getRecentPostsPerformance(brand, 10);

      return {
        success: true,
        message: 'Analytics data refreshed successfully',
        nextRefreshAllowed: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 minutes
      };
    } catch (error) {
      console.error('Failed to refresh analytics data:', error);
      return {
        success: false,
        message: `Failed to refresh data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        nextRefreshAllowed: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
    }
  }

  /**
   * Get analytics cache status
   */
  async getAnalyticsCacheStatus(brand: BrandData): Promise<{
    lastUpdated: string | null;
    cacheAge: number;
    rateLimitRemaining: number;
  }> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not configured for this brand');
    }

    const status = await analyticsCache.getCacheStatus(brand.instagramAccountId!);
    const rateLimitCount = await analyticsCache.getRateLimit(brand.instagramAccountId!);

    return {
      lastUpdated: status.lastUpdated,
      cacheAge: status.accountDataAge,
      rateLimitRemaining: Math.max(0, 200 - rateLimitCount),
    };
  }

  /**
   * Helper method to aggregate insight values across time periods
   */
  private aggregateInsightValues(
    insights: Array<{ name?: string; values?: Array<{ value?: number }> }>,
    metricName: string
  ): number {
    const metric = insights.find((insight) => insight.name === metricName);
    if (!metric || !Array.isArray(metric.values)) return 0;
    return metric.values.reduce((sum, v) => sum + (typeof v.value === 'number' ? v.value : 0), 0);
  }

  /**
   * Helper method to get single insight value
   */
  private getInsightValue(
    insights: Array<{ name?: string; values?: Array<{ value?: number }> }>,
    metricName: string
  ): number {
    const metric = insights.find((insight) => insight.name === metricName);
    const first = metric?.values?.[0];
    return typeof first?.value === 'number' ? first.value : 0;
  }

  /**
   * Handle webhook event
   */
  async handleWebhookEvent(event: InstagramWebhookEvent): Promise<void> {
    try {
      // Process Instagram webhook events
      console.log('Processing Instagram webhook event:', JSON.stringify(event));

      // Implementation depends on specific webhook events you want to handle
      // Common events: media published, comments, mentions, etc.
    } catch (error: unknown) {
      console.error(
        'Failed to handle webhook event:',
        JSON.stringify(error, Object.getOwnPropertyNames(error as object))
      );
    }
  }

  /**
   * Sync published Instagram posts to database
   * Fetches recent posts and stores them as published content
   *
   * @param brand - Brand to sync for
   * @param options - Sync configuration
   * @returns Summary of sync results
   */
  async syncPublishedPosts(
    brand: BrandData,
    options: {
      maxPosts?: number;
      maxDays?: number;
      skipExisting?: boolean;
    } = {}
  ): Promise<{
    synced: number;
    skipped: number;
    failed: number;
    errors: string[];
  }> {
    const { maxPosts = 100, maxDays = 30, skipExisting = true } = options;

    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not connected for this brand');
    }

    // Check rate limit
    await this.checkRateLimit(brand.instagramAccountId!);

    const results = {
      synced: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
    };

    try {
      const startTime = Date.now();
      console.log(`[Instagram Sync] Started for brand ${brand.id}`, {
        brandId: brand.id,
        maxPosts,
        maxDays,
      });

      // Calculate date threshold
      const dateThreshold = new Date();
      dateThreshold.setDate(dateThreshold.getDate() - maxDays);

      // Fetch posts with pagination
      const posts: InstagramPost[] = [];
      let cursor: string | null = null;
      let hasMore = true;

      while (hasMore && posts.length < maxPosts) {
        const batchSize = Math.min(100, maxPosts - posts.length);
        const batch = await this.getRecentPostsPaginated(brand, batchSize, cursor);

        // Filter by date threshold
        const recentPosts = batch.data.filter((post) => {
          if (!post.timestamp) return true;
          return new Date(post.timestamp) >= dateThreshold;
        });

        posts.push(...recentPosts);

        // Check if we should continue
        hasMore = batch.hasMore && posts.length < maxPosts;
        cursor = batch.cursor;

        // Stop if we've gone past the date threshold
        if (recentPosts.length < batch.data.length) {
          hasMore = false;
        }
      }

      console.log(`[Instagram Sync] 📥 Fetched ${posts.length} posts for brand ${brand.id}`, {
        brandId: brand.id,
        totalPosts: posts.length,
        dateThreshold: dateThreshold.toISOString(),
      });

      // Process each post
      for (const post of posts) {
        try {
          await this.syncSinglePost(brand, post, skipExisting);
          results.synced++;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          if (message.includes('already exists')) {
            results.skipped++;
          } else {
            results.failed++;
            results.errors.push(`Post ${post.id}: ${message}`);
            console.error(`[Instagram Sync] ❌ Failed to sync post ${post.id}:`, {
              postId: post.id,
              brandId: brand.id,
              error: message,
            });
          }
        }
      }

      const duration = Date.now() - startTime;

      // Store sync metadata in Redis for status endpoint
      const syncMetadata = {
        brandId: brand.id,
        timestamp: new Date().toISOString(),
        duration,
        results,
        options: { maxPosts, maxDays },
      };

      await redisService.set(
        `instagram_sync_metadata:${brand.id}`,
        JSON.stringify(syncMetadata),
        86400 // 24 hour TTL
      );

      console.log(`[Instagram Sync] ✅ Completed for brand ${brand.id}`, {
        brandId: brand.id,
        duration: `${duration}ms`,
        durationSeconds: (duration / 1000).toFixed(2),
        results,
        successRate: `${((results.synced / (results.synced + results.failed + results.skipped)) * 100).toFixed(1)}%`,
        postsPerSecond: (posts.length / (duration / 1000)).toFixed(2),
      });

      return results;
    } catch (error) {
      console.error('Failed to sync Instagram posts:', error);
      throw error;
    }
  }

  /**
   * Get recent posts with pagination support
   *
   * @param brand - Brand to fetch for
   * @param limit - Number of posts per request (max 100)
   * @param cursor - Pagination cursor
   * @returns Posts data with pagination info
   */
  async getRecentPostsPaginated(
    brand: BrandData,
    limit: number = 25,
    cursor?: string | null
  ): Promise<{
    data: InstagramPost[];
    hasMore: boolean;
    cursor: string | null;
  }> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not connected for this brand');
    }

    const credentials = await this.getCredentials(brand);
    if (!credentials) {
      throw new Error('Failed to get Instagram credentials');
    }

    const fields = 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count';
    let url = `https://graph.facebook.com/v23.0/${credentials.accountId || brand.instagramAccountId}/media?fields=${fields}&limit=${limit}&access_token=${credentials.accessToken}`;

    if (cursor) {
      url += `&after=${cursor}`;
    }

    const response = await axios.get(url);
    const mediaData = response.data.data || [];
    const paging = response.data.paging || {};

    interface InstagramMediaResponse {
      id: string;
      caption?: string;
      media_type?: string;
      media_url?: string;
      permalink?: string;
      timestamp?: string;
      like_count?: number;
      comments_count?: number;
    }

    const posts: InstagramPost[] = mediaData.map((media: InstagramMediaResponse) => {
      // Extract hashtags from caption
      const caption = media.caption || '';
      const hashtagMatches = caption.match(/#\w+/g) || [];
      const hashtags = hashtagMatches.map((tag: string) => tag.substring(1));

      return {
        id: media.id,
        caption: caption,
        media_type: media.media_type || 'IMAGE',
        media_url: media.media_url || '',
        permalink: media.permalink || '',
        timestamp: media.timestamp || '',
        hashtags: hashtags,
        like_count: media.like_count,
        comments_count: media.comments_count,
      };
    });

    return {
      data: posts,
      hasMore: !!paging.next,
      cursor: paging.cursors?.after || null,
    };
  }

  /**
   * Sync a single post to database (Phase 2: with image download)
   *
   * @param brand - Brand to sync for
   * @param post - Instagram post data
   * @param skipExisting - Whether to skip existing posts
   */
  private async syncSinglePost(
    brand: BrandData,
    post: InstagramPost,
    skipExisting: boolean
  ): Promise<void> {
    // Check if post already exists
    if (skipExisting) {
      const existing = await prisma.content.findFirst({
        where: {
          brandId: brand.id,
          instagramPostId: post.id,
        },
      });

      if (existing) {
        throw new Error('Post already exists');
      }
    }

    // Skip non-image posts
    if (post.media_type !== 'IMAGE' && post.media_type !== 'CAROUSEL_ALBUM') {
      console.log(`Skipping ${post.media_type} post ${post.id}`);
      throw new Error(`Unsupported media type: ${post.media_type}`);
    }

    // Download image to S3
    let s3ImageKey: string | null = null;
    let imageRegion: string | null = null;
    let retentionExpiresAt: Date | null = null;
    let imageDownloadFailed = false;

    if (post.media_url) {
      try {
        const tempContentId = `import-${post.id}`;
        const imageMetadata: ImageMetadata = {
          contentId: tempContentId,
          brandId: brand.id!,
          generatedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
          source: 'dalle3', // Generic source indicator for imported images
          originalPrompt: post.caption || 'Imported from Instagram',
        };

        const imageStartTime = Date.now();
        const uploadResult = await uploadImageToS3(post.media_url, imageMetadata);

        s3ImageKey = uploadResult.s3Key;
        imageRegion = uploadResult.region;
        retentionExpiresAt = uploadResult.retentionExpiresAt;

        const imageDuration = Date.now() - imageStartTime;
        console.log(`[Instagram Sync] 🖼️  Image uploaded to S3: ${s3ImageKey}`, {
          postId: post.id,
          s3Key: s3ImageKey,
          region: imageRegion,
          duration: `${imageDuration}ms`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Instagram Sync] ⚠️  Failed to download image for post ${post.id}:`, {
          postId: post.id,
          mediaUrl: post.media_url,
          error: message,
        });
        imageDownloadFailed = true;
        // Continue without image - store post metadata only
      }
    } else {
      console.log(`[Instagram Sync] ℹ️  No media URL for post ${post.id}`);
      imageDownloadFailed = true;
    }

    // Create content record
    const contentData = {
      brandId: brand.id!,
      caption: post.caption,
      hashtags: post.hashtags || [],
      status: 'published' as const,
      instagramPostId: post.id,
      instagramPermalink: post.permalink,
      postedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
      s3ImageKey,
      imageRegion,
      retentionExpiresAt,
      generationParams: {
        source: 'instagram_import',
        importedAt: new Date().toISOString(),
        originalPostDate: post.timestamp,
        mediaType: post.media_type,
        hasImage: !!s3ImageKey,
        imageDownloadFailed,
      },
      analytics: {
        like_count: post.like_count || 0,
        comments_count: post.comments_count || 0,
      },
    };

    await prisma.content.create({
      data: contentData,
    });

    console.log(`[Instagram Sync] ✨ Synced post ${post.id}`, {
      postId: post.id,
      brandId: brand.id,
      hasImage: !!s3ImageKey,
      hasHashtags: (post.hashtags?.length || 0) > 0,
      engagement: {
        likes: post.like_count || 0,
        comments: post.comments_count || 0,
      },
    });
  }
}

export const instagramService = new InstagramService();
