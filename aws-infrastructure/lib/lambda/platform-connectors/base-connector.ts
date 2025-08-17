/**
 * Base Platform Connector
 * Abstract class for all social media platform connectors
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { retryWithCircuitBreaker } from '../../shared/retry-utils';

// Initialize Powertools
const logger = new Logger({ serviceName: 'platform-connector' });
const metrics = new Metrics({ namespace: 'ContentScheduler', serviceName: 'platform-connector' });
const tracer = new Tracer({ serviceName: 'platform-connector' });

// Initialize AWS SDK clients
const secretsClient = tracer.captureAWSv3Client(new SecretsManagerClient({}));

export interface Content {
  contentId: string;
  caption: string;
  hashtags?: string[];
  mediaUrl?: string;
  mediaType: 'image' | 'video' | 'carousel';
  videoUrl?: string;
  thumbnailUrl?: string;
  aspectRatio?: string;
  duration?: number;
  platformSpecific?: Record<string, any>;
}

export interface PublishResult {
  success: boolean;
  platformPostId?: string;
  platformUrl?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  publishedAt?: string;
  metrics?: {
    uploadTime?: number;
    processingTime?: number;
    totalTime?: number;
  };
}

export interface Insights {
  impressions: number;
  reach: number;
  engagement: number;
  likes: number;
  comments: number;
  shares: number;
  saves?: number;
  views?: number;
  completionRate?: number;
  platformSpecific?: Record<string, any>;
}

export interface PlatformCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  clientId?: string;
  clientSecret?: string;
  pageId?: string;
  accountId?: string;
}

export interface RateLimitConfig {
  maxRequestsPerHour: number;
  maxRequestsPerDay: number;
  burstLimit: number;
  retryAfterSeconds?: number;
}

export abstract class BasePlatformConnector {
  protected readonly platform: string;
  protected credentials?: PlatformCredentials;
  protected rateLimitConfig: RateLimitConfig;
  protected requestCount = 0;
  protected lastRequestTime = 0;

  constructor(platform: string) {
    this.platform = platform;
    this.rateLimitConfig = this.getDefaultRateLimitConfig();
    
    logger.addPersistentLogAttributes({
      platform: this.platform,
    });
  }

  /**
   * Authenticate with the platform
   */
  abstract authenticate(): Promise<void>;

  /**
   * Publish content to the platform
   */
  abstract publishContent(content: Content): Promise<PublishResult>;

  /**
   * Get insights for a published post
   */
  abstract getInsights(postId: string): Promise<Insights>;

  /**
   * Delete content from the platform
   */
  abstract deleteContent(postId: string): Promise<void>;

  /**
   * Get default rate limit configuration for the platform
   */
  protected abstract getDefaultRateLimitConfig(): RateLimitConfig;

  /**
   * Refresh access token if needed
   */
  protected abstract refreshAccessToken(): Promise<void>;

  /**
   * Load credentials from AWS Secrets Manager
   */
  protected async loadCredentials(): Promise<PlatformCredentials> {
    try {
      const secretName = `${this.platform}-api-credentials`;
      const response = await secretsClient.send(new GetSecretValueCommand({
        SecretId: secretName,
      }));

      if (!response.SecretString) {
        throw new Error(`No credentials found for ${this.platform}`);
      }

      const credentials = JSON.parse(response.SecretString) as PlatformCredentials;
      
      // Check if token needs refresh
      if (credentials.expiresAt && new Date(credentials.expiresAt) <= new Date()) {
        logger.info('Access token expired, refreshing', { platform: this.platform });
        await this.refreshAccessToken();
      }

      this.credentials = credentials;
      return credentials;
    } catch (error) {
      logger.error('Failed to load credentials', { platform: this.platform, error });
      throw new Error(`Failed to load ${this.platform} credentials: ${error}`);
    }
  }

  /**
   * Handle rate limiting
   */
  protected async handleRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    // Check burst limit
    if (timeSinceLastRequest < 1000) {
      const delayMs = 1000 - timeSinceLastRequest;
      logger.info('Rate limit: delaying request', { 
        platform: this.platform, 
        delayMs 
      });
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    // Check hourly limit
    if (this.requestCount >= this.rateLimitConfig.maxRequestsPerHour) {
      const waitTime = this.rateLimitConfig.retryAfterSeconds || 3600;
      logger.warn('Rate limit exceeded, waiting', { 
        platform: this.platform, 
        waitTimeSeconds: waitTime 
      });
      
      metrics.addMetric(`RateLimitExceeded_${this.platform}`, MetricUnit.Count, 1);
      
      throw new Error(`Rate limit exceeded for ${this.platform}. Retry after ${waitTime} seconds`);
    }

    this.requestCount++;
    this.lastRequestTime = Date.now();
  }

  /**
   * Execute platform API request with retry and circuit breaker
   */
  protected async executeRequest<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      await this.handleRateLimit();
      
      const result = await retryWithCircuitBreaker(
        operation,
        this.platform,
        {
          maxRetries: 3,
          baseDelayMs: 2000,
          maxDelayMs: 30000,
        }
      );
      
      const duration = Date.now() - startTime;
      logger.info('Platform request successful', {
        platform: this.platform,
        operation: operationName,
        durationMs: duration,
      });
      
      metrics.addMetric(`PlatformRequest_${this.platform}_Success`, MetricUnit.Count, 1);
      metrics.addMetric(`PlatformRequest_${this.platform}_Duration`, MetricUnit.Milliseconds, duration);
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Platform request failed', {
        platform: this.platform,
        operation: operationName,
        error,
        durationMs: duration,
      });
      
      metrics.addMetric(`PlatformRequest_${this.platform}_Failure`, MetricUnit.Count, 1);
      
      throw error;
    }
  }

  /**
   * Format hashtags for the platform
   */
  protected formatHashtags(hashtags?: string[]): string {
    if (!hashtags || hashtags.length === 0) {
      return '';
    }
    
    return hashtags
      .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
      .join(' ');
  }

  /**
   * Build caption with hashtags
   */
  protected buildFullCaption(caption: string, hashtags?: string[]): string {
    const formattedHashtags = this.formatHashtags(hashtags);
    return formattedHashtags ? `${caption}\n\n${formattedHashtags}` : caption;
  }

  /**
   * Validate content before publishing
   */
  protected validateContent(content: Content): void {
    if (!content.contentId) {
      throw new Error('Content ID is required');
    }

    if (!content.caption && !content.mediaUrl && !content.videoUrl) {
      throw new Error('Content must have either caption or media');
    }

    if (content.mediaType === 'video' && !content.videoUrl) {
      throw new Error('Video URL is required for video content');
    }

    if (content.mediaType === 'image' && !content.mediaUrl) {
      throw new Error('Media URL is required for image content');
    }
  }

  /**
   * Log publishing metrics
   */
  protected logPublishingMetrics(result: PublishResult): void {
    if (result.success) {
      metrics.addMetric(`Publishing_${this.platform}_Success`, MetricUnit.Count, 1);
      
      if (result.metrics?.totalTime) {
        metrics.addMetric(
          `Publishing_${this.platform}_Duration`, 
          MetricUnit.Milliseconds, 
          result.metrics.totalTime
        );
      }
    } else {
      metrics.addMetric(`Publishing_${this.platform}_Failure`, MetricUnit.Count, 1);
      
      if (result.error?.retryable) {
        metrics.addMetric(`Publishing_${this.platform}_Retryable`, MetricUnit.Count, 1);
      }
    }
    
    metrics.publishStoredMetrics();
  }
}