import axios from 'axios';
import { logger as baseLogger } from '@postolio/logger';
import { formatError } from '../utils/logging.js';
import { redisService } from './redis.js';
import * as crypto from 'crypto';
import { PublisherCredentialsService } from './publisher-credentials.js';
import { prisma } from '../config/database.js';
import type { Prisma } from '@postolio/database';
import { importImageFromExternalUrl, attachAssetToContent } from './assets-media.js';
import type { AssetRecord } from '@postolio/assets-client';
import { extractHashtagsFromCaption } from '../utils/hashtag-extractor.js';

// Centralize Facebook Graph API version to ease upgrades
const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
const fbGraph = (path: string) => `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

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

const instagramLogger = baseLogger.child({ module: 'instagram-service' });

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

export interface InstagramAudienceDemographicsResult {
  status: InstagramAudienceDemographicsStatus;
  demographics?: InstagramAudienceDemographics;
  errorMessage?: string;
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
  id: string;
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
  async isConfigured(brandOrId: BrandData | string): Promise<boolean> {
    const brandId = typeof brandOrId === 'string' ? brandOrId : brandOrId.id;
    const account = await prisma.socialAccount.findFirst({
      where: { brandId, platform: 'instagram' },
      select: { id: true, metadata: true },
    });

    if (!account) return false;

    const metadata = (account.metadata || {}) as Record<string, unknown>;
    if (metadata && typeof metadata === 'object' && (metadata as any).disconnected) {
      return false;
    }

    return true;
  }

  private async getCredentialsOrThrow(brandOrId: BrandData | string) {
    const brandId = typeof brandOrId === 'string' ? brandOrId : brandOrId.id;
    const credentials = await PublisherCredentialsService.getCredentialsForBrand(brandId);
    if (!credentials || !credentials.accessToken || !credentials.accountId) {
      throw new Error('Failed to get Instagram credentials');
    }
    return credentials;
  }

  private async getCredentialsOrThrowForSocialAccount(socialAccountId: string) {
    const credentials =
      await PublisherCredentialsService.getCredentialsForSocialAccount(socialAccountId);
    if (!credentials || !credentials.accessToken || !credentials.accountId) {
      throw new Error('Failed to get Instagram credentials');
    }
    return credentials;
  }

  // ===============================
  // Instagram DMs (Messaging) API
  // ===============================
  /**
   * Try multiple Graph paths and return the first successful data[] response
   */
  private async tryGraphGet<T = any>(paths: string[]): Promise<T | null> {
    for (const p of paths) {
      try {
        const res = await axios.get(fbGraph(p));
        const data = (res.data as any)?.data ?? null;
        if (Array.isArray(data)) return res.data as T;
        if ((res.data as any)?.id || (res.data as any)?.messages) return res.data as T;
      } catch {
        // ignore and try next
      }
    }
    return null;
  }

  async listDmThreads(
    brand: BrandData | string,
    opts: { limit?: number; after?: string } = {}
  ): Promise<{
    supported: boolean;
    threads: Array<{ id: string; updated_time?: string; participants?: any[] }>;
    paging?: any;
  }> {
    if (!(await this.isConfigured(brand)))
      throw new Error('Instagram not connected for this brand');
    const limit = opts.limit ?? 25;
    const credentials = await this.getCredentialsOrThrow(brand);
    await this.checkRateLimit(String(credentials.accountId));

    const qs = [`limit=${limit}`, `access_token=${credentials.accessToken}`];
    if (opts.after) qs.push(`after=${encodeURIComponent(opts.after)}`);

    const paths = [
      `${credentials.accountId}/conversations?${qs.join('&')}`,
      `${credentials.pageId}/conversations?platform=instagram&${qs.join('&')}`,
    ].filter(Boolean) as string[];

    const res = await this.tryGraphGet<{ data: any[]; paging?: any }>(paths);
    if (!res) return { supported: false, threads: [] };
    const threads = (res.data || []).map((c: any) => ({
      id: String(c.id || ''),
      updated_time: c.updated_time,
      participants: (c.participants && c.participants.data) || c.participants || [],
    }));
    return { supported: true, threads, paging: res.paging };
  }

  async getDmThreadMessages(
    brand: BrandData | string,
    threadId: string,
    opts: { limit?: number; before?: string } = {}
  ): Promise<{
    supported: boolean;
    messages: Array<{ id: string; message?: string; from?: any; created_time?: string }>;
    paging?: any;
  }> {
    if (!(await this.isConfigured(brand)))
      throw new Error('Instagram not connected for this brand');
    const limit = opts.limit ?? 50;
    const credentials = await this.getCredentialsOrThrow(brand);
    await this.checkRateLimit(String(credentials.accountId));

    const qs = [
      `limit=${limit}`,
      `access_token=${credentials.accessToken}`,
      `fields=from,to,message,created_time,id`,
    ];
    if (opts.before) qs.push(`before=${encodeURIComponent(opts.before)}`);
    const res = await this.tryGraphGet<{ data: any[]; paging?: any }>([
      `${threadId}/messages?${qs.join('&')}`,
      `${threadId}?fields=messages{from,to,message,created_time,id}&${qs
        .filter((q) => !q.startsWith('fields='))
        .join('&')}`,
    ]);
    if (!res) return { supported: false, messages: [] };
    const rows = (res as any).data ? (res as any).data : (res as any).messages?.data || [];
    const messages = rows.map((m: any) => ({
      id: String(m.id || ''),
      message: m.message,
      from: m.from,
      created_time: m.created_time,
    }));
    return { supported: true, messages, paging: (res as any).paging };
  }

  /** Determine if we can send within 24h of last inbound user message */
  private isWithin24hWindow(
    messages: Array<{ from?: any; created_time?: string }>,
    selfIds: string[]
  ): boolean {
    const lastInbound = messages.find(
      (m) => m.created_time && (!m.from || !selfIds.includes(String(m.from.id || '')))
    );
    if (!lastInbound?.created_time) return true; // If unknown, allow
    const ts = new Date(lastInbound.created_time).getTime();
    return Date.now() - ts <= 24 * 60 * 60 * 1000;
  }

  async sendDmMessage(
    brand: BrandData | string,
    threadId: string,
    text: string
  ): Promise<{ supported: boolean; success: boolean; errorCode?: string; message?: string }> {
    if (!(await this.isConfigured(brand)))
      throw new Error('Instagram not connected for this brand');
    if (!text || !text.trim()) throw new Error('Message must not be empty');
    const credentials = await this.getCredentialsOrThrow(brand);
    await this.checkRateLimit(String(credentials.accountId));

    // Enforce 24h window: fetch a few recent messages
    const recent = await this.getDmThreadMessages(brand, threadId, { limit: 20 });
    if (!recent.supported) return { supported: false, success: false };
    const selfIds = [credentials.accountId, credentials.pageId].filter(Boolean).map(String);
    const inWindow = this.isWithin24hWindow(recent.messages, selfIds as string[]);
    if (!inWindow) {
      return {
        supported: true,
        success: false,
        errorCode: 'WINDOW_CLOSED',
        message: '24-hour messaging window has expired',
      };
    }

    // Attempt to send via conversation messages edge
    try {
      const res = await axios.post(fbGraph(`${threadId}/messages`), {
        message: text,
        access_token: credentials.accessToken,
      });
      const ok = Boolean((res.data as any)?.success || (res.data as any)?.id);
      return { supported: true, success: ok };
    } catch (error) {
      const msg = (error as any)?.response?.data?.error?.message || (error as Error).message;
      if (/Unsupported|not allowed|Unknown path|(#|code)\s?100/i.test(msg)) {
        return { supported: false, success: false, message: msg };
      }
      throw new Error(`Failed to send DM: ${msg}`);
    }
  }

  /**
   * Send a direct message to an Instagram user (for DM automation)
   * This method initiates or continues a conversation with a user
   *
   * @param brand - Brand sending the message
   * @param recipientId - Instagram user ID (IGSID) of the recipient
   * @param message - Message text to send
   * @returns Message ID from Instagram
   *
   * Note: Instagram's 24-hour messaging window applies. You can only message users who have
   * interacted with your content (comment, DM, story mention) in the last 24 hours.
   */
  async sendDirectMessage(
    brand: BrandData | string,
    recipientId: string,
    message: string
  ): Promise<{ messageId: string }> {
    if (!(await this.isConfigured(brand))) {
      throw new Error('Instagram not connected for this brand');
    }
    if (!message || !message.trim()) throw new Error('Message must not be empty');
    if (!recipientId) throw new Error('Recipient ID is required');

    try {
      const credentials = await this.getCredentialsOrThrow(brand);
      await this.checkRateLimit(String(credentials.accountId));

      // Send DM via Instagram Graph API
      const url = fbGraph(`me/messages`);
      const payload = {
        recipient: { id: recipientId },
        message: { text: message },
        access_token: credentials.accessToken,
      };

      const response = await axios.post(url, payload);
      const messageId = String(
        (response.data as any)?.message_id || (response.data as any)?.id || ''
      );

      if (!messageId) {
        throw new Error('Instagram did not return a message ID');
      }

      instagramLogger.info('DM sent via automation', {
        brandId: typeof brand === 'string' ? brand : brand.id,
        recipientId,
        messageId,
      });

      return { messageId };
    } catch (error) {
      const errorMsg = (error as any)?.response?.data?.error?.message || (error as Error).message;

      // Check for 24-hour window violation
      if (/24.hour|messaging.window|Cannot message/i.test(errorMsg)) {
        instagramLogger.warn('24-hour messaging window expired', {
          brandId: typeof brand === 'string' ? brand : brand.id,
          recipientId,
          error: errorMsg,
        });
        throw new Error('Cannot send message: 24-hour messaging window has expired');
      }

      // Check for rate limiting
      if (/rate.limit|too.many/i.test(errorMsg)) {
        instagramLogger.error('Instagram API rate limit exceeded', {
          brandId: typeof brand === 'string' ? brand : brand.id,
          error: errorMsg,
        });
        throw new Error('Rate limit exceeded. Please try again later.');
      }

      instagramLogger.error('Failed to send direct message', formatError(error));
      throw new Error(`Failed to send direct message: ${errorMsg}`);
    }
  }

  async sendDirectMessageForSocialAccount(
    socialAccountId: string,
    recipientId: string,
    message: string
  ): Promise<{ messageId: string }> {
    if (!message || !message.trim()) throw new Error('Message must not be empty');
    if (!recipientId) throw new Error('Recipient ID is required');

    try {
      const credentials = await this.getCredentialsOrThrowForSocialAccount(socialAccountId);
      await this.checkRateLimit(String(credentials.accountId));

      const url = fbGraph(`me/messages`);
      const payload = {
        recipient: { id: recipientId },
        message: { text: message },
        access_token: credentials.accessToken,
      };

      const response = await axios.post(url, payload);
      const messageId = String(
        (response.data as any)?.message_id || (response.data as any)?.id || ''
      );

      if (!messageId) {
        throw new Error('Instagram did not return a message ID');
      }

      instagramLogger.info('DM sent via automation', {
        socialAccountId,
        recipientId,
        messageId,
      });

      return { messageId };
    } catch (error) {
      const errorMsg = (error as any)?.response?.data?.error?.message || (error as Error).message;

      if (/24.hour|messaging.window|Cannot message/i.test(errorMsg)) {
        instagramLogger.warn('24-hour messaging window expired', {
          socialAccountId,
          recipientId,
          error: errorMsg,
        });
        throw new Error('Cannot send message: 24-hour messaging window has expired');
      }

      if (/rate.limit|too.many/i.test(errorMsg)) {
        instagramLogger.error('Instagram API rate limit exceeded', {
          socialAccountId,
          error: errorMsg,
        });
        throw new Error('Rate limit exceeded. Please try again later.');
      }

      instagramLogger.error('Failed to send direct message', formatError(error));
      throw new Error(`Failed to send direct message: ${errorMsg}`);
    }
  }

  /**
   * Reply to a comment directly (for DM automation)
   * Uses the /{comment-id}/replies endpoint which doesn't require media ID
   *
   * @param brand - Brand replying to the comment
   * @param commentId - Instagram comment ID
   * @param message - Reply text
   * @returns ID of the reply comment
   */
  async replyToCommentDirect(
    brand: BrandData | string,
    commentId: string,
    message: string
  ): Promise<{ commentId: string }> {
    if (!(await this.isConfigured(brand))) {
      throw new Error('Instagram not connected for this brand');
    }
    if (!message || !message.trim()) throw new Error('Reply message must not be empty');
    if (!commentId) throw new Error('Comment ID is required');

    try {
      const credentials = await this.getCredentialsOrThrow(brand);
      await this.checkRateLimit(String(credentials.accountId));

      // Reply to comment via Graph API
      const url = fbGraph(`${commentId}/replies`);
      const payload = {
        message,
        access_token: credentials.accessToken,
      };

      const response = await axios.post(url, payload);
      const replyId = String((response.data as any)?.id || '');

      if (!replyId) {
        throw new Error('Instagram did not return a comment ID');
      }

      instagramLogger.info('Comment reply sent via automation', {
        brandId: typeof brand === 'string' ? brand : brand.id,
        commentId,
        replyId,
      });

      return { commentId: replyId };
    } catch (error) {
      const errorMsg = (error as any)?.response?.data?.error?.message || (error as Error).message;

      instagramLogger.error('Failed to reply to comment', formatError(error));
      throw new Error(`Failed to reply to comment: ${errorMsg}`);
    }
  }

  async replyToCommentDirectForSocialAccount(
    socialAccountId: string,
    commentId: string,
    message: string
  ): Promise<{ commentId: string }> {
    if (!message || !message.trim()) throw new Error('Reply message must not be empty');
    if (!commentId) throw new Error('Comment ID is required');

    try {
      const credentials = await this.getCredentialsOrThrowForSocialAccount(socialAccountId);
      await this.checkRateLimit(String(credentials.accountId));

      const url = fbGraph(`${commentId}/replies`);
      const payload = {
        message,
        access_token: credentials.accessToken,
      };

      const response = await axios.post(url, payload);
      const replyId = String((response.data as any)?.id || '');

      if (!replyId) {
        throw new Error('Instagram did not return a comment ID');
      }

      instagramLogger.info('Comment reply sent via automation', {
        socialAccountId,
        commentId,
        replyId,
      });

      return { commentId: replyId };
    } catch (error) {
      const errorMsg = (error as any)?.response?.data?.error?.message || (error as Error).message;

      instagramLogger.error('Failed to reply to comment', formatError(error));
      throw new Error(`Failed to reply to comment: ${errorMsg}`);
    }
  }

  /**
   * Reply to a specific comment on a media item
   * Instagram Graph API accepts replies by posting a new comment to the media
   * with the `reply_to_comment_id` parameter.
   */
  async replyToComment(
    brand: BrandData | string,
    mediaId: string,
    commentId: string,
    message: string
  ): Promise<{ id: string }> {
    if (!(await this.isConfigured(brand))) {
      throw new Error('Instagram not connected for this brand');
    }
    if (!message || !message.trim()) throw new Error('Reply message must not be empty');

    try {
      const credentials = await this.getCredentialsOrThrow(brand);
      await this.checkRateLimit(String(credentials.accountId));

      const url = fbGraph(`${mediaId}/comments`);
      const payload = {
        message,
        reply_to_comment_id: commentId,
        access_token: credentials.accessToken,
      } as const;
      const res = await axios.post(url, payload);
      const id = String((res.data as any)?.id || '');
      if (!id) throw new Error('Instagram did not return a comment id');
      return { id };
    } catch (error) {
      instagramLogger.error('Failed to reply to comment', formatError(error));
      throw new Error(
        `Failed to reply to comment: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async replyToCommentForSocialAccount(
    socialAccountId: string,
    mediaId: string,
    commentId: string,
    message: string
  ): Promise<{ id: string }> {
    if (!message || !message.trim()) throw new Error('Reply message must not be empty');

    try {
      const credentials = await this.getCredentialsOrThrowForSocialAccount(socialAccountId);
      await this.checkRateLimit(String(credentials.accountId));

      const url = fbGraph(`${mediaId}/comments`);
      const payload = {
        message,
        reply_to_comment_id: commentId,
        access_token: credentials.accessToken,
      } as const;
      const res = await axios.post(url, payload);
      const id = String((res.data as any)?.id || '');
      if (!id) throw new Error('Instagram did not return a comment id');
      return { id };
    } catch (error) {
      instagramLogger.error('Failed to reply to comment', formatError(error));
      throw new Error(
        `Failed to reply to comment: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /** Hide/Unhide a comment */
  async setCommentHidden(
    brand: BrandData | string,
    commentId: string,
    hide: boolean
  ): Promise<{ success: boolean }> {
    if (!(await this.isConfigured(brand)))
      throw new Error('Instagram not connected for this brand');
    try {
      const credentials = await this.getCredentialsOrThrow(brand);
      await this.checkRateLimit(String(credentials.accountId));

      // POST /{ig-comment-id}?hide=true|false
      const url = fbGraph(
        `${commentId}?hide=${hide ? 'true' : 'false'}&access_token=${credentials.accessToken}`
      );
      const res = await axios.post(url);
      const ok = Boolean((res.data as any)?.success ?? true);
      return { success: ok };
    } catch (error) {
      instagramLogger.error('Failed to set comment hidden', formatError(error));
      throw new Error(
        `Failed to ${hide ? 'hide' : 'unhide'} comment: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /** Delete a comment */
  async deleteComment(brand: BrandData | string, commentId: string): Promise<{ success: boolean }> {
    if (!(await this.isConfigured(brand)))
      throw new Error('Instagram not connected for this brand');
    try {
      const credentials = await this.getCredentialsOrThrow(brand);
      await this.checkRateLimit(String(credentials.accountId));

      const url = fbGraph(`${commentId}?access_token=${credentials.accessToken}`);
      await axios.delete(url);
      return { success: true };
    } catch (error) {
      instagramLogger.error('Failed to delete comment', formatError(error));
      throw new Error(
        `Failed to delete comment: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Like a comment (best-effort). The Instagram Graph API may not support
   * liking comments programmatically for all accounts. We attempt the
   * endpoint and surface an explicit error if unsupported.
   */
  async likeComment(brand: BrandData | string, commentId: string): Promise<{ success: boolean }> {
    if (!(await this.isConfigured(brand)))
      throw new Error('Instagram not connected for this brand');
    try {
      const credentials = await this.getCredentialsOrThrow(brand);
      await this.checkRateLimit(String(credentials.accountId));

      // Attempt: POST /{comment-id}/likes (if unsupported, API returns error 100/12)
      const url = fbGraph(`${commentId}/likes`);
      const res = await axios.post(url, { access_token: credentials.accessToken });
      const ok = Boolean((res.data as any)?.success ?? true);
      return { success: ok };
    } catch (error: any) {
      const message = (error?.response?.data?.error?.message as string) || (error as Error).message;
      // Normalize common unsupported responses
      if (/Unsupported|Invalid parameter|Unknown path|(#|code)\s?100|not allowed/i.test(message)) {
        throw new Error('Instagram API does not support liking comments for this account');
      }
      instagramLogger.error('Failed to like comment', formatError(error));
      throw new Error(`Failed to like comment: ${message || 'Unknown error'}`);
    }
  }

  async likeCommentForSocialAccount(
    socialAccountId: string,
    commentId: string
  ): Promise<{ success: boolean }> {
    try {
      const credentials = await this.getCredentialsOrThrowForSocialAccount(socialAccountId);
      await this.checkRateLimit(String(credentials.accountId));

      const url = fbGraph(`${commentId}/likes`);
      const res = await axios.post(url, { access_token: credentials.accessToken });
      const ok = Boolean((res.data as any)?.success ?? true);
      return { success: ok };
    } catch (error: any) {
      const message = (error?.response?.data?.error?.message as string) || (error as Error).message;
      if (/Unsupported|Invalid parameter|Unknown path|(#|code)\s?100|not allowed/i.test(message)) {
        throw new Error('Instagram API does not support liking comments for this account');
      }
      instagramLogger.error('Failed to like comment', formatError(error));
      throw new Error(`Failed to like comment: ${message || 'Unknown error'}`);
    }
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
      const url = fbGraph(
        `oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_APP_SECRET}&fb_exchange_token=${currentToken}`
      );

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
      instagramLogger.error('Token refresh failed', formatError(error));
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
  async getProfile(brand: BrandData | string): Promise<InstagramProfile> {
    if (!(await this.isConfigured(brand))) {
      throw new Error('Instagram not connected for this brand');
    }

    try {
      const credentials = await this.getCredentialsOrThrow(brand);
      await this.checkRateLimit(String(credentials.accountId));

      const fields =
        'id,username,name,biography,followers_count,media_count,profile_picture_url,website';
      const url = fbGraph(
        `${credentials.accountId}?fields=${fields}&access_token=${credentials.accessToken}`
      );

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
      instagramLogger.error('Failed to fetch Instagram profile', formatError(error));
      throw new Error(
        `Failed to fetch Instagram profile: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get recent posts from Instagram account
   */
  async getRecentPosts(brand: BrandData | string, limit: number = 25): Promise<InstagramPost[]> {
    if (!(await this.isConfigured(brand))) {
      throw new Error('Instagram not connected for this brand');
    }

    try {
      const credentials = await this.getCredentialsOrThrow(brand);
      await this.checkRateLimit(String(credentials.accountId));

      const fields =
        'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count';
      const url = fbGraph(
        `${credentials.accountId}/media?fields=${fields}&limit=${limit}&access_token=${credentials.accessToken}`
      );

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
        const caption = media.caption || '';
        const hashtags = extractHashtagsFromCaption(caption);

        return {
          id: media.id,
          caption,
          media_type: media.media_type,
          media_url: media.media_url,
          permalink: media.permalink,
          timestamp: media.timestamp,
          like_count: media.like_count,
          comments_count: media.comments_count,
          hashtags,
        };
      });
    } catch (error) {
      instagramLogger.error('Failed to fetch Instagram posts', formatError(error));
      throw new Error(
        `Failed to fetch Instagram posts: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Publish media to Instagram
   */
  async publishMedia(
    brand: BrandData | string,
    request: PublishMediaRequest
  ): Promise<PublishMediaResult> {
    if (!(await this.isConfigured(brand))) {
      throw new Error('Instagram not connected for this brand');
    }

    try {
      const credentials = await this.getCredentialsOrThrow(brand);
      await this.checkRateLimit(String(credentials.accountId));

      // Step 1: Create media container
      const caption = request.caption;
      const containerUrl = fbGraph(`${credentials.accountId}/media`);

      const containerData = {
        image_url: request.cdnImageUrl,
        caption: caption,
        access_token: credentials.accessToken,
      };

      const containerResponse = await axios.post(containerUrl, containerData);
      const containerId = containerResponse.data.id;

      // Step 2: Publish the media container
      const publishUrl = fbGraph(`${credentials.accountId}/media_publish`);
      const publishData = {
        creation_id: containerId,
        access_token: credentials.accessToken,
      };

      const publishResponse = await axios.post(publishUrl, publishData);
      const mediaId = publishResponse.data.id;

      // Step 3: Get the permalink
      const permalinkUrl = fbGraph(
        `${mediaId}?fields=permalink&access_token=${credentials.accessToken}`
      );
      const permalinkResponse = await axios.get(permalinkUrl);

      return {
        id: mediaId,
        permalink: permalinkResponse.data.permalink,
        published: true,
      };
    } catch (error) {
      instagramLogger.error('Failed to publish Instagram media', formatError(error));
      throw new Error(
        `Failed to publish Instagram media: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get media insights for analytics
   */
  async getMediaInsights(
    brand: BrandData | string,
    mediaId: string
  ): Promise<MediaInsightMetric[]> {
    if (!(await this.isConfigured(brand))) {
      throw new Error('Instagram not connected for this brand');
    }

    try {
      const credentials = await this.getCredentialsOrThrow(brand);
      await this.checkRateLimit(String(credentials.accountId));

      const metrics = 'impressions,reach,engagement,likes,comments,saves,shares';
      const url = fbGraph(
        `${mediaId}/insights?metric=${metrics}&access_token=${credentials.accessToken}`
      );

      const response = await axios.get(url);
      const data = response.data?.data;
      return Array.isArray(data) ? (data as MediaInsightMetric[]) : [];
    } catch (error) {
      instagramLogger.error('Failed to fetch media insights', formatError(error));
      throw new Error(
        `Failed to fetch media insights: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Fetch audience demographics (age/gender/location) via Instagram Insights API.
   * This requires an Instagram Business/Creator account and the proper permissions.
   */
  async getAudienceDemographics(
    brand: BrandData | string
  ): Promise<InstagramAudienceDemographicsResult> {
    const brandId = typeof brand === 'string' ? brand : brand.id;
    const account = await prisma.socialAccount.findFirst({
      where: { brandId, platform: 'instagram' },
      select: { metadata: true },
    });

    if (!account) return { status: 'not_connected' };

    const accountMetadata = (account.metadata || {}) as Record<string, unknown>;
    if (
      accountMetadata &&
      typeof accountMetadata === 'object' &&
      (accountMetadata as any).disconnected
    ) {
      return { status: 'not_connected' };
    }

    const seeded = (accountMetadata as any)?.audienceDemographics;
    if (seeded && typeof seeded === 'object') {
      const raw = seeded as any;
      const demographics: InstagramAudienceDemographics = {
        totalAudience: Number(raw.totalAudience || 0),
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
        gender: Array.isArray(raw.gender)
          ? raw.gender
              .map((g: any) => ({
                gender: g.gender === 'M' || g.gender === 'F' || g.gender === 'U' ? g.gender : 'U',
                value: Number(g.value || 0),
              }))
              .filter((g: any) => isFinite(g.value) && g.value > 0)
          : [],
        age: Array.isArray(raw.age)
          ? raw.age
              .map((a: any) => ({ range: String(a.range || ''), value: Number(a.value || 0) }))
              .filter((a: any) => a.range && isFinite(a.value) && a.value > 0)
          : [],
        countries: Array.isArray(raw.countries)
          ? raw.countries
              .map((c: any) => ({ code: String(c.code || ''), value: Number(c.value || 0) }))
              .filter((c: any) => c.code && isFinite(c.value) && c.value > 0)
          : [],
        cities: Array.isArray(raw.cities)
          ? raw.cities
              .map((c: any) => ({ name: String(c.name || ''), value: Number(c.value || 0) }))
              .filter((c: any) => c.name && isFinite(c.value) && c.value > 0)
          : [],
        locales: Array.isArray(raw.locales)
          ? raw.locales
              .map((l: any) => ({ locale: String(l.locale || ''), value: Number(l.value || 0) }))
              .filter((l: any) => l.locale && isFinite(l.value) && l.value > 0)
          : [],
      };

      const hasAny =
        demographics.totalAudience > 0 ||
        demographics.gender.length > 0 ||
        demographics.age.length > 0 ||
        demographics.countries.length > 0 ||
        demographics.cities.length > 0 ||
        demographics.locales.length > 0;

      if (hasAny) return { status: 'available', demographics };
    }

    try {
      const credentials = await this.getCredentialsOrThrow(brand);
      const accessToken = credentials.accessToken;
      const accountId = credentials.accountId;
      if (!accessToken || !accountId) {
        throw new Error('Failed to get Instagram credentials');
      }
      const cacheKey = `instagram:audience_demographics:${String(credentials.accountId)}`;
      const cacheTtlSeconds = 6 * 60 * 60;

      if (redisService.isConnected()) {
        const cached = await redisService.get(cacheKey);
        if (cached) {
          try {
            const parsed = JSON.parse(cached) as InstagramAudienceDemographics;
            if (parsed && typeof parsed === 'object') {
              return { status: 'available', demographics: parsed };
            }
          } catch {
            // ignore cache parse errors
          }
        }
      }

      await this.checkRateLimit(String(credentials.accountId));

      const demographicsMetric = 'follower_demographics';
      const timeframe = 'this_month';

      const parseDemographicBreakdown = (
        rows: Array<any>,
        breakdownDimension: 'age' | 'gender' | 'country' | 'city'
      ): Record<string, number> => {
        const row = rows.find((r) => r && r.name === demographicsMetric) || rows[0];

        const breakdowns = row?.total_value?.breakdowns;
        if (Array.isArray(breakdowns)) {
          const map: Record<string, number> = {};
          for (const breakdown of breakdowns) {
            const keys: string[] = Array.isArray(breakdown?.dimension_keys)
              ? breakdown.dimension_keys.map((k: unknown) => String(k))
              : [];
            const idx = keys.indexOf(breakdownDimension);
            if (idx < 0) continue;

            const results: Array<any> = Array.isArray(breakdown?.results) ? breakdown.results : [];
            for (const result of results) {
              const dimensionValues: unknown[] = Array.isArray(result?.dimension_values)
                ? result.dimension_values
                : [];
              const dimensionValue = dimensionValues[idx];
              const key =
                typeof dimensionValue === 'string' ? dimensionValue : String(dimensionValue ?? '');
              const valueNum = Number(result?.value);
              if (!key || !isFinite(valueNum) || isNaN(valueNum) || valueNum <= 0) continue;
              map[key] = (map[key] || 0) + valueNum;
            }
          }
          return map;
        }

        const raw = row?.values?.[0]?.value ?? row?.total_value?.value ?? row?.value ?? null;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const map: Record<string, number> = {};
          for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            const num = Number(value);
            if (!key || !isFinite(num) || isNaN(num) || num <= 0) continue;
            map[String(key)] = (map[String(key)] || 0) + num;
          }
          return map;
        }

        return {};
      };

      const fetchDemographicBreakdown = async (
        breakdownDimension: 'age' | 'gender' | 'country' | 'city'
      ): Promise<Record<string, number>> => {
        const buildUrl = (breakdownKey: 'breakdowns' | 'breakdown') => {
          const params = new URLSearchParams();
          params.set('metric', demographicsMetric);
          params.set('period', 'lifetime');
          params.set('timeframe', timeframe);
          params.set('metric_type', 'total_value');
          params.set(breakdownKey, breakdownDimension);
          params.set('access_token', accessToken);
          return fbGraph(`${accountId}/insights?${params.toString()}`);
        };

        const tryRequest = async (breakdownKey: 'breakdowns' | 'breakdown') => {
          await this.checkRateLimit(String(credentials.accountId));
          const response = await axios.get(buildUrl(breakdownKey));
          const rows: Array<any> = Array.isArray(response.data?.data) ? response.data.data : [];
          return parseDemographicBreakdown(rows, breakdownDimension);
        };

        try {
          return await tryRequest('breakdowns');
        } catch (error: any) {
          const fbError = error?.response?.data?.error as
            | { message?: string; code?: number; error_subcode?: number }
            | undefined;
          const message =
            (typeof fbError?.message === 'string' && fbError.message) ||
            (error instanceof Error ? error.message : 'Unknown error');
          const shouldRetryWithSingular =
            /breakdowns|breakdown/i.test(String(message)) ||
            (fbError?.code === 100 && /breakdown/i.test(String(message)));
          if (!shouldRetryWithSingular) throw error;
          return await tryRequest('breakdown');
        }
      };

      const breakdowns = ['gender', 'age', 'country', 'city'] as const;
      const settled = await Promise.allSettled(
        breakdowns.map((dimension) => fetchDemographicBreakdown(dimension))
      );

      const maps = new Map<(typeof breakdowns)[number], Record<string, number>>();
      let firstError: unknown | null = null;
      for (let i = 0; i < breakdowns.length; i++) {
        const dimension = breakdowns[i];
        const result = settled[i];
        if (result.status === 'fulfilled') {
          maps.set(dimension, result.value);
        } else if (!firstError) {
          firstError = result.reason;
        }
      }

      if (maps.size === 0 && firstError) {
        throw firstError;
      }

      const genderMap = maps.get('gender') || {};
      const ageMap = maps.get('age') || {};
      const countries = maps.get('country') || {};
      const cities = maps.get('city') || {};

      const genderTotals: Record<'M' | 'F' | 'U', number> = { M: 0, F: 0, U: 0 };
      for (const [key, value] of Object.entries(genderMap)) {
        const normalized: 'M' | 'F' | 'U' =
          key === 'M' || /^m(ale)?$/i.test(key)
            ? 'M'
            : key === 'F' || /^f(emale)?$/i.test(key)
              ? 'F'
              : 'U';
        genderTotals[normalized] += Number(value) || 0;
      }

      const ageTotals = new Map<string, number>();
      for (const [range, value] of Object.entries(ageMap)) {
        const cleaned = String(range || '').trim();
        const num = Number(value);
        if (!cleaned || !isFinite(num) || isNaN(num) || num <= 0) continue;
        ageTotals.set(cleaned, (ageTotals.get(cleaned) || 0) + num);
      }

      const toTopList = <T extends string>(
        map: Record<string, number>,
        keyName: T,
        limit: number
      ): Array<Record<T, string> & { value: number }> =>
        Object.entries(map)
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([k, v]) => ({ [keyName]: k, value: v }) as Record<T, string> & { value: number });

      const genderList = (Object.entries(genderTotals) as Array<['M' | 'F' | 'U', number]>)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([gender, value]) => ({ gender, value }));

      const ageList = Array.from(ageTotals.entries())
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([range, value]) => ({ range, value }));

      const totalAudience =
        genderList.reduce((sum, g) => sum + g.value, 0) ||
        Object.values(countries).reduce((sum, v) => sum + v, 0) ||
        0;

      if (
        totalAudience <= 0 &&
        genderList.length === 0 &&
        ageList.length === 0 &&
        Object.keys(countries).length === 0 &&
        Object.keys(cities).length === 0
      ) {
        return { status: 'no_data' };
      }

      const demographics: InstagramAudienceDemographics = {
        totalAudience,
        updatedAt: new Date().toISOString(),
        gender: genderList,
        age: ageList,
        countries: toTopList(countries, 'code', 10),
        cities: toTopList(cities, 'name', 10),
        locales: [],
      };

      if (redisService.isConnected()) {
        await redisService.set(cacheKey, JSON.stringify(demographics), cacheTtlSeconds);
      }

      return { status: 'available', demographics };
    } catch (error: any) {
      const fbError = error?.response?.data?.error as
        | { message?: string; code?: number; error_subcode?: number }
        | undefined;
      const message =
        (typeof fbError?.message === 'string' && fbError.message) ||
        (error instanceof Error ? error.message : 'Unknown error');
      const code = fbError?.code;
      const subcode = fbError?.error_subcode;

      const permissionLike =
        code === 10 || /permission|insights|manage_insights|oauth/i.test(String(message));
      const noDataLike =
        /less than 100 followers/i.test(String(message)) ||
        /not returned if the ig user has less than 100 followers/i.test(String(message));
      const hideDetails = code === 100;

      instagramLogger.warn('Failed to fetch audience demographics', {
        code,
        subcode,
        message,
      });

      if (noDataLike) {
        return { status: 'no_data' };
      }

      return {
        status: permissionLike ? 'insufficient_permissions' : 'error',
        errorMessage: hideDetails ? undefined : message,
      };
    }
  }

  /**
   * Get comments for a specific media post
   */
  async getPostComments(
    brand: BrandData | string,
    mediaId: string,
    limit: number = 25
  ): Promise<{ data: InstagramComment[]; total: number }> {
    if (!(await this.isConfigured(brand))) {
      throw new Error('Instagram not connected for this brand');
    }

    try {
      const credentials = await this.getCredentialsOrThrow(brand);
      await this.checkRateLimit(String(credentials.accountId));

      // First, get the total count
      const countUrl = fbGraph(
        `${mediaId}?fields=comments_count&access_token=${credentials.accessToken}`
      );
      const countResponse = await axios.get(countUrl);
      const total = countResponse.data.comments_count || 0;

      // Then get the actual comments
      const url = fbGraph(
        `${mediaId}/comments?fields=id,text,username,timestamp,like_count&limit=${limit}&access_token=${credentials.accessToken}`
      );
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
      instagramLogger.error('Failed to fetch post comments', formatError(error));
      throw new Error(
        `Failed to fetch post comments: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Account-scoped variant of getPostComments. Use this for inbox reads/writes when a brand has
   * multiple connected Instagram accounts.
   */
  async getPostCommentsForSocialAccount(
    socialAccountId: string,
    mediaId: string,
    limit: number = 25
  ): Promise<{ data: InstagramComment[]; total: number }> {
    try {
      const credentials = await this.getCredentialsOrThrowForSocialAccount(socialAccountId);
      await this.checkRateLimit(String(credentials.accountId));

      const countUrl = fbGraph(
        `${mediaId}?fields=comments_count&access_token=${credentials.accessToken}`
      );
      const countResponse = await axios.get(countUrl);
      const total = countResponse.data.comments_count || 0;

      const url = fbGraph(
        `${mediaId}/comments?fields=id,text,username,timestamp,like_count&limit=${limit}&access_token=${credentials.accessToken}`
      );
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
      instagramLogger.error('Failed to fetch post comments', formatError(error));
      throw new Error(
        `Failed to fetch post comments: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handle webhook event
   */
  async handleWebhookEvent(event: InstagramWebhookEvent): Promise<void> {
    try {
      // Process Instagram webhook events
      instagramLogger.info('Processing Instagram webhook event', { event });

      // Implementation depends on specific webhook events you want to handle
      // Common events: media published, comments, mentions, etc.
    } catch (error: unknown) {
      instagramLogger.error('Failed to handle webhook event', formatError(error));
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
    brand: BrandData | string,
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

    if (!(await this.isConfigured(brand))) {
      throw new Error('Instagram not connected for this brand');
    }

    const brandIdLocal = typeof brand === 'string' ? brand : brand.id;
    // Concurrency guard: acquire a short-lived Redis lock to ensure only one sync per brand
    const lockKey = `instagram_sync_lock:${brandIdLocal}`;
    const redis = redisService.getClient();
    let acquiredLock = false;
    try {
      if (redis) {
        // Use string overload: EX first, then TTL number, then NX
        const lockResult = await redis.set(lockKey, String(Date.now()), 'EX', 900, 'NX');
        if (lockResult !== 'OK') {
          // If lock exists, surface a clear error for the route/UI to handle
          throw new Error('Sync already in progress');
        }
        acquiredLock = true;
      }
    } catch (e) {
      // If Redis not available, continue without a lock
      if ((e as Error).message === 'Sync already in progress') throw e;
    }

    // Check rate limit
    const credentials = await this.getCredentialsOrThrow(brand);
    await this.checkRateLimit(String(credentials.accountId));

    const results = {
      synced: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
    };

    try {
      const startTime = Date.now();
      const brandIdLocal = typeof brand === 'string' ? brand : brand.id;
      instagramLogger.info(`[Instagram Sync] Started for brand ${brandIdLocal}`, {
        brandId: brandIdLocal,
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

      instagramLogger.info(
        `[Instagram Sync] 📥 Fetched ${posts.length} posts for brand ${brandIdLocal}`,
        {
          brandId: brandIdLocal,
          totalPosts: posts.length,
          dateThreshold: dateThreshold.toISOString(),
        }
      );

      // Process each post
      for (const post of posts) {
        try {
          await this.syncSinglePost(
            typeof brand === 'string' ? { id: brand } : brand,
            post,
            skipExisting
          );
          results.synced++;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          if (message.includes('already exists')) {
            results.skipped++;
          } else {
            results.failed++;
            results.errors.push(`Post ${post.id}: ${message}`);
            instagramLogger.error(`[Instagram Sync] ❌ Failed to sync post ${post.id}:`, {
              postId: post.id,
              brandId: brandIdLocal,
              error: message,
            });
          }
        }
      }

      const duration = Date.now() - startTime;

      // Store sync metadata in Redis for status endpoint
      const syncMetadata = {
        brandId: brandIdLocal,
        timestamp: new Date().toISOString(),
        duration,
        results,
        options: { maxPosts, maxDays },
      };

      await redisService.set(
        `instagram_sync_metadata:${brandIdLocal}`,
        JSON.stringify(syncMetadata),
        86400 // 24 hour TTL
      );

      const durationSeconds = Math.max(duration / 1000, 0.001);
      const totalAttempts = results.synced + results.failed + results.skipped || 1;
      const successRate = (results.synced / totalAttempts) * 100;
      instagramLogger.info(`[Instagram Sync] ✅ Completed for brand ${brandIdLocal}`, {
        brandId: brandIdLocal,
        duration,
        durationSeconds,
        results,
        successRate,
        postsPerSecond: posts.length / durationSeconds,
      });

      return results;
    } catch (error) {
      instagramLogger.error('Failed to sync Instagram posts', formatError(error));
      throw error;
    } finally {
      // Release lock ASAP
      if (acquiredLock && redis) {
        try {
          await redis.del(lockKey);
        } catch (e) {
          instagramLogger.warn('Failed to release Instagram sync lock', {
            brandId: brandIdLocal,
            lockKey,
            error: (e as Error)?.message,
          });
        }
      }
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
    brand: BrandData | string,
    limit: number = 25,
    cursor?: string | null
  ): Promise<{
    data: InstagramPost[];
    hasMore: boolean;
    cursor: string | null;
  }> {
    if (!(await this.isConfigured(brand))) {
      throw new Error('Instagram not connected for this brand');
    }

    const credentials = await this.getCredentialsOrThrow(brand);

    const fields = 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count';
    let url = fbGraph(
      `${credentials.accountId}/media?fields=${fields}&limit=${limit}&access_token=${credentials.accessToken}`
    );

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
      const caption = media.caption || '';

      return {
        id: media.id,
        caption: caption,
        media_type: media.media_type || 'IMAGE',
        media_url: media.media_url || '',
        permalink: media.permalink || '',
        timestamp: media.timestamp || '',
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
    const credentials = await this.getCredentialsOrThrow(brand);
    // Check if this Instagram post was already imported (by instagramPostId)
    // If found, treat as duplicate and skip (maintains current metrics behavior)
    if (skipExisting) {
      const duplicatePub = await prisma.contentPublication.findFirst({
        where: {
          platform: 'instagram',
          externalPostId: post.id,
          content: { brandId: brand.id! },
        },
        select: { id: true },
      });
      if (duplicatePub) throw new Error('Post already exists');
    }

    // Helper: attempt to find an existing draft/scheduled item that likely represents this IG post
    const findMatchingDraft = async () => {
      const postedAt = post.timestamp ? new Date(post.timestamp) : null;
      const twoHoursMs = 2 * 60 * 60 * 1000;
      const lower = postedAt ? new Date(postedAt.getTime() - twoHoursMs) : undefined;
      const upper = postedAt ? new Date(postedAt.getTime() + twoHoursMs) : undefined;
      const caption = (post.caption || '').trim();
      const captionPrefix = caption.slice(0, 64);

      // Prefer scheduled time proximity; fall back to caption similarity
      // Limit search scope for performance
      const orFilters: Prisma.ContentWhereInput[] = [];
      if (postedAt && lower && upper) {
        orFilters.push({ scheduledAt: { gte: lower, lte: upper } });
      }
      if (captionPrefix) {
        orFilters.push({ caption: { contains: captionPrefix, mode: 'insensitive' } });
      }

      const candidates = await prisma.content.findMany({
        where: {
          brandId: brand.id!,
          status: { in: ['draft', 'scheduled', 'failed', 'skipped'] },
          ...(orFilters.length ? { OR: orFilters } : {}),
        },
        orderBy: [{ scheduledAt: 'desc' }, { updatedAt: 'desc' }],
        take: 25,
      });

      if (!candidates.length) return null;

      // Rank candidates: 1) closest scheduledAt to postedAt 2) exact caption match after normalization
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const normTarget = normalize(caption);

      let best: { id: string; score: number } | null = null;
      for (const c of candidates) {
        let score = 0;
        if (postedAt && c.scheduledAt) {
          const diff = Math.abs(c.scheduledAt.getTime() - postedAt.getTime());
          // Strong score for within 2h window; higher score if closer
          const timeScore = Math.max(0, (twoHoursMs - diff) / twoHoursMs);
          score += timeScore * 0.7; // weight time proximity higher
        }
        if (c.caption) {
          const norm = normalize(c.caption);
          if (norm && norm === normTarget && norm.length > 0) {
            score += 0.5; // bonus for exact normalized caption match
          } else if (
            norm &&
            normTarget &&
            norm.includes(normTarget.slice(0, Math.min(32, normTarget.length)))
          ) {
            score += 0.2; // weak bonus for partial prefix match
          }
        }
        if (!best || score > best.score) {
          best = { id: c.id, score };
        }
      }

      // Require a minimum confidence to avoid accidental merges
      if (best && best.score >= 0.3) {
        return candidates.find((c) => c.id === best!.id) || null;
      }
      return null;
    };

    // Skip non-image posts
    if (post.media_type !== 'IMAGE' && post.media_type !== 'CAROUSEL_ALBUM') {
      instagramLogger.info(`Skipping ${post.media_type} post ${post.id}`);
      throw new Error(`Unsupported media type: ${post.media_type}`);
    }

    // Download image to S3
    let importedAsset: AssetRecord | null = null;
    let imageDownloadFailed = false;

    if (post.media_url) {
      try {
        const imageStartTime = Date.now();
        importedAsset = await importImageFromExternalUrl(post.media_url, {
          contentId: `import-${post.id}`,
          brandId: brand.id!,
          generatedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
          source: 'instagram',
          originalPrompt: post.caption || 'Imported from Instagram',
          publishedAt: post.timestamp ? new Date(post.timestamp) : undefined,
        });

        const imageDuration = Date.now() - imageStartTime;
        instagramLogger.info(
          `[Instagram Sync] 🖼️  Image cached via assets service: ${importedAsset.id}`,
          {
            postId: post.id,
            assetId: importedAsset.id,
            duration: imageDuration,
          }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        instagramLogger.error(`[Instagram Sync] ⚠️  Failed to download image for post ${post.id}`, {
          postId: post.id,
          mediaUrl: post.media_url,
          error: message,
        });
        imageDownloadFailed = true;
        // Continue without image - store post metadata only
      }
    } else {
      instagramLogger.info(`[Instagram Sync] ℹ️  No media URL for post ${post.id}`);
      imageDownloadFailed = true;
    }

    // Create content record payload (used for create or patch existing)
    const postedAt = post.timestamp ? new Date(post.timestamp) : new Date();

    const contentData = {
      brandId: brand.id!,

      campaignId: null,
      caption: post.caption,
      hashtags: extractHashtagsFromCaption(post.caption || ''),
      status: 'published' as const,
      postedAt,
      scheduledAt: postedAt,
      generationParams: {
        source: 'instagram_import',
        importedAt: new Date().toISOString(),
        originalPostDate: post.timestamp,
        mediaType: post.media_type,
        hasImage: !!importedAsset,
        imageDownloadFailed,
      },
    };

    // Try to merge into an existing draft/scheduled content to avoid duplicates
    const matchingDraft = await findMatchingDraft();
    if (matchingDraft) {
      // Merge generationParams non-destructively
      const current = await prisma.content.findUnique({
        where: { id: matchingDraft.id },
        select: {
          generationParams: true,
          campaignId: true,
          scheduledAt: true,
          mediaAssets: {
            select: { assetId: true, displayOrder: true },
            orderBy: { displayOrder: 'asc' },
            take: 1,
          },
        },
      });
      const existingParams = (current?.generationParams as Record<string, unknown>) || {};

      const hasExistingMedia = Boolean(current?.mediaAssets?.length);
      const finalHasImage = hasExistingMedia || Boolean(importedAsset);
      await prisma.content.update({
        where: { id: matchingDraft.id },
        data: {
          status: 'published',
          postedAt: contentData.postedAt,
          scheduledAt: current?.scheduledAt ?? contentData.postedAt,
          schedulingError: null,

          campaignId: current?.campaignId || null,
          generationParams: {
            ...existingParams,
            // Preserve existing, add import details
            source: 'instagram_import',
            importedAt: new Date().toISOString(),
            originalPostDate: post.timestamp,
            mediaType: post.media_type,
            hasImage: finalHasImage,
            imageDownloadFailed,
          },
        },
      });

      instagramLogger.info(`[Instagram Sync] 🔄 Updated existing content with IG data`, {
        postId: post.id,
        brandId: brand.id,
        mergedInto: matchingDraft.id,
        reason: 'matched draft/scheduled by time/caption',
      });

      if (importedAsset && !hasExistingMedia) {
        await attachAssetToContent({
          contentId: matchingDraft.id,
          asset: importedAsset,
          displayOrder: 0,
        });
      }
      // Ensure ContentPublication exists
      try {
        const sa = await prisma.socialAccount.upsert({
          where: {
            platform_externalAccountId: {
              platform: 'instagram',
              externalAccountId: credentials.accountId || 'unknown',
            },
          },
          update: {
            brandId: brand.id!,
            externalPageId: credentials.pageId || undefined,
          },
          create: {
            brandId: brand.id!,
            platform: 'instagram',
            externalAccountId: credentials.accountId || 'unknown',
            externalPageId: credentials.pageId || undefined,
            displayName: '',
          },
        });
        await prisma.contentPublication.upsert({
          where: {
            socialAccountId_externalPostId: {
              socialAccountId: sa.id,
              externalPostId: post.id,
            },
          },
          update: {
            contentId: matchingDraft.id,
            platform: 'instagram',
            permalink: post.permalink || undefined,
            publishedAt: postedAt,
          },
          create: {
            contentId: matchingDraft.id,
            socialAccountId: sa.id,
            platform: 'instagram',
            externalPostId: post.id,
            externalThreadRootId: null,
            externalAccountId: credentials.accountId || undefined,
            externalPageId: credentials.pageId || undefined,
            permalink: post.permalink || undefined,
            publishedAt: postedAt,
            status: 'published',
          },
        });
      } catch (e) {
        instagramLogger.warn('Failed to upsert publication for matching draft', {
          error: (e as Error).message,
        });
      }
      return;
    }

    // No matching draft found; ensure we don't duplicate existing publications
    // 1) Check for an existing publication for this externalPostId under the brand's IG account
    const sa = await prisma.socialAccount.upsert({
      where: {
        platform_externalAccountId: {
          platform: 'instagram',
          externalAccountId: credentials.accountId || 'unknown',
        },
      },
      update: {
        brandId: brand.id!,
        externalPageId: credentials.pageId || undefined,
      },
      create: {
        brandId: brand.id!,
        platform: 'instagram',
        externalAccountId: credentials.accountId || 'unknown',
        externalPageId: credentials.pageId || undefined,
        displayName: '',
      },
    });

    const existingPub = await prisma.contentPublication.findUnique({
      where: {
        socialAccountId_externalPostId: {
          socialAccountId: sa.id,
          externalPostId: post.id,
        },
      },
      select: { id: true, contentId: true },
    });

    if (existingPub?.contentId) {
      // Already imported: optionally enrich existing content (attach asset/permalink) and return
      if (importedAsset) {
        try {
          await attachAssetToContent({ contentId: existingPub.contentId, asset: importedAsset });
        } catch {}
      }
      await prisma.content.update({
        where: { id: existingPub.contentId },
        data: {
          status: 'published',
          postedAt,
          schedulingError: null,
          generationParams: {
            ...(contentData.generationParams as any),
            // preserve any existing fields on the target content
          },
        },
      });
      await prisma.contentPublication.update({
        where: { id: existingPub.id },
        data: {
          permalink: post.permalink || undefined,
          publishedAt: postedAt,
          status: 'published',
        },
      });
      instagramLogger.info(
        '[Instagram Sync] Publication already exists; merged into existing content',
        {
          postId: post.id,
          brandId: brand.id,
          publicationId: existingPub.id,
        }
      );
      return;
    }

    // 2) Create a new content record and the publication together; if publication fails, clean up content
    const created = await prisma.content.create({ data: contentData });
    if (importedAsset) {
      await attachAssetToContent({ contentId: created.id, asset: importedAsset });
    }
    try {
      await prisma.contentPublication.create({
        data: {
          contentId: created.id,
          socialAccountId: sa.id,
          platform: 'instagram',
          externalPostId: post.id,
          externalThreadRootId: null,
          externalAccountId: credentials.accountId || undefined,
          externalPageId: credentials.pageId || undefined,
          permalink: post.permalink || undefined,
          publishedAt: postedAt,
          status: 'published',
        },
      });
    } catch (pubErr) {
      const code = (pubErr as any)?.code;
      if (code === 'P2002') {
        // Publication exists (race) — remove the just-created content to avoid duplicates
        try {
          await prisma.content.delete({ where: { id: created.id } });
        } catch {}
        instagramLogger.info(
          '[Instagram Sync] Skipped duplicate by unique constraint (cleaned content)',
          {
            postId: post.id,
            brandId: brand.id,
          }
        );
        return;
      }
      // Unexpected error creating publication - best-effort cleanup and rethrow
      try {
        await prisma.content.delete({ where: { id: created.id } });
      } catch {}
      throw pubErr;
    }

    instagramLogger.info(`[Instagram Sync] ✨ Synced post ${post.id}`, {
      postId: post.id,
      brandId: brand.id,
      hasImage: !!importedAsset,
      engagement: {
        likes: post.like_count || 0,
        comments: post.comments_count || 0,
      },
    });
  }
}

export const instagramService = new InstagramService();
