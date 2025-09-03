/**
 * Rate Limiter Service
 * Token bucket algorithm with DynamoDB persistence for distributed rate limiting
 */
export interface RateLimitConfig {
    maxTokens: number;
    refillRate: number;
    windowSizeMs?: number;
    burstCapacity?: number;
}
export interface RateLimitResult {
    allowed: boolean;
    remainingTokens: number;
    nextRefillAt: number;
    retryAfterMs?: number;
    reason?: string;
}
export declare class RateLimiter {
    private static instance;
    private configs;
    static getInstance(): RateLimiter;
    constructor();
    /**
     * Check rate limit using token bucket algorithm
     */
    checkRateLimit(key: string, configKey?: string, tokensRequested?: number): Promise<RateLimitResult>;
    /**
     * Check rate limit with sliding window algorithm
     */
    checkSlidingWindowLimit(key: string, configKey: string, windowSizeMs?: number): Promise<RateLimitResult>;
    /**
     * Check IP-based rate limit
     */
    checkIPRateLimit(ipAddress: string, service: string, tier?: string): Promise<RateLimitResult>;
    /**
     * Check user-based rate limit
     */
    checkUserRateLimit(userId: string, service: string, tier?: string): Promise<RateLimitResult>;
    /**
     * Get token bucket from DynamoDB
     */
    private getBucket;
    /**
     * Update token bucket in DynamoDB
     */
    private updateBucket;
    /**
     * Get request history for sliding window
     */
    private getRequestHistory;
    /**
     * Update request history for sliding window
     */
    private updateRequestHistory;
    /**
     * Get rate limit configuration
     */
    private getConfig;
    /**
     * Extract config from bucket key
     */
    private getConfigFromKey;
    /**
     * Record CloudWatch metric
     */
    private recordMetric;
    /**
     * Reset rate limit for a specific key
     */
    resetRateLimit(key: string, configKey: string): Promise<void>;
    /**
     * Get current rate limit status
     */
    getRateLimitStatus(key: string, configKey: string): Promise<any>;
    /**
     * Configure custom rate limit
     */
    setConfig(configKey: string, config: RateLimitConfig): void;
}
export declare const rateLimiter: RateLimiter;
