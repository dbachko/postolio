/**
 * YouTube Data API v3 Connector
 * Handles publishing to YouTube channels, including Shorts
 */

import { Logger } from '@aws-lambda-powertools/logger';
import axios, { AxiosInstance } from 'axios';
import {
  BasePlatformConnector,
  Content,
  PublishResult,
  Insights,
  RateLimitConfig,
} from './base-connector';

const logger = new Logger({ serviceName: 'youtube-connector' });

interface YouTubeVideoResource {
  id?: string;
  snippet: {
    title: string;
    description: string;
    tags?: string[];
    categoryId?: string;
    thumbnails?: {
      default?: { url: string };
      medium?: { url: string };
      high?: { url: string };
    };
  };
  status: {
    privacyStatus: 'private' | 'unlisted' | 'public';
    selfDeclaredMadeForKids?: boolean;
    embeddable?: boolean;
    license?: string;
    publicStatsViewable?: boolean;
  };
}

interface YouTubeUploadResponse {
  id: string;
  snippet: {
    title: string;
    channelId: string;
    publishedAt: string;
  };
  status: {
    uploadStatus: string;
    privacyStatus: string;
  };
}

interface YouTubeAnalyticsResponse {
  rows: Array<Array<number>>;
  columnHeaders: Array<{
    name: string;
    columnType: string;
  }>;
}

export class YouTubeConnector extends BasePlatformConnector {
  private apiClient?: AxiosInstance;
  private analyticsClient?: AxiosInstance;
  private readonly baseUrl = 'https://www.googleapis.com/youtube/v3';
  private readonly analyticsUrl = 'https://youtubeanalytics.googleapis.com/v2';
  private readonly uploadUrl = 'https://www.googleapis.com/upload/youtube/v3';
  
  constructor() {
    super('youtube');
  }

  /**
   * Authenticate with YouTube Data API
   */
  async authenticate(): Promise<void> {
    logger.info('Authenticating with YouTube Data API');
    
    const credentials = await this.loadCredentials();
    
    // Initialize API clients
    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    this.analyticsClient = axios.create({
      baseURL: this.analyticsUrl,
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
      },
    });
    
    // Validate token by fetching channel info
    try {
      const response = await this.apiClient.get('/channels', {
        params: {
          part: 'snippet,statistics',
          mine: true,
        },
      });
      
      const channel = response.data.items[0];
      
      logger.info('YouTube authentication successful', {
        channelId: channel.id,
        channelTitle: channel.snippet.title,
        subscriberCount: channel.statistics.subscriberCount,
      });
      
      // Store channel ID for later use
      this.credentials!.accountId = channel.id;
    } catch (error) {
      logger.error('YouTube authentication failed', { error });
      throw new Error('Failed to authenticate with YouTube');
    }
  }

  /**
   * Publish content to YouTube
   */
  async publishContent(content: Content): Promise<PublishResult> {
    const startTime = Date.now();
    
    try {
      this.validateContent(content);
      
      if (!this.apiClient || !this.credentials) {
        await this.authenticate();
      }
      
      // YouTube only supports video content
      if (content.mediaType !== 'video') {
        throw new Error('YouTube only supports video content');
      }
      
      const result = await this.publishVideo(content);
      
      result.metrics = {
        totalTime: Date.now() - startTime,
      };
      
      this.logPublishingMetrics(result);
      return result;
      
    } catch (error) {
      logger.error('Failed to publish to YouTube', { error, content });
      
      return {
        success: false,
        error: {
          code: 'YOUTUBE_PUBLISH_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          retryable: this.isRetryableError(error),
        },
      };
    }
  }

  /**
   * Publish video to YouTube
   */
  private async publishVideo(content: Content): Promise<PublishResult> {
    return this.executeRequest(async () => {
      const isShort = this.isYouTubeShort(content);
      
      // Prepare video metadata
      const videoResource: YouTubeVideoResource = {
        snippet: {
          title: this.formatTitle(content.caption, isShort),
          description: this.formatDescription(content.caption, content.hashtags, isShort),
          tags: this.formatTags(content.hashtags, isShort),
          categoryId: content.platformSpecific?.youtube?.categoryId || '22', // People & Blogs
        },
        status: {
          privacyStatus: content.platformSpecific?.youtube?.privacyStatus || 'public',
          selfDeclaredMadeForKids: content.platformSpecific?.youtube?.madeForKids || false,
          embeddable: content.platformSpecific?.youtube?.embeddable !== false,
        },
      };
      
      // Step 1: Initialize resumable upload
      const uploadUrl = await this.initializeResumableUpload(videoResource);
      
      // Step 2: Upload video file
      const videoId = await this.uploadVideoFile(uploadUrl, content.videoUrl!);
      
      // Step 3: Wait for processing to complete
      await this.waitForProcessing(videoId);
      
      // Step 4: Set thumbnail if provided
      if (content.thumbnailUrl) {
        await this.setThumbnail(videoId, content.thumbnailUrl);
      }
      
      // Step 5: Get video URL
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      
      logger.info('Video published to YouTube', {
        videoId,
        videoUrl,
        isShort,
      });
      
      return {
        success: true,
        platformPostId: videoId,
        platformUrl: videoUrl,
        publishedAt: new Date().toISOString(),
      };
    }, 'publishVideo');
  }

  /**
   * Check if video qualifies as YouTube Short
   */
  private isYouTubeShort(content: Content): boolean {
    // YouTube Shorts criteria:
    // - Vertical video (9:16 aspect ratio)
    // - 60 seconds or less
    // - Contains #Shorts in title or description
    
    const duration = content.duration || 0;
    const aspectRatio = content.aspectRatio || '16:9';
    const hasShortTag = content.hashtags?.some(tag => 
      tag.toLowerCase().includes('shorts')
    );
    
    return (
      duration <= 60 &&
      (aspectRatio === '9:16' || hasShortTag)
    );
  }

  /**
   * Format title for YouTube
   */
  private formatTitle(caption: string, isShort: boolean): string {
    let title = caption.substring(0, 100); // YouTube title limit
    
    if (isShort && !title.includes('#Shorts')) {
      title = `${title} #Shorts`;
    }
    
    return title;
  }

  /**
   * Format description for YouTube
   */
  private formatDescription(caption: string, hashtags?: string[], isShort: boolean): string {
    let description = caption;
    
    if (hashtags && hashtags.length > 0) {
      const formattedHashtags = this.formatHashtags(hashtags);
      description = `${description}\n\n${formattedHashtags}`;
    }
    
    if (isShort && !description.includes('#Shorts')) {
      description = `${description}\n\n#Shorts`;
    }
    
    // Add any additional description elements
    // Maximum 5000 characters
    return description.substring(0, 5000);
  }

  /**
   * Format tags for YouTube
   */
  private formatTags(hashtags?: string[], isShort: boolean): string[] {
    const tags = hashtags?.map(tag => tag.replace('#', '')) || [];
    
    if (isShort && !tags.includes('Shorts')) {
      tags.push('Shorts');
    }
    
    // YouTube allows maximum 500 characters total for tags
    return tags.slice(0, 30); // Reasonable tag limit
  }

  /**
   * Initialize resumable upload
   */
  private async initializeResumableUpload(videoResource: YouTubeVideoResource): Promise<string> {
    const response = await axios.post(
      `${this.uploadUrl}/videos`,
      videoResource,
      {
        headers: {
          'Authorization': `Bearer ${this.credentials!.accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/*',
        },
        params: {
          part: 'snippet,status',
          uploadType: 'resumable',
        },
      }
    );
    
    const uploadUrl = response.headers.location;
    
    if (!uploadUrl) {
      throw new Error('Failed to get upload URL from YouTube');
    }
    
    return uploadUrl;
  }

  /**
   * Upload video file to YouTube
   */
  private async uploadVideoFile(uploadUrl: string, videoUrl: string): Promise<string> {
    try {
      // Download video from S3 or external URL
      const videoResponse = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
      });
      
      const videoBuffer = Buffer.from(videoResponse.data);
      
      // Upload to YouTube
      const uploadResponse = await axios.put(uploadUrl, videoBuffer, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': videoBuffer.length.toString(),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      
      const videoId = uploadResponse.data.id;
      
      logger.info('Video uploaded to YouTube', {
        videoId,
        size: videoBuffer.length,
      });
      
      return videoId;
    } catch (error) {
      logger.error('Failed to upload video to YouTube', { error });
      throw new Error('Video upload failed');
    }
  }

  /**
   * Wait for video processing to complete
   */
  private async waitForProcessing(videoId: string, maxWaitSeconds = 300): Promise<void> {
    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;
    
    while (Date.now() - startTime < maxWaitMs) {
      const response = await this.apiClient!.get('/videos', {
        params: {
          part: 'status,processingDetails',
          id: videoId,
        },
      });
      
      const video = response.data.items[0];
      const uploadStatus = video.status.uploadStatus;
      
      if (uploadStatus === 'processed') {
        return;
      }
      
      if (uploadStatus === 'failed' || uploadStatus === 'rejected') {
        const failureReason = video.status.failureReason || 'Unknown reason';
        throw new Error(`Video processing failed: ${failureReason}`);
      }
      
      // Log processing progress if available
      if (video.processingDetails?.processingProgress) {
        const progress = video.processingDetails.processingProgress;
        logger.info('Video processing progress', {
          videoId,
          partsProcessed: progress.partsProcessed,
          partsTotal: progress.partsTotal,
          timeLeftMs: progress.timeLeftMs,
        });
      }
      
      // Wait 5 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    throw new Error(`Video processing timeout after ${maxWaitSeconds} seconds`);
  }

  /**
   * Set video thumbnail
   */
  private async setThumbnail(videoId: string, thumbnailUrl: string): Promise<void> {
    try {
      // Download thumbnail
      const thumbnailResponse = await axios.get(thumbnailUrl, {
        responseType: 'arraybuffer',
      });
      
      const thumbnailBuffer = Buffer.from(thumbnailResponse.data);
      
      // Upload thumbnail to YouTube
      await axios.post(
        `${this.uploadUrl}/thumbnails/set`,
        thumbnailBuffer,
        {
          headers: {
            'Authorization': `Bearer ${this.credentials!.accessToken}`,
            'Content-Type': 'image/jpeg',
          },
          params: {
            videoId,
          },
        }
      );
      
      logger.info('Thumbnail set for YouTube video', { videoId });
    } catch (error) {
      // Thumbnail upload failure is not critical
      logger.warn('Failed to set video thumbnail', { videoId, error });
    }
  }

  /**
   * Get insights for a published video
   */
  async getInsights(videoId: string): Promise<Insights> {
    return this.executeRequest(async () => {
      if (!this.apiClient || !this.analyticsClient) {
        await this.authenticate();
      }
      
      // Get video statistics from Data API
      const videoResponse = await this.apiClient!.get('/videos', {
        params: {
          part: 'statistics',
          id: videoId,
        },
      });
      
      const stats = videoResponse.data.items[0]?.statistics || {};
      
      // Get additional analytics if available
      let analyticsData: any = {};
      try {
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];
        
        const analyticsResponse = await this.analyticsClient!.get('/reports', {
          params: {
            ids: `channel==${this.credentials!.accountId}`,
            startDate,
            endDate,
            metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage',
            dimensions: 'video',
            filters: `video==${videoId}`,
          },
        });
        
        if (analyticsResponse.data.rows?.length > 0) {
          const row = analyticsResponse.data.rows[0];
          analyticsData = {
            views: row[1],
            estimatedMinutesWatched: row[2],
            averageViewDuration: row[3],
            averageViewPercentage: row[4],
          };
        }
      } catch (error) {
        logger.warn('Failed to get YouTube Analytics data', { videoId, error });
      }
      
      return {
        impressions: parseInt(stats.viewCount) || 0,
        reach: parseInt(stats.viewCount) || 0,
        engagement: (
          parseInt(stats.likeCount || '0') +
          parseInt(stats.commentCount || '0')
        ),
        likes: parseInt(stats.likeCount) || 0,
        comments: parseInt(stats.commentCount) || 0,
        shares: 0, // YouTube doesn't provide share count via API
        views: parseInt(stats.viewCount) || 0,
        completionRate: analyticsData.averageViewPercentage || 0,
        platformSpecific: {
          youtube: {
            ...stats,
            ...analyticsData,
            dislikeCount: parseInt(stats.dislikeCount) || 0,
            favoriteCount: parseInt(stats.favoriteCount) || 0,
          },
        },
      };
    }, 'getInsights');
  }

  /**
   * Delete content from YouTube
   */
  async deleteContent(videoId: string): Promise<void> {
    return this.executeRequest(async () => {
      if (!this.apiClient) {
        await this.authenticate();
      }
      
      await this.apiClient!.delete('/videos', {
        params: {
          id: videoId,
        },
      });
      
      logger.info('Video deleted from YouTube', { videoId });
    }, 'deleteContent');
  }

  /**
   * Get default rate limit configuration
   */
  protected getDefaultRateLimitConfig(): RateLimitConfig {
    // YouTube has a daily quota of 10,000 units
    // Different operations cost different amounts
    return {
      maxRequestsPerHour: 100,
      maxRequestsPerDay: 500,
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
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        refresh_token: this.credentials.refreshToken,
        grant_type: 'refresh_token',
      });
      
      this.credentials.accessToken = response.data.access_token;
      this.credentials.expiresAt = new Date(
        Date.now() + response.data.expires_in * 1000
      ).toISOString();
      
      // TODO: Save updated credentials to Secrets Manager
      
      logger.info('YouTube access token refreshed');
    } catch (error) {
      logger.error('Failed to refresh YouTube access token', { error });
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
    const errorReason = error.response.data?.error?.errors?.[0]?.reason;
    
    // Rate limit errors
    if (status === 429 || status === 403 && errorReason === 'quotaExceeded') {
      return true;
    }
    
    // Server errors
    if (status >= 500) {
      return true;
    }
    
    // Specific YouTube errors that are retryable
    const retryableReasons = [
      'quotaExceeded',
      'rateLimitExceeded',
      'userRateLimitExceeded',
      'backendError',
      'uploadLimitExceeded',
      'processingFailed',
    ];
    
    return retryableReasons.includes(errorReason);
  }
}