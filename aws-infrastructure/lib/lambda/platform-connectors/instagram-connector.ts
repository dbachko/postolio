/**
 * Instagram Graph API Connector
 * Handles publishing to Instagram Business/Creator accounts
 */

import { Logger } from '@aws-lambda-powertools/logger';
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import {
  BasePlatformConnector,
  Content,
  PublishResult,
  Insights,
  RateLimitConfig,
  PlatformCredentials,
} from './base-connector';

const logger = new Logger({ serviceName: 'instagram-connector' });

interface InstagramMediaResponse {
  id: string;
  permalink?: string;
  media_url?: string;
  caption?: string;
}

interface InstagramInsightsResponse {
  data: Array<{
    name: string;
    values: Array<{
      value: number;
    }>;
  }>;
}

interface InstagramContainerResponse {
  id: string;
  status?: string;
  status_code?: string;
  error_message?: string;
}

export class InstagramConnector extends BasePlatformConnector {
  private apiClient?: AxiosInstance;
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';
  
  constructor() {
    super('instagram');
  }

  /**
   * Authenticate with Instagram Graph API
   */
  async authenticate(): Promise<void> {
    logger.info('Authenticating with Instagram Graph API');
    
    const credentials = await this.loadCredentials();
    
    // Initialize API client
    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      params: {
        access_token: credentials.accessToken,
      },
    });
    
    // Validate token by fetching account info
    try {
      const response = await this.apiClient.get(`/${credentials.accountId}`, {
        params: {
          fields: 'id,username,account_type,media_count',
        },
      });
      
      logger.info('Instagram authentication successful', {
        accountId: response.data.id,
        username: response.data.username,
        accountType: response.data.account_type,
      });
    } catch (error) {
      logger.error('Instagram authentication failed', { error });
      throw new Error('Failed to authenticate with Instagram');
    }
  }

  /**
   * Publish content to Instagram
   */
  async publishContent(content: Content): Promise<PublishResult> {
    const startTime = Date.now();
    
    try {
      this.validateContent(content);
      
      if (!this.apiClient || !this.credentials) {
        await this.authenticate();
      }
      
      let result: PublishResult;
      
      switch (content.mediaType) {
        case 'video':
          result = await this.publishReel(content);
          break;
        case 'carousel':
          result = await this.publishCarousel(content);
          break;
        case 'image':
        default:
          result = await this.publishImage(content);
          break;
      }
      
      result.metrics = {
        totalTime: Date.now() - startTime,
      };
      
      this.logPublishingMetrics(result);
      return result;
      
    } catch (error) {
      logger.error('Failed to publish to Instagram', { error, content });
      
      return {
        success: false,
        error: {
          code: 'INSTAGRAM_PUBLISH_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          retryable: this.isRetryableError(error),
        },
      };
    }
  }

  /**
   * Publish image to Instagram
   */
  private async publishImage(content: Content): Promise<PublishResult> {
    return this.executeRequest(async () => {
      const caption = this.buildFullCaption(content.caption, content.hashtags);
      
      // Step 1: Create media container
      const containerResponse = await this.apiClient!.post(
        `/${this.credentials!.accountId}/media`,
        {
          image_url: content.mediaUrl,
          caption,
          ...(content.platformSpecific?.instagram || {}),
        }
      );
      
      const containerId = containerResponse.data.id;
      
      // Step 2: Wait for container to be ready
      await this.waitForContainer(containerId);
      
      // Step 3: Publish the container
      const publishResponse = await this.apiClient!.post(
        `/${this.credentials!.accountId}/media_publish`,
        {
          creation_id: containerId,
        }
      );
      
      // Step 4: Get the permalink
      const mediaResponse = await this.apiClient!.get(
        `/${publishResponse.data.id}`,
        {
          params: {
            fields: 'id,permalink,media_url,caption',
          },
        }
      );
      
      logger.info('Image published to Instagram', {
        postId: mediaResponse.data.id,
        permalink: mediaResponse.data.permalink,
      });
      
      return {
        success: true,
        platformPostId: mediaResponse.data.id,
        platformUrl: mediaResponse.data.permalink,
        publishedAt: new Date().toISOString(),
      };
    }, 'publishImage');
  }

  /**
   * Publish Reel (video) to Instagram
   */
  private async publishReel(content: Content): Promise<PublishResult> {
    return this.executeRequest(async () => {
      const caption = this.buildFullCaption(content.caption, content.hashtags);
      
      // Step 1: Create Reel container
      const containerResponse = await this.apiClient!.post(
        `/${this.credentials!.accountId}/media`,
        {
          media_type: 'REELS',
          video_url: content.videoUrl,
          caption,
          thumb_offset: content.platformSpecific?.instagram?.thumbOffset || 0,
          share_to_feed: content.platformSpecific?.instagram?.shareToFeed !== false,
          ...(content.platformSpecific?.instagram || {}),
        }
      );
      
      const containerId = containerResponse.data.id;
      
      // Step 2: Wait for video processing (longer for videos)
      await this.waitForContainer(containerId, 120); // 2 minutes max for video
      
      // Step 3: Publish the Reel
      const publishResponse = await this.apiClient!.post(
        `/${this.credentials!.accountId}/media_publish`,
        {
          creation_id: containerId,
        }
      );
      
      // Step 4: Get the permalink
      const mediaResponse = await this.apiClient!.get(
        `/${publishResponse.data.id}`,
        {
          params: {
            fields: 'id,permalink,media_type',
          },
        }
      );
      
      logger.info('Reel published to Instagram', {
        postId: mediaResponse.data.id,
        permalink: mediaResponse.data.permalink,
      });
      
      return {
        success: true,
        platformPostId: mediaResponse.data.id,
        platformUrl: mediaResponse.data.permalink,
        publishedAt: new Date().toISOString(),
      };
    }, 'publishReel');
  }

  /**
   * Publish carousel to Instagram
   */
  private async publishCarousel(content: Content): Promise<PublishResult> {
    return this.executeRequest(async () => {
      const caption = this.buildFullCaption(content.caption, content.hashtags);
      const mediaUrls = content.platformSpecific?.instagram?.carouselMedia || [];
      
      if (mediaUrls.length < 2 || mediaUrls.length > 10) {
        throw new Error('Carousel must have between 2 and 10 media items');
      }
      
      // Step 1: Create containers for each media item
      const containerIds: string[] = [];
      
      for (const mediaUrl of mediaUrls) {
        const containerResponse = await this.apiClient!.post(
          `/${this.credentials!.accountId}/media`,
          {
            image_url: mediaUrl,
            is_carousel_item: true,
          }
        );
        containerIds.push(containerResponse.data.id);
      }
      
      // Step 2: Create carousel container
      const carouselResponse = await this.apiClient!.post(
        `/${this.credentials!.accountId}/media`,
        {
          media_type: 'CAROUSEL',
          children: containerIds,
          caption,
        }
      );
      
      const carouselId = carouselResponse.data.id;
      
      // Step 3: Wait for carousel to be ready
      await this.waitForContainer(carouselId);
      
      // Step 4: Publish the carousel
      const publishResponse = await this.apiClient!.post(
        `/${this.credentials!.accountId}/media_publish`,
        {
          creation_id: carouselId,
        }
      );
      
      logger.info('Carousel published to Instagram', {
        postId: publishResponse.data.id,
        itemCount: containerIds.length,
      });
      
      return {
        success: true,
        platformPostId: publishResponse.data.id,
        publishedAt: new Date().toISOString(),
      };
    }, 'publishCarousel');
  }

  /**
   * Wait for media container to be ready
   */
  private async waitForContainer(containerId: string, maxWaitSeconds = 60): Promise<void> {
    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;
    
    while (Date.now() - startTime < maxWaitMs) {
      const response = await this.apiClient!.get(`/${containerId}`, {
        params: {
          fields: 'status_code,status',
        },
      });
      
      const status = response.data.status_code || response.data.status;
      
      if (status === 'FINISHED') {
        return;
      }
      
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new Error(`Container failed with status: ${status}`);
      }
      
      // Wait 2 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error(`Container processing timeout after ${maxWaitSeconds} seconds`);
  }

  /**
   * Get insights for a published post
   */
  async getInsights(postId: string): Promise<Insights> {
    return this.executeRequest(async () => {
      if (!this.apiClient) {
        await this.authenticate();
      }
      
      const response = await this.apiClient!.get(`/${postId}/insights`, {
        params: {
          metric: 'impressions,reach,engagement,likes,comments,shares,saved,video_views',
        },
      });
      
      const insights: Insights = {
        impressions: 0,
        reach: 0,
        engagement: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        views: 0,
      };
      
      // Parse insights response
      response.data.data.forEach((metric: any) => {
        const value = metric.values[0]?.value || 0;
        
        switch (metric.name) {
          case 'impressions':
            insights.impressions = value;
            break;
          case 'reach':
            insights.reach = value;
            break;
          case 'engagement':
            insights.engagement = value;
            break;
          case 'likes':
            insights.likes = value;
            break;
          case 'comments':
            insights.comments = value;
            break;
          case 'shares':
            insights.shares = value;
            break;
          case 'saved':
            insights.saves = value;
            break;
          case 'video_views':
            insights.views = value;
            break;
        }
      });
      
      return insights;
    }, 'getInsights');
  }

  /**
   * Delete content from Instagram
   */
  async deleteContent(postId: string): Promise<void> {
    return this.executeRequest(async () => {
      if (!this.apiClient) {
        await this.authenticate();
      }
      
      await this.apiClient!.delete(`/${postId}`);
      
      logger.info('Content deleted from Instagram', { postId });
    }, 'deleteContent');
  }

  /**
   * Get default rate limit configuration
   */
  protected getDefaultRateLimitConfig(): RateLimitConfig {
    return {
      maxRequestsPerHour: 200,
      maxRequestsPerDay: 4800,
      burstLimit: 10,
      retryAfterSeconds: 3600,
    };
  }

  /**
   * Refresh access token
   */
  protected async refreshAccessToken(): Promise<void> {
    if (!this.credentials?.refreshToken) {
      throw new Error('No refresh token available');
    }
    
    try {
      const response = await axios.get(`${this.baseUrl}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          fb_exchange_token: this.credentials.accessToken,
        },
      });
      
      this.credentials.accessToken = response.data.access_token;
      this.credentials.expiresAt = new Date(
        Date.now() + response.data.expires_in * 1000
      ).toISOString();
      
      // TODO: Save updated credentials to Secrets Manager
      
      logger.info('Instagram access token refreshed');
    } catch (error) {
      logger.error('Failed to refresh Instagram access token', { error });
      throw new Error('Failed to refresh access token');
    }
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (!error.response) {
      return true; // Network errors are retryable
    }
    
    const status = error.response.status;
    const errorCode = error.response.data?.error?.code;
    
    // Rate limit errors
    if (status === 429 || errorCode === 32 || errorCode === 4) {
      return true;
    }
    
    // Server errors
    if (status >= 500) {
      return true;
    }
    
    // Specific Instagram errors that are retryable
    const retryableErrorCodes = [
      2, // Service temporarily unavailable
      17, // User request limit reached
      341, // Application request limit reached
      368, // Temporarily blocked for policies violations
    ];
    
    return retryableErrorCodes.includes(errorCode);
  }
}