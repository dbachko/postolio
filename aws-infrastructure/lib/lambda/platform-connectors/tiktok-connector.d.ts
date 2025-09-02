/**
 * TikTok API v2 Connector
 * Handles publishing to TikTok Business accounts
 */
import { BasePlatformConnector, Content, PublishResult, Insights, RateLimitConfig } from './base-connector';
export declare class TikTokConnector extends BasePlatformConnector {
    private apiClient?;
    private readonly baseUrl;
    constructor();
    /**
     * Authenticate with TikTok API
     */
    authenticate(): Promise<void>;
    /**
     * Publish content to TikTok
     */
    publishContent(content: Content): Promise<PublishResult>;
    /**
     * Publish video to TikTok
     */
    private publishVideo;
    /**
     * Initialize video upload
     */
    private initializeVideoUpload;
    /**
     * Upload video file to TikTok
     */
    private uploadVideoFile;
    /**
     * Get insights for a published post
     */
    getInsights(postId: string): Promise<Insights>;
    /**
     * Delete content from TikTok
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
    /**
     * Generate signature for TikTok requests (if needed)
     */
    private generateSignature;
}
