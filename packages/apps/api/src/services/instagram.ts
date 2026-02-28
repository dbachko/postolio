import axios from 'axios';
import { logger as baseLogger } from '@postolio/logger';
import { formatError } from '../utils/logging.js';
import { redisService } from './redis.js';
import * as crypto from 'crypto';
import { PublisherCredentialsService } from './publisher-credentials.js';
import { prisma } from '../config/database.js';
import { getAudienceDemographicsImpl } from './instagram-audience.js';
import { syncPublishedPostsImpl } from './instagram-sync-published.js';
import { syncSinglePostImpl } from './instagram-sync-single-post.js';
import {
  getDmThreadMessagesForSocialAccountImpl,
  getDmThreadMessagesImpl,
  listDmThreadsForSocialAccountImpl,
  listDmThreadsImpl,
  sendDmMessageImpl,
} from './instagram-messaging-threads.js';
import {
  replyToCommentDirectForSocialAccountImpl,
  replyToCommentDirectImpl,
  replyToCommentForSocialAccountImpl,
  replyToCommentImpl,
  sendDirectMessageForSocialAccountImpl,
  sendDirectMessageImpl,
} from './instagram-messaging-actions.js';
import {
  deleteCommentImpl,
  likeCommentForSocialAccountImpl,
  likeCommentImpl,
  setCommentHiddenImpl,
} from './instagram-messaging-comments.js';
import {
  getMediaInsightsImpl,
  getPostCommentsForSocialAccountImpl,
  getPostCommentsImpl,
  getProfileImpl,
  getRecentPostsImpl,
  getRecentPostsPaginatedImpl,
  publishMediaImpl,
  refreshAccessTokenImpl,
} from './instagram-profile-ops.js';
import type {
  BrandData,
  InstagramAudienceDemographicsResult,
  InstagramComment,
  InstagramPost,
  InstagramProfile,
  InstagramWebhookEvent,
  MediaInsightMetric,
  PublishMediaRequest,
  PublishMediaResult,
} from './instagram-types.js';
export type {
  BrandData,
  InstagramAudienceDemographics,
  InstagramAudienceDemographicsResult,
  InstagramAudienceDemographicsStatus,
  InstagramComment,
  InstagramPost,
  InstagramProfile,
  InstagramWebhookEvent,
  MediaInsightMetric,
  MediaInsights,
  PublishMediaRequest,
  PublishMediaResult,
} from './instagram-types.js';

const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
const fbGraph = (path: string) => `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

const instagramLogger = baseLogger.child({ module: 'instagram-service' });

class InstagramService {
  private rateLimitWindow: Map<string, number> = new Map();

  private sanitizeGraphPath(path: string): string {
    return String(path).replace(/access_token=[^&]+/g, 'access_token=***');
  }

  private isGraphGetResponseUsable(payload: any): boolean {
    const data = payload?.data ?? null;
    return Array.isArray(data) || Boolean(payload?.id) || Boolean(payload?.messages);
  }

  private logGraphGetFailure(paths: string[], error: unknown): void {
    const err = error as any;
    instagramLogger.warn('Facebook Graph API request failed for all candidate paths', {
      status: err?.response?.status ?? null,
      paths: paths.map((path) => this.sanitizeGraphPath(path)),
      responseData: err?.response?.data ?? null,
      ...formatError(error),
    });
  }

  async isConfigured(brandOrId: BrandData | string): Promise<boolean> {
    const brandId = typeof brandOrId === 'string' ? brandOrId : brandOrId.id;
    const account = await prisma.socialAccount.findFirst({
      where: { brandId, platform: 'instagram' },
      select: { id: true, metadata: true },
    });
    if (!account) {
      return false;
    }
    const metadata = (account.metadata || {}) as Record<string, unknown>;
    return !(metadata && typeof metadata === 'object' && (metadata as any).disconnected);
  }

  private async getCredentialsOrThrow(brandOrId: BrandData | string) {
    const brandId = typeof brandOrId === 'string' ? brandOrId : brandOrId.id;
    const credentials = await PublisherCredentialsService.getCredentialsForBrand(brandId);
    if (!credentials?.accessToken || !credentials.accountId) {
      throw new Error('Failed to get Instagram credentials');
    }
    return credentials;
  }

  private async getCredentialsOrThrowForSocialAccount(socialAccountId: string) {
    const credentials =
      await PublisherCredentialsService.getCredentialsForSocialAccount(socialAccountId);
    if (!credentials?.accessToken || !credentials.accountId) {
      throw new Error('Failed to get Instagram credentials');
    }
    return credentials;
  }

  private async tryGraphGet<T = any>(paths: string[]): Promise<T | null> {
    let lastError: unknown = null;
    for (const path of paths) {
      try {
        const response = await axios.get(fbGraph(path));
        if (this.isGraphGetResponseUsable(response.data)) {
          return response.data as T;
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) {
      this.logGraphGetFailure(paths, lastError);
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
    return listDmThreadsImpl(this, brand, opts);
  }

  async listDmThreadsForSocialAccount(
    socialAccountId: string,
    opts: { limit?: number; after?: string } = {}
  ): Promise<{
    supported: boolean;
    threads: Array<{ id: string; updated_time?: string; participants?: any[] }>;
    paging?: any;
  }> {
    return listDmThreadsForSocialAccountImpl(this, socialAccountId, opts);
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
    return getDmThreadMessagesImpl(this, brand, threadId, opts);
  }

  async getDmThreadMessagesForSocialAccount(
    socialAccountId: string,
    threadId: string,
    opts: { limit?: number; before?: string } = {}
  ): Promise<{
    supported: boolean;
    messages: Array<{ id: string; message?: string; from?: any; created_time?: string }>;
    paging?: any;
  }> {
    return getDmThreadMessagesForSocialAccountImpl(this, socialAccountId, threadId, opts);
  }

  private isWithin24hWindow(
    messages: Array<{ from?: any; created_time?: string }>,
    selfIds: string[]
  ): boolean {
    const lastInbound = messages.find(
      (message) =>
        message.created_time && (!message.from || !selfIds.includes(String(message.from.id || '')))
    );
    if (!lastInbound?.created_time) {
      return true;
    }
    return Date.now() - new Date(lastInbound.created_time).getTime() <= 24 * 60 * 60 * 1000;
  }

  async sendDmMessage(
    brand: BrandData | string,
    threadId: string,
    text: string
  ): Promise<{ supported: boolean; success: boolean; errorCode?: string; message?: string }> {
    return sendDmMessageImpl(this, brand, threadId, text);
  }

  async sendDirectMessage(
    brand: BrandData | string,
    recipientId: string,
    message: string
  ): Promise<{ messageId: string }> {
    return sendDirectMessageImpl(this, brand, recipientId, message);
  }

  async sendDirectMessageForSocialAccount(
    socialAccountId: string,
    recipientId: string,
    message: string
  ): Promise<{ messageId: string }> {
    return sendDirectMessageForSocialAccountImpl(this, socialAccountId, recipientId, message);
  }

  async replyToCommentDirect(
    brand: BrandData | string,
    commentId: string,
    message: string
  ): Promise<{ commentId: string }> {
    return replyToCommentDirectImpl(this, brand, commentId, message);
  }

  async replyToCommentDirectForSocialAccount(
    socialAccountId: string,
    commentId: string,
    message: string
  ): Promise<{ commentId: string }> {
    return replyToCommentDirectForSocialAccountImpl(this, socialAccountId, commentId, message);
  }

  async replyToComment(
    brand: BrandData | string,
    mediaId: string,
    commentId: string,
    message: string
  ): Promise<{ id: string }> {
    return replyToCommentImpl(this, brand, mediaId, commentId, message);
  }

  async replyToCommentForSocialAccount(
    socialAccountId: string,
    mediaId: string,
    commentId: string,
    message: string
  ): Promise<{ id: string }> {
    return replyToCommentForSocialAccountImpl(this, socialAccountId, mediaId, commentId, message);
  }

  async setCommentHidden(
    brand: BrandData | string,
    commentId: string,
    hide: boolean
  ): Promise<{ success: boolean }> {
    return setCommentHiddenImpl(this, brand, commentId, hide);
  }

  async deleteComment(brand: BrandData | string, commentId: string): Promise<{ success: boolean }> {
    return deleteCommentImpl(this, brand, commentId);
  }

  async likeComment(brand: BrandData | string, commentId: string): Promise<{ success: boolean }> {
    return likeCommentImpl(this, brand, commentId);
  }

  async likeCommentForSocialAccount(
    socialAccountId: string,
    commentId: string
  ): Promise<{ success: boolean }> {
    return likeCommentForSocialAccountImpl(this, socialAccountId, commentId);
  }

  private getDefaultProfilePicture(): string {
    return 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y&s=150';
  }

  private async checkRateLimit(identifier: string): Promise<boolean> {
    const key = `instagram_rate_limit:${identifier}`;
    if (redisService.isConnected()) {
      const count = await redisService.increment(key, 3600);
      return count ? count <= 200 : true;
    }

    const now = Date.now();
    const windowStart = Math.floor(now / (60 * 60 * 1000)) * (60 * 60 * 1000);
    const windowKey = `${identifier}_${windowStart}`;
    const currentCount = this.rateLimitWindow.get(windowKey) || 0;
    if (currentCount >= 200) {
      return false;
    }

    this.rateLimitWindow.set(windowKey, currentCount + 1);
    for (const [existingKey] of this.rateLimitWindow) {
      const keyTime = parseInt(existingKey.split('_')[1] || '0');
      if (keyTime < windowStart - 60 * 60 * 1000) {
        this.rateLimitWindow.delete(existingKey);
      }
    }
    return true;
  }

  async refreshAccessToken(
    currentToken: string
  ): Promise<{ accessToken: string; expiresAt: string } | null> {
    return refreshAccessTokenImpl(this, currentToken);
  }

  static validateWebhookSignature(payload: string, signature: string): boolean {
    const expected = crypto
      .createHmac('sha256', process.env.FACEBOOK_APP_SECRET || 'test_secret')
      .update(payload)
      .digest('hex');
    const received = signature.replace('sha256=', '');
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  }

  async getProfile(brand: BrandData | string): Promise<InstagramProfile> {
    return getProfileImpl(this, brand);
  }

  async getRecentPosts(brand: BrandData | string, limit = 25): Promise<InstagramPost[]> {
    return getRecentPostsImpl(this, brand, limit);
  }

  async publishMedia(
    brand: BrandData | string,
    request: PublishMediaRequest
  ): Promise<PublishMediaResult> {
    return publishMediaImpl(this, brand, request);
  }

  async getMediaInsights(
    brand: BrandData | string,
    mediaId: string
  ): Promise<MediaInsightMetric[]> {
    return getMediaInsightsImpl(this, brand, mediaId);
  }

  async getAudienceDemographics(
    brand: BrandData | string
  ): Promise<InstagramAudienceDemographicsResult> {
    return getAudienceDemographicsImpl(this, brand);
  }

  async getPostComments(
    brand: BrandData | string,
    mediaId: string,
    limit = 25
  ): Promise<{ data: InstagramComment[]; total: number }> {
    return getPostCommentsImpl(this, brand, mediaId, limit);
  }

  async getPostCommentsForSocialAccount(
    socialAccountId: string,
    mediaId: string,
    limit = 25
  ): Promise<{ data: InstagramComment[]; total: number }> {
    return getPostCommentsForSocialAccountImpl(this, socialAccountId, mediaId, limit);
  }

  async handleWebhookEvent(event: InstagramWebhookEvent): Promise<void> {
    try {
      instagramLogger.info('Processing Instagram webhook event', { event });
    } catch (error) {
      instagramLogger.error('Failed to handle webhook event', formatError(error));
    }
  }

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
    return syncPublishedPostsImpl(this, brand, options);
  }

  async getRecentPostsPaginated(
    brand: BrandData | string,
    limit = 25,
    cursor?: string | null
  ): Promise<{
    data: InstagramPost[];
    hasMore: boolean;
    cursor: string | null;
  }> {
    return getRecentPostsPaginatedImpl(this, brand, limit, cursor);
  }

  private async syncSinglePost(
    brand: BrandData,
    post: InstagramPost,
    skipExisting: boolean
  ): Promise<void> {
    return syncSinglePostImpl(this, brand, post, skipExisting);
  }
}

export const instagramService = new InstagramService();
