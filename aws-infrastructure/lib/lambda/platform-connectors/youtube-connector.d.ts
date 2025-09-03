/**
 * YouTube Data API v3 Connector
 * Handles publishing to YouTube channels, including Shorts
 */
import { BasePlatformConnector, Content, PublishResult, Insights, RateLimitConfig } from './base-connector';
export declare class YouTubeConnector extends BasePlatformConnector {
    private apiClient?;
    private analyticsClient?;
    private readonly baseUrl;
    private readonly analyticsUrl;
    private readonly uploadUrl;
    constructor();
    /**
     * Authenticate with YouTube Data API
     */
    authenticate(): Promise<void>;
    /**
     * Publish content to YouTube
     */
    publishContent(content: Content): Promise<PublishResult>;
    /**
     * Publish video to YouTube
     */
    private publishVideo;
    /**
     * Check if video qualifies as YouTube Short
     */
    private isYouTubeShort;
    /**
     * Format title for YouTube
     */
    private formatTitle;
    /**
     * Format description for YouTube
     */
    private formatDescription;
    /**
     * Format tags for YouTube
     */
    private formatTags;
    /**
     * Initialize resumable upload
     */
    private initializeResumableUpload;
    /**
     * Upload video file to YouTube
     */
    private uploadVideoFile;
    /**
     * Wait for video processing to complete
     */
    private waitForProcessing;
    /**
     * Set video thumbnail
     */
    private setThumbnail;
    /**
     * Get insights for a published video
     */
    getInsights(videoId: string): Promise<Insights>;
    /**
     * Delete content from YouTube
     */
    deleteContent(videoId: string): Promise<void>;
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
