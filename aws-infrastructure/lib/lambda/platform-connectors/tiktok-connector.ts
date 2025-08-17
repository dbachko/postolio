/**
 * TikTok API v2 Connector
 * Handles publishing to TikTok Business accounts
 */

import { Logger } from '@aws-lambda-powertools/logger';
import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import {
  BasePlatformConnector,
  Content,
  PublishResult,
  Insights,
  RateLimitConfig,
} from './base-connector';

const logger = new Logger({ serviceName: 'tiktok-connector' });

interface TikTokVideoInitResponse {
  data: {
    upload_url: string;
    upload_id: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface TikTokPublishResponse {
  data: {
    post_id: string;
    share_url: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface TikTokInsightsResponse {
  data: {
    videos: Array<{
      video_id: string;
      metrics: {
        view_count: number;
        like_count: number;
        comment_count: number;
        share_count: number;
        save_count: number;
        completion_rate: number;
      };
    }>;
  };
}

export class TikTokConnector extends BasePlatformConnector {
  private apiClient?: AxiosInstance;
  private readonly baseUrl = 'https://open.tiktokapis.com/v2';
  
  constructor() {
    super('tiktok');
  }

  /**
   * Authenticate with TikTok API
   */
  async authenticate(): Promise<void> {
    logger.info('Authenticating with TikTok API');
    
    const credentials = await this.loadCredentials();
    
    // Initialize API client
    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    // Validate token by fetching account info
    try {
      const response = await this.apiClient.get('/user/info/', {
        params: {
          fields: 'open_id,union_id,display_name,follower_count',
        },
      });
      
      logger.info('TikTok authentication successful', {
        openId: response.data.data.user.open_id,
        displayName: response.data.data.user.display_name,
        followerCount: response.data.data.user.follower_count,
      });
    } catch (error) {
      logger.error('TikTok authentication failed', { error });
      throw new Error('Failed to authenticate with TikTok');
    }
  }

  /**
   * Publish content to TikTok
   */
  async publishContent(content: Content): Promise<PublishResult> {
    const startTime = Date.now();
    
    try {
      this.validateContent(content);
      
      if (!this.apiClient || !this.credentials) {
        await this.authenticate();
      }
      
      // TikTok only supports video content
      if (content.mediaType !== 'video') {
        throw new Error('TikTok only supports video content');
      }
      
      const result = await this.publishVideo(content);
      
      result.metrics = {
        totalTime: Date.now() - startTime,
      };
      
      this.logPublishingMetrics(result);
      return result;
      
    } catch (error) {
      logger.error('Failed to publish to TikTok', { error, content });
      
      return {
        success: false,
        error: {
          code: 'TIKTOK_PUBLISH_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          retryable: this.isRetryableError(error),
        },
      };
    }
  }

  /**
   * Publish video to TikTok
   */
  private async publishVideo(content: Content): Promise<PublishResult> {
    return this.executeRequest(async () => {
      const caption = this.buildFullCaption(content.caption, content.hashtags);
      
      // Step 1: Initialize video upload
      const initResponse = await this.initializeVideoUpload(content);
      
      if (initResponse.error) {
        throw new Error(`Upload initialization failed: ${initResponse.error.message}`);
      }
      
      const { upload_url, upload_id } = initResponse.data;
      
      // Step 2: Upload video to TikTok servers
      await this.uploadVideoFile(upload_url, content.videoUrl!);
      
      // Step 3: Create video post
      const publishData = {
        upload_id,
        post_info: {
          title: caption.substring(0, 150), // TikTok title limit
          description: caption,
          privacy_level: content.platformSpecific?.tiktok?.privacyLevel || 'PUBLIC',
          disable_duet: content.platformSpecific?.tiktok?.disableDuet || false,
          disable_stitch: content.platformSpecific?.tiktok?.disableStitch || false,
          disable_comment: content.platformSpecific?.tiktok?.disableComment || false,
          video_cover_timestamp_ms: content.platformSpecific?.tiktok?.coverTimestamp || 1000,
        },
      };
      
      // Add music if specified
      if (content.platformSpecific?.tiktok?.musicId) {
        publishData.post_info.music_id = content.platformSpecific.tiktok.musicId;
      }
      
      const publishResponse = await this.apiClient!.post(
        '/video/publish/',
        publishData
      );
      
      if (publishResponse.data.error) {
        throw new Error(`Publishing failed: ${publishResponse.data.error.message}`);
      }
      
      logger.info('Video published to TikTok', {
        postId: publishResponse.data.data.post_id,
        shareUrl: publishResponse.data.data.share_url,
      });
      
      return {
        success: true,
        platformPostId: publishResponse.data.data.post_id,
        platformUrl: publishResponse.data.data.share_url,
        publishedAt: new Date().toISOString(),
      };
    }, 'publishVideo');
  }

  /**
   * Initialize video upload
   */
  private async initializeVideoUpload(content: Content): Promise<TikTokVideoInitResponse> {
    const videoSize = content.platformSpecific?.tiktok?.videoSize || 10000000; // Default 10MB
    
    const response = await this.apiClient!.post('/video/init/', {
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSize,
        chunk_size: 5242880, // 5MB chunks
        total_chunk_count: Math.ceil(videoSize / 5242880),
      },
    });
    
    return response.data;
  }

  /**
   * Upload video file to TikTok
   */
  private async uploadVideoFile(uploadUrl: string, videoUrl: string): Promise<void> {
    try {
      // Download video from S3 or external URL
      const videoResponse = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
      });
      
      const videoBuffer = Buffer.from(videoResponse.data);
      
      // Upload to TikTok
      await axios.put(uploadUrl, videoBuffer, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': videoBuffer.length.toString(),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      
      logger.info('Video uploaded to TikTok servers', {
        size: videoBuffer.length,
      });
    } catch (error) {
      logger.error('Failed to upload video to TikTok', { error });
      throw new Error('Video upload failed');
    }
  }

  /**
   * Get insights for a published post
   */
  async getInsights(postId: string): Promise<Insights> {
    return this.executeRequest(async () => {
      if (!this.apiClient) {
        await this.authenticate();
      }
      
      const response = await this.apiClient!.get('/video/metrics/', {
        params: {
          video_ids: postId,
          fields: 'view_count,like_count,comment_count,share_count,save_count,completion_rate',
        },
      });
      
      const videoMetrics = response.data.data.videos[0]?.metrics || {};
      
      return {
        impressions: videoMetrics.view_count || 0,
        reach: videoMetrics.view_count || 0, // TikTok doesn't distinguish reach
        engagement: (
          (videoMetrics.like_count || 0) +
          (videoMetrics.comment_count || 0) +
          (videoMetrics.share_count || 0) +
          (videoMetrics.save_count || 0)
        ),
        likes: videoMetrics.like_count || 0,
        comments: videoMetrics.comment_count || 0,
        shares: videoMetrics.share_count || 0,
        saves: videoMetrics.save_count || 0,
        views: videoMetrics.view_count || 0,
        completionRate: videoMetrics.completion_rate || 0,
        platformSpecific: {
          tiktok: videoMetrics,
        },
      };
    }, 'getInsights');
  }

  /**
   * Delete content from TikTok
   */
  async deleteContent(postId: string): Promise<void> {
    return this.executeRequest(async () => {
      if (!this.apiClient) {
        await this.authenticate();
      }
      
      // TikTok API v2 doesn't support content deletion
      // Videos can only be deleted through the TikTok app/website
      logger.warn('TikTok API does not support content deletion', { postId });
      
      // We could mark it as deleted in our system
      // but cannot actually delete from TikTok
      throw new Error('TikTok API does not support content deletion. Please delete manually through TikTok.');
    }, 'deleteContent');
  }

  /**
   * Get default rate limit configuration
   */
  protected getDefaultRateLimitConfig(): RateLimitConfig {
    return {
      maxRequestsPerHour: 100,
      maxRequestsPerDay: 1000,
      burstLimit: 5,
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
      const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
        client_key: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: this.credentials.refreshToken,
      });
      
      this.credentials.accessToken = response.data.access_token;
      this.credentials.refreshToken = response.data.refresh_token;
      this.credentials.expiresAt = new Date(
        Date.now() + response.data.expires_in * 1000
      ).toISOString();
      
      // TODO: Save updated credentials to Secrets Manager
      
      logger.info('TikTok access token refreshed');
    } catch (error) {
      logger.error('Failed to refresh TikTok access token', { error });
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
    if (status === 429) {
      return true;
    }
    
    // Server errors
    if (status >= 500) {
      return true;
    }
    
    // Specific TikTok errors that are retryable
    const retryableErrorCodes = [
      'rate_limit_exceeded',
      'server_error',
      'service_unavailable',
      'upload_failed',
      'processing_failed',
    ];
    
    return retryableErrorCodes.includes(errorCode);
  }

  /**
   * Generate signature for TikTok requests (if needed)
   */
  private generateSignature(params: Record<string, any>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&');
    
    return crypto
      .createHmac('sha256', this.credentials?.clientSecret || '')
      .update(sortedParams)
      .digest('hex');
  }
}