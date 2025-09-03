/**
 * Instagram Graph API Connector
 * Handles publishing to Instagram Business/Creator accounts
 */
import { BasePlatformConnector, Content, PublishResult, Insights, RateLimitConfig } from './base-connector';
export declare class InstagramConnector extends BasePlatformConnector {
    private apiClient?;
    private readonly baseUrl;
    constructor();
    /**
     * Authenticate with Instagram Graph API
     */
    authenticate(): Promise<void>;
    /**
     * Publish content to Instagram
     */
    publishContent(content: Content): Promise<PublishResult>;
    /**
     * Publish image to Instagram
     */
    private publishImage;
    /**
     * Publish Reel (video) to Instagram
     */
    private publishReel;
    /**
     * Publish carousel to Instagram
     */
    private publishCarousel;
    /**
     * Wait for media container to be ready
     */
    private waitForContainer;
    /**
     * Get insights for a published post
     */
    getInsights(postId: string): Promise<Insights>;
    /**
     * Delete content from Instagram
     */
    deleteContent(postId: string): Promise<void>;
    /**
     * Get default rate limit configuration
     */
    protected getDefaultRateLimitConfig(): RateLimitConfig;
    /**
     * Refresh access token
     */
    protected refreshAccessToken(): Promise<void>;
    /**
     * Check if error is retryable
     */
    private isRetryableError;
}
