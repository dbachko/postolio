/**
 * Base Platform Connector
 * Abstract class for all social media platform connectors
 */
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
export declare abstract class BasePlatformConnector {
    protected readonly platform: string;
    protected credentials?: PlatformCredentials;
    protected rateLimitConfig: RateLimitConfig;
    protected requestCount: number;
    protected lastRequestTime: number;
    constructor(platform: string);
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
    protected loadCredentials(): Promise<PlatformCredentials>;
    /**
     * Save credentials to AWS Secrets Manager
     */
    protected saveCredentials(credentials: PlatformCredentials): Promise<void>;
    /**
     * Handle rate limiting
     */
    protected handleRateLimit(): Promise<void>;
    /**
     * Execute platform API request with retry and circuit breaker
     */
    protected executeRequest<T>(operation: () => Promise<T>, operationName: string): Promise<T>;
    /**
     * Format hashtags for the platform
     */
    protected formatHashtags(hashtags?: string[]): string;
    /**
     * Build caption with hashtags
     */
    protected buildFullCaption(caption: string, hashtags?: string[]): string;
    /**
     * Validate content before publishing
     */
    protected validateContent(content: Content): void;
    /**
     * Log publishing metrics
     */
    protected logPublishingMetrics(result: PublishResult): void;
}
