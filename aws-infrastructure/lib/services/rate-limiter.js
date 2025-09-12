"use strict";
/**
 * Rate Limiter Service
 * Token bucket algorithm with DynamoDB persistence for distributed rate limiting
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimiter = exports.RateLimiter = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_cloudwatch_1 = require("@aws-sdk/client-cloudwatch");
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const cloudWatchClient = new client_cloudwatch_1.CloudWatchClient({});
const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE_NAME || 'rate-limits';
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';
class RateLimiter {
    static instance;
    configs = new Map();
    static getInstance() {
        if (!RateLimiter.instance) {
            RateLimiter.instance = new RateLimiter();
        }
        return RateLimiter.instance;
    }
    constructor() {
        // Initialize default rate limit configurations
        this.configs.set('token-service:default', {
            maxTokens: 100,
            refillRate: 1, // 1 token per second
            burstCapacity: 20,
        });
        this.configs.set('token-service:premium', {
            maxTokens: 500,
            refillRate: 5, // 5 tokens per second
            burstCapacity: 100,
        });
        this.configs.set('token-service:enterprise', {
            maxTokens: 2000,
            refillRate: 20, // 20 tokens per second
            burstCapacity: 500,
        });
        this.configs.set('publisher:default', {
            maxTokens: 50,
            refillRate: 0.5, // 1 token per 2 seconds
            burstCapacity: 10,
        });
        this.configs.set('scheduler:default', {
            maxTokens: 200,
            refillRate: 2,
            burstCapacity: 50,
        });
    }
    /**
     * Check rate limit using token bucket algorithm
     */
    async checkRateLimit(key, configKey = 'default', tokensRequested = 1) {
        const config = this.getConfig(configKey);
        const bucketKey = `${configKey}:${key}`;
        try {
            // Get current bucket state
            const bucket = await this.getBucket(bucketKey);
            const now = Date.now();
            // Calculate tokens to add based on time elapsed
            const timeSinceLastRefill = now - bucket.lastRefillTime;
            const tokensToAdd = Math.floor((timeSinceLastRefill / 1000) * config.refillRate);
            // Update token count (capped at max + burst capacity)
            const maxCapacity = config.maxTokens + (config.burstCapacity || 0);
            const currentTokens = Math.min(bucket.tokens + tokensToAdd, maxCapacity);
            // Check if request can be fulfilled
            if (currentTokens >= tokensRequested) {
                // Consume tokens
                const newTokenCount = currentTokens - tokensRequested;
                await this.updateBucket(bucketKey, newTokenCount, now);
                // Record successful request metric
                await this.recordMetric(configKey, 'Allowed', 1);
                return {
                    allowed: true,
                    remainingTokens: newTokenCount,
                    nextRefillAt: now + (1000 / config.refillRate),
                };
            }
            else {
                // Calculate retry after time
                const tokensNeeded = tokensRequested - currentTokens;
                const retryAfterMs = Math.ceil((tokensNeeded / config.refillRate) * 1000);
                // Record rate limited metric
                await this.recordMetric(configKey, 'RateLimited', 1);
                return {
                    allowed: false,
                    remainingTokens: currentTokens,
                    nextRefillAt: now + retryAfterMs,
                    retryAfterMs,
                    reason: `Rate limit exceeded. Need ${tokensNeeded} more tokens.`,
                };
            }
        }
        catch (error) {
            console.error('Rate limit check error:', error);
            // Fail open on errors to avoid blocking legitimate requests
            return {
                allowed: true,
                remainingTokens: 0,
                nextRefillAt: Date.now() + 1000,
            };
        }
    }
    /**
     * Check rate limit with sliding window algorithm
     */
    async checkSlidingWindowLimit(key, configKey, windowSizeMs = 60000 // 1 minute default
    ) {
        const config = this.getConfig(configKey);
        const windowKey = `window:${configKey}:${key}`;
        const now = Date.now();
        const windowStart = now - windowSizeMs;
        try {
            // Get request history
            const history = await this.getRequestHistory(windowKey);
            // Filter requests within window
            const requestsInWindow = history.filter(timestamp => timestamp > windowStart);
            // Check if under limit
            if (requestsInWindow.length < config.maxTokens) {
                // Add current request to history
                requestsInWindow.push(now);
                await this.updateRequestHistory(windowKey, requestsInWindow, windowSizeMs);
                await this.recordMetric(configKey, 'SlidingWindowAllowed', 1);
                return {
                    allowed: true,
                    remainingTokens: config.maxTokens - requestsInWindow.length,
                    nextRefillAt: requestsInWindow[0] + windowSizeMs,
                };
            }
            else {
                // Calculate when oldest request expires
                const oldestRequest = Math.min(...requestsInWindow);
                const retryAfterMs = oldestRequest + windowSizeMs - now;
                await this.recordMetric(configKey, 'SlidingWindowRateLimited', 1);
                return {
                    allowed: false,
                    remainingTokens: 0,
                    nextRefillAt: oldestRequest + windowSizeMs,
                    retryAfterMs,
                    reason: `Rate limit exceeded. Window: ${windowSizeMs}ms, Limit: ${config.maxTokens}`,
                };
            }
        }
        catch (error) {
            console.error('Sliding window check error:', error);
            return {
                allowed: true,
                remainingTokens: 0,
                nextRefillAt: Date.now() + 1000,
            };
        }
    }
    /**
     * Check IP-based rate limit
     */
    async checkIPRateLimit(ipAddress, service, tier = 'default') {
        const key = `ip:${ipAddress}:${service}`;
        const configKey = `${service}:${tier}`;
        // Apply stricter limits for IP-based checks
        const ipConfig = this.getConfig(configKey);
        ipConfig.maxTokens = Math.floor(ipConfig.maxTokens * 0.5); // 50% of user limit
        ipConfig.refillRate = ipConfig.refillRate * 0.5; // Slower refill
        return this.checkRateLimit(key, configKey);
    }
    /**
     * Check user-based rate limit
     */
    async checkUserRateLimit(userId, service, tier = 'default') {
        const key = `user:${userId}:${service}`;
        const configKey = `${service}:${tier}`;
        return this.checkRateLimit(key, configKey);
    }
    /**
     * Get token bucket from DynamoDB
     */
    async getBucket(key) {
        try {
            const result = await docClient.send(new lib_dynamodb_1.GetCommand({
                TableName: RATE_LIMIT_TABLE,
                Key: { bucketKey: key },
            }));
            if (result.Item) {
                return {
                    tokens: result.Item.tokens,
                    lastRefillTime: result.Item.lastRefillTime,
                };
            }
        }
        catch (error) {
            console.error('Error getting bucket:', error);
        }
        // Return new bucket if not found
        const config = this.getConfigFromKey(key);
        return {
            tokens: config.maxTokens,
            lastRefillTime: Date.now(),
        };
    }
    /**
     * Update token bucket in DynamoDB
     */
    async updateBucket(key, tokens, lastRefillTime) {
        try {
            await docClient.send(new lib_dynamodb_1.UpdateCommand({
                TableName: RATE_LIMIT_TABLE,
                Key: { bucketKey: key },
                UpdateExpression: 'SET tokens = :tokens, lastRefillTime = :time, updatedAt = :now',
                ExpressionAttributeValues: {
                    ':tokens': tokens,
                    ':time': lastRefillTime,
                    ':now': new Date().toISOString(),
                },
            }));
        }
        catch (error) {
            console.error('Error updating bucket:', error);
        }
    }
    /**
     * Get request history for sliding window
     */
    async getRequestHistory(key) {
        try {
            const result = await docClient.send(new lib_dynamodb_1.GetCommand({
                TableName: RATE_LIMIT_TABLE,
                Key: { bucketKey: key },
            }));
            if (result.Item?.requestHistory) {
                return result.Item.requestHistory;
            }
        }
        catch (error) {
            console.error('Error getting request history:', error);
        }
        return [];
    }
    /**
     * Update request history for sliding window
     */
    async updateRequestHistory(key, history, windowSizeMs) {
        try {
            await docClient.send(new lib_dynamodb_1.PutCommand({
                TableName: RATE_LIMIT_TABLE,
                Item: {
                    bucketKey: key,
                    requestHistory: history,
                    updatedAt: new Date().toISOString(),
                    ttl: Math.floor((Date.now() + windowSizeMs * 2) / 1000), // Expire after 2x window
                },
            }));
        }
        catch (error) {
            console.error('Error updating request history:', error);
        }
    }
    /**
     * Get rate limit configuration
     */
    getConfig(configKey) {
        // Try to get specific config
        let config = this.configs.get(configKey);
        // Fall back to service default
        if (!config) {
            const [service] = configKey.split(':');
            config = this.configs.get(`${service}:default`);
        }
        // Fall back to global default
        if (!config) {
            config = this.configs.get('token-service:default');
        }
        return { ...config }; // Return copy to avoid mutations
    }
    /**
     * Extract config from bucket key
     */
    getConfigFromKey(bucketKey) {
        const [configKey] = bucketKey.split(':');
        return this.getConfig(configKey);
    }
    /**
     * Record CloudWatch metric
     */
    async recordMetric(configKey, metricName, value) {
        try {
            await cloudWatchClient.send(new client_cloudwatch_1.PutMetricDataCommand({
                Namespace: 'Postolio/RateLimit',
                MetricData: [{
                        MetricName: metricName,
                        Value: value,
                        Unit: 'Count',
                        Dimensions: [
                            { Name: 'ConfigKey', Value: configKey },
                            { Name: 'Environment', Value: ENVIRONMENT },
                        ],
                        Timestamp: new Date(),
                    }],
            }));
        }
        catch (error) {
            console.error('Error recording metric:', error);
        }
    }
    /**
     * Reset rate limit for a specific key
     */
    async resetRateLimit(key, configKey) {
        const config = this.getConfig(configKey);
        const bucketKey = `${configKey}:${key}`;
        await docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: RATE_LIMIT_TABLE,
            Item: {
                bucketKey,
                tokens: config.maxTokens,
                lastRefillTime: Date.now(),
                updatedAt: new Date().toISOString(),
            },
        }));
    }
    /**
     * Get current rate limit status
     */
    async getRateLimitStatus(key, configKey) {
        const bucketKey = `${configKey}:${key}`;
        const bucket = await this.getBucket(bucketKey);
        const config = this.getConfig(configKey);
        return {
            currentTokens: bucket.tokens,
            maxTokens: config.maxTokens,
            refillRate: config.refillRate,
            lastRefillTime: bucket.lastRefillTime,
            nextRefillAt: bucket.lastRefillTime + (1000 / config.refillRate),
        };
    }
    /**
     * Configure custom rate limit
     */
    setConfig(configKey, config) {
        this.configs.set(configKey, config);
    }
}
exports.RateLimiter = RateLimiter;
// Export singleton instance
exports.rateLimiter = RateLimiter.getInstance();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmF0ZS1saW1pdGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicmF0ZS1saW1pdGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7O0dBR0c7OztBQUVILDhEQUF5RDtBQUN6RCx3REFBcUc7QUFDckcsa0VBQW1GO0FBRW5GLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtBQUMzQyxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUE7QUFDM0QsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLG9DQUFnQixDQUFDLEVBQUUsQ0FBQyxDQUFBO0FBRWpELE1BQU0sZ0JBQWdCLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQkFBcUIsSUFBSSxhQUFhLENBQUE7QUFDM0UsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksS0FBSyxDQUFBO0FBaUJwRCxNQUFhLFdBQVc7SUFDZCxNQUFNLENBQUMsUUFBUSxDQUFhO0lBQzVCLE9BQU8sR0FBaUMsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUV6RCxNQUFNLENBQUMsV0FBVztRQUNoQixJQUFJLENBQUMsV0FBVyxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQzFCLFdBQVcsQ0FBQyxRQUFRLEdBQUcsSUFBSSxXQUFXLEVBQUUsQ0FBQTtRQUMxQyxDQUFDO1FBQ0QsT0FBTyxXQUFXLENBQUMsUUFBUSxDQUFBO0lBQzdCLENBQUM7SUFFRDtRQUNFLCtDQUErQztRQUMvQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyx1QkFBdUIsRUFBRTtZQUN4QyxTQUFTLEVBQUUsR0FBRztZQUNkLFVBQVUsRUFBRSxDQUFDLEVBQUcscUJBQXFCO1lBQ3JDLGFBQWEsRUFBRSxFQUFFO1NBQ2xCLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLHVCQUF1QixFQUFFO1lBQ3hDLFNB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QUFHLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUM5QyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBRXhDLE9BQU87WUFDTCxhQUFhLEVBQUUsTUFBTSxDQUFDLE1BQU07WUFDNUIsU0FBUyxFQUFFLE1BQU0sQ0FBQyxTQUFTO1lBQzNCLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVTtZQUM3QixjQUFjLEVBQUUsTUFBTSxDQUFDLGNBQWM7WUFDckMsWUFBWSxFQUFFLE1BQU0sQ0FBQyxjQUFjLEdBQUcsQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQztTQUNqRSxDQUFBO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ0gsU0FBUyxDQUFDLFNBQWlCLEVBQUUsTUFBdUI7UUFDbEQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLE1BQU0sQ0FBQyxDQUFBO0lBQ3JDLENBQUM7Q0FDRjtBQXJZRCxrQ0FxWUM7QUFFRCw0QkFBNEI7QUFDZixRQUFBLFdBQVcsR0FBRyxXQUFXLENBQUMsV0FBVyxFQUFFLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFJhdGUgTGltaXRlciBTZXJ2aWNlXG4gKiBUb2tlbiBidWNrZXQgYWxnb3JpdGhtIHdpdGggRHluYW1vREIgcGVyc2lzdGVuY2UgZm9yIGRpc3RyaWJ1dGVkIHJhdGUgbGltaXRpbmdcbiAqL1xuXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYidcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIEdldENvbW1hbmQsIFVwZGF0ZUNvbW1hbmQsIFB1dENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInXG5pbXBvcnQgeyBDbG91ZFdhdGNoQ2xpZW50LCBQdXRNZXRyaWNEYXRhQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1jbG91ZHdhdGNoJ1xuXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KVxuY29uc3QgY2xvdWRXYXRjaENsaWVudCA9IG5ldyBDbG91ZFdhdGNoQ2xpZW50KHt9KVxuXG5jb25zdCBSQVRFX0xJTUlUX1RBQkxFID0gcHJvY2Vzcy5lbnYuUkFURV9MSU1JVF9UQUJMRV9OQU1FIHx8ICdyYXRlLWxpbWl0cydcbmNvbnN0IEVOVklST05NRU5UID0gcHJvY2Vzcy5lbnYuRU5WSVJPTk1FTlQgfHwgJ2RldidcblxuZXhwb3J0IGludGVyZmFjZSBSYXRlTGltaXRDb25maWcge1xuICBtYXhUb2tlbnM6IG51bWJlclxuICByZWZpbGxSYXRlOiBudW1iZXIgIC8vIFRva2VucyBwZXIgc2Vjb25kXG4gIHdpbmRvd1NpemVNcz86IG51bWJlciAgLy8gU2xpZGluZyB3aW5kb3cgc2l6ZSAob3B0aW9uYWwpXG4gIGJ1cnN0Q2FwYWNpdHk/OiBudW1iZXIgIC8vIEFsbG93IHRlbXBvcmFyeSBidXJzdHNcbn1cblxuZXhwb3J0IGludGVyZmFjZSBSYXRlTGltaXRSZXN1bHQge1xuICBhbGxvd2VkOiBib29sZWFuXG4gIHJlbWFpbmluZ1Rva2VuczogbnVtYmVyXG4gIG5leHRSZWZpbGxBdDogbnVtYmVyXG4gIHJldHJ5QWZ0ZXJNcz86IG51bWJlclxuICByZWFzb24/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGNsYXNzIFJhdGVMaW1pdGVyIHtcbiAgcHJpdmF0ZSBzdGF0aWMgaW5zdGFuY2U6IFJhdGVMaW1pdGVyXG4gIHByaXZhdGUgY29uZmlnczogTWFwPHN0cmluZywgUmF0ZUxpbWl0Q29uZmlnPiA9IG5ldyBNYXAoKVxuICBcbiAgc3RhdGljIGdldEluc3RhbmNlKCk6IFJhdGVMaW1pdGVyIHtcbiAgICBpZiAoIVJhdGVMaW1pdGVyLmluc3RhbmNlKSB7XG4gICAgICBSYXRlTGltaXRlci5pbnN0YW5jZSA9IG5ldyBSYXRlTGltaXRlcigpXG4gICAgfVxuICAgIHJldHVybiBSYXRlTGltaXRlci5pbnN0YW5jZVxuICB9XG4gIFxuICBjb25zdHJ1Y3RvcigpIHtcbiAgICAvLyBJbml0aWFsaXplIGRlZmF1bHQgcmF0ZSBsaW1pdCBjb25maWd1cmF0aW9uc1xuICAgIHRoaXMuY29uZmlncy5zZXQoJ3Rva2VuLXNlcnZpY2U6ZGVmYXVsdCcsIHtcbiAgICAgIG1heFRva2VuczogMTAwLFxuICAgICAgcmVmaWxsUmF0ZTogMSwgIC8vIDEgdG9rZW4gcGVyIHNlY29uZFxuICAgICAgYnVyc3RDYXBhY2l0eTogMjAsXG4gICAgfSlcbiAgICBcbiAgICB0aGlzLmNvbmZpZ3Muc2V0KCd0b2tlbi1zZXJ2aWNlOnByZW1pdW0nLCB7XG4gICAgICBtYXhUb2tlbnM6IDUwMCxcbiAgICAgIHJlZmlsbFJhdGU6IDUsICAvLyA1IHRva2VucyBwZXIgc2Vjb25kXG4gICAgICBidXJzdENhcGFjaXR5OiAxMDAsXG4gICAgfSlcbiAgICBcbiAgICB0aGlzLmNvbmZpZ3Muc2V0KCd0b2tlbi1zZXJ2aWNlOmVudGVycHJpc2UnLCB7XG4gICAgICBtYXhUb2tlbnM6IDIwMDAsXG4gICAgICByZWZpbGxSYXRlOiAyMCwgIC8vIDIwIHRva2VucyBwZXIgc2Vjb25kXG4gICAgICBidXJzdENhcGFjaXR5OiA1MDAsXG4gICAgfSlcbiAgICBcbiAgICB0aGlzLmNvbmZpZ3Muc2V0KCdwdWJsaXNoZXI6ZGVmYXVsdCcsIHtcbiAgICAgIG1heFRva2VuczogNTAsXG4gICAgICByZWZpbGxSYXRlOiAwLjUsICAvLyAxIHRva2VuIHBlciAyIHNlY29uZHNcbiAgICAgIGJ1cnN0Q2FwYWNpdHk6IDEwLFxuICAgIH0pXG4gICAgXG4gICAgdGhpcy5jb25maWdzLnNldCgnc2NoZWR1bGVyOmRlZmF1bHQnLCB7XG4gICAgICBtYXhUb2tlbnM6IDIwMCxcbiAgICAgIHJlZmlsbFJhdGU6IDIsXG4gICAgICBidXJzdENhcGFjaXR5OiA1MCxcbiAgICB9KVxuICB9XG4gIFxuICAvKipcbiAgICogQ2hlY2sgcmF0ZSBsaW1pdCB1c2luZyB0b2tlbiBidWNrZXQgYWxnb3JpdGhtXG4gICAqL1xuICBhc3luYyBjaGVja1JhdGVMaW1pdChcbiAgICBrZXk6IHN0cmluZyxcbiAgICBjb25maWdLZXk6IHN0cmluZyA9ICdkZWZhdWx0JyxcbiAgICB0b2tlbnNSZXF1ZXN0ZWQ6IG51bWJlciA9IDFcbiAgKTogUHJvbWlzZTxSYXRlTGltaXRSZXN1bHQ+IHtcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldENvbmZpZyhjb25maWdLZXkpXG4gICAgY29uc3QgYnVja2V0S2V5ID0gYCR7Y29uZmlnS2V5fToke2tleX1gXG4gICAgXG4gICAgdHJ5IHtcbiAgICAgIC8vIEdldCBjdXJyZW50IGJ1Y2tldCBzdGF0ZVxuICAgICAgY29uc3QgYnVja2V0ID0gYXdhaXQgdGhpcy5nZXRCdWNrZXQoYnVja2V0S2V5KVxuICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgICAgXG4gICAgICAvLyBDYWxjdWxhdGUgdG9rZW5zIHRvIGFkZCBiYXNlZCBvbiB0aW1lIGVsYXBzZWRcbiAgICAgIGNvbnN0IHRpbWVTaW5jZUxhc3RSZWZpbGwgPSBub3cgLSBidWNrZXQubGFzdFJlZmlsbFRpbWVcbiAgICAgIGNvbnN0IHRva2Vuc1RvQWRkID0gTWF0aC5mbG9vcigodGltZVNpbmNlTGFzdFJlZmlsbCAvIDEwMDApICogY29uZmlnLnJlZmlsbFJhdGUpXG4gICAgICBcbiAgICAgIC8vIFVwZGF0ZSB0b2tlbiBjb3VudCAoY2FwcGVkIGF0IG1heCArIGJ1cnN0IGNhcGFjaXR5KVxuICAgICAgY29uc3QgbWF4Q2FwYWNpdHkgPSBjb25maWcubWF4VG9rZW5zICsgKGNvbmZpZy5idXJzdENhcGFjaXR5IHx8IDApXG4gICAgICBjb25zdCBjdXJyZW50VG9rZW5zID0gTWF0aC5taW4oYnVja2V0LnRva2VucyArIHRva2Vuc1RvQWRkLCBtYXhDYXBhY2l0eSlcbiAgICAgIFxuICAgICAgLy8gQ2hlY2sgaWYgcmVxdWVzdCBjYW4gYmUgZnVsZmlsbGVkXG4gICAgICBpZiAoY3VycmVudFRva2VucyA+PSB0b2tlbnNSZXF1ZXN0ZWQpIHtcbiAgICAgICAgLy8gQ29uc3VtZSB0b2tlbnNcbiAgICAgICAgY29uc3QgbmV3VG9rZW5Db3VudCA9IGN1cnJlbnRUb2tlbnMgLSB0b2tlbnNSZXF1ZXN0ZWRcbiAgICAgICAgYXdhaXQgdGhpcy51cGRhdGVCdWNrZXQoYnVja2V0S2V5LCBuZXdUb2tlbkNvdW50LCBub3cpXG4gICAgICAgIFxuICAgICAgICAvLyBSZWNvcmQgc3VjY2Vzc2Z1bCByZXF1ZXN0IG1ldHJpY1xuICAgICAgICBhd2FpdCB0aGlzLnJlY29yZE1ldHJpYyhjb25maWdLZXksICdBbGxvd2VkJywgMSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgYWxsb3dlZDogdHJ1ZSxcbiAgICAgICAgICByZW1haW5pbmdUb2tlbnM6IG5ld1Rva2VuQ291bnQsXG4gICAgICAgICAgbmV4dFJlZmlsbEF0OiBub3cgKyAoMTAwMCAvIGNvbmZpZy5yZWZpbGxSYXRlKSxcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ2FsY3VsYXRlIHJldHJ5IGFmdGVyIHRpbWVcbiAgICAgICAgY29uc3QgdG9rZW5zTmVlZGVkID0gdG9rZW5zUmVxdWVzdGVkIC0gY3VycmVudFRva2Vuc1xuICAgICAgICBjb25zdCByZXRyeUFmdGVyTXMgPSBNYXRoLmNlaWwoKHRva2Vuc05lZWRlZCAvIGNvbmZpZy5yZWZpbGxSYXRlKSAqIDEwMDApXG4gICAgICAgIFxuICAgICAgICAvLyBSZWNvcmQgcmF0ZSBsaW1pdGVkIG1ldHJpY1xuICAgICAgICBhd2FpdCB0aGlzLnJlY29yZE1ldHJpYyhjb25maWdLZXksICdSYXRlTGltaXRlZCcsIDEpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGFsbG93ZWQ6IGZhbHNlLFxuICAgICAgICAgIHJlbWFpbmluZ1Rva2VuczogY3VycmVudFRva2VucyxcbiAgICAgICAgICBuZXh0UmVmaWxsQXQ6IG5vdyArIHJldHJ5QWZ0ZXJNcyxcbiAgICAgICAgICByZXRyeUFmdGVyTXMsXG4gICAgICAgICAgcmVhc29uOiBgUmF0ZSBsaW1pdCBleGNlZWRlZC4gTmVlZCAke3Rva2Vuc05lZWRlZH0gbW9yZSB0b2tlbnMuYCxcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdSYXRlIGxpbWl0IGNoZWNrIGVycm9yOicsIGVycm9yKVxuICAgICAgXG4gICAgICAvLyBGYWlsIG9wZW4gb24gZXJyb3JzIHRvIGF2b2lkIGJsb2NraW5nIGxlZ2l0aW1hdGUgcmVxdWVzdHNcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFsbG93ZWQ6IHRydWUsXG4gICAgICAgIHJlbWFpbmluZ1Rva2VuczogMCxcbiAgICAgICAgbmV4dFJlZmlsbEF0OiBEYXRlLm5vdygpICsgMTAwMCxcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBDaGVjayByYXRlIGxpbWl0IHdpdGggc2xpZGluZyB3aW5kb3cgYWxnb3JpdGhtXG4gICAqL1xuICBhc3luYyBjaGVja1NsaWRpbmdXaW5kb3dMaW1pdChcbiAgICBrZXk6IHN0cmluZyxcbiAgICBjb25maWdLZXk6IHN0cmluZyxcbiAgICB3aW5kb3dTaXplTXM6IG51bWJlciA9IDYwMDAwICAvLyAxIG1pbnV0ZSBkZWZhdWx0XG4gICk6IFByb21pc2U8UmF0ZUxpbWl0UmVzdWx0PiB7XG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5nZXRDb25maWcoY29uZmlnS2V5KVxuICAgIGNvbnN0IHdpbmRvd0tleSA9IGB3aW5kb3c6JHtjb25maWdLZXl9OiR7a2V5fWBcbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpXG4gICAgY29uc3Qgd2luZG93U3RhcnQgPSBub3cgLSB3aW5kb3dTaXplTXNcbiAgICBcbiAgICB0cnkge1xuICAgICAgLy8gR2V0IHJlcXVlc3QgaGlzdG9yeVxuICAgICAgY29uc3QgaGlzdG9yeSA9IGF3YWl0IHRoaXMuZ2V0UmVxdWVzdEhpc3Rvcnkod2luZG93S2V5KVxuICAgICAgXG4gICAgICAvLyBGaWx0ZXIgcmVxdWVzdHMgd2l0aGluIHdpbmRvd1xuICAgICAgY29uc3QgcmVxdWVzdHNJbldpbmRvdyA9IGhpc3RvcnkuZmlsdGVyKHRpbWVzdGFtcCA9PiB0aW1lc3RhbXAgPiB3aW5kb3dTdGFydClcbiAgICAgIFxuICAgICAgLy8gQ2hlY2sgaWYgdW5kZXIgbGltaXRcbiAgICAgIGlmIChyZXF1ZXN0c0luV2luZG93Lmxlbmd0aCA8IGNvbmZpZy5tYXhUb2tlbnMpIHtcbiAgICAgICAgLy8gQWRkIGN1cnJlbnQgcmVxdWVzdCB0byBoaXN0b3J5XG4gICAgICAgIHJlcXVlc3RzSW5XaW5kb3cucHVzaChub3cpXG4gICAgICAgIGF3YWl0IHRoaXMudXBkYXRlUmVxdWVzdEhpc3Rvcnkod2luZG93S2V5LCByZXF1ZXN0c0luV2luZG93LCB3aW5kb3dTaXplTXMpXG4gICAgICAgIFxuICAgICAgICBhd2FpdCB0aGlzLnJlY29yZE1ldHJpYyhjb25maWdLZXksICdTbGlkaW5nV2luZG93QWxsb3dlZCcsIDEpXG4gICAgICAgIFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGFsbG93ZWQ6IHRydWUsXG4gICAgICAgICAgcmVtYWluaW5nVG9rZW5zOiBjb25maWcubWF4VG9rZW5zIC0gcmVxdWVzdHNJbldpbmRvdy5sZW5ndGgsXG4gICAgICAgICAgbmV4dFJlZmlsbEF0OiByZXF1ZXN0c0luV2luZG93WzBdICsgd2luZG93U2l6ZU1zLFxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBDYWxjdWxhdGUgd2hlbiBvbGRlc3QgcmVxdWVzdCBleHBpcmVzXG4gICAgICAgIGNvbnN0IG9sZGVzdFJlcXVlc3QgPSBNYXRoLm1pbiguLi5yZXF1ZXN0c0luV2luZG93KVxuICAgICAgICBjb25zdCByZXRyeUFmdGVyTXMgPSBvbGRlc3RSZXF1ZXN0ICsgd2luZG93U2l6ZU1zIC0gbm93XG4gICAgICAgIFxuICAgICAgICBhd2FpdCB0aGlzLnJlY29yZE1ldHJpYyhjb25maWdLZXksICdTbGlkaW5nV2luZG93UmF0ZUxpbWl0ZWQnLCAxKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBhbGxvd2VkOiBmYWxzZSxcbiAgICAgICAgICByZW1haW5pbmdUb2tlbnM6IDAsXG4gICAgICAgICAgbmV4dFJlZmlsbEF0OiBvbGRlc3RSZXF1ZXN0ICsgd2luZG93U2l6ZU1zLFxuICAgICAgICAgIHJldHJ5QWZ0ZXJNcyxcbiAgICAgICAgICByZWFzb246IGBSYXRlIGxpbWl0IGV4Y2VlZGVkLiBXaW5kb3c6ICR7d2luZG93U2l6ZU1zfW1zLCBMaW1pdDogJHtjb25maWcubWF4VG9rZW5zfWAsXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignU2xpZGluZyB3aW5kb3cgY2hlY2sgZXJyb3I6JywgZXJyb3IpXG4gICAgICByZXR1cm4ge1xuICAgICAgICBhbGxvd2VkOiB0cnVlLFxuICAgICAgICByZW1haW5pbmdUb2tlbnM6IDAsXG4gICAgICAgIG5leHRSZWZpbGxBdDogRGF0ZS5ub3coKSArIDEwMDAsXG4gICAgICB9XG4gICAgfVxuICB9XG4gIFxuICAvKipcbiAgICogQ2hlY2sgSVAtYmFzZWQgcmF0ZSBsaW1pdFxuICAgKi9cbiAgYXN5bmMgY2hlY2tJUFJhdGVMaW1pdChcbiAgICBpcEFkZHJlc3M6IHN0cmluZyxcbiAgICBzZXJ2aWNlOiBzdHJpbmcsXG4gICAgdGllcjogc3RyaW5nID0gJ2RlZmF1bHQnXG4gICk6IFByb21pc2U8UmF0ZUxpbWl0UmVzdWx0PiB7XG4gICAgY29uc3Qga2V5ID0gYGlwOiR7aXBBZGRyZXNzfToke3NlcnZpY2V9YFxuICAgIGNvbnN0IGNvbmZpZ0tleSA9IGAke3NlcnZpY2V9OiR7dGllcn1gXG4gICAgXG4gICAgLy8gQXBwbHkgc3RyaWN0ZXIgbGltaXRzIGZvciBJUC1iYXNlZCBjaGVja3NcbiAgICBjb25zdCBpcENvbmZpZyA9IHRoaXMuZ2V0Q29uZmlnKGNvbmZpZ0tleSlcbiAgICBpcENvbmZpZy5tYXhUb2tlbnMgPSBNYXRoLmZsb29yKGlwQ29uZmlnLm1heFRva2VucyAqIDAuNSkgIC8vIDUwJSBvZiB1c2VyIGxpbWl0XG4gICAgaXBDb25maWcucmVmaWxsUmF0ZSA9IGlwQ29uZmlnLnJlZmlsbFJhdGUgKiAwLjUgIC8vIFNsb3dlciByZWZpbGxcbiAgICBcbiAgICByZXR1cm4gdGhpcy5jaGVja1JhdGVMaW1pdChrZXksIGNvbmZpZ0tleSlcbiAgfVxuICBcbiAgLyoqXG4gICAqIENoZWNrIHVzZXItYmFzZWQgcmF0ZSBsaW1pdFxuICAgKi9cbiAgYXN5bmMgY2hlY2tVc2VyUmF0ZUxpbWl0KFxuICAgIHVzZXJJZDogc3RyaW5nLFxuICAgIHNlcnZpY2U6IHN0cmluZyxcbiAgICB0aWVyOiBzdHJpbmcgPSAnZGVmYXVsdCdcbiAgKTogUHJvbWlzZTxSYXRlTGltaXRSZXN1bHQ+IHtcbiAgICBjb25zdCBrZXkgPSBgdXNlcjoke3VzZXJJZH06JHtzZXJ2aWNlfWBcbiAgICBjb25zdCBjb25maWdLZXkgPSBgJHtzZXJ2aWNlfToke3RpZXJ9YFxuICAgIFxuICAgIHJldHVybiB0aGlzLmNoZWNrUmF0ZUxpbWl0KGtleSwgY29uZmlnS2V5KVxuICB9XG4gIFxuICAvKipcbiAgICogR2V0IHRva2VuIGJ1Y2tldCBmcm9tIER5bmFtb0RCXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGdldEJ1Y2tldChrZXk6IHN0cmluZyk6IFByb21pc2U8YW55PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcbiAgICAgICAgVGFibGVOYW1lOiBSQVRFX0xJTUlUX1RBQkxFLFxuICAgICAgICBLZXk6IHsgYnVja2V0S2V5OiBrZXkgfSxcbiAgICAgIH0pKVxuICAgICAgXG4gICAgICBpZiAocmVzdWx0Lkl0ZW0pIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICB0b2tlbnM6IHJlc3VsdC5JdGVtLnRva2VucyxcbiAgICAgICAgICBsYXN0UmVmaWxsVGltZTogcmVzdWx0Lkl0ZW0ubGFzdFJlZmlsbFRpbWUsXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2V0dGluZyBidWNrZXQ6JywgZXJyb3IpXG4gICAgfVxuICAgIFxuICAgIC8vIFJldHVybiBuZXcgYnVja2V0IGlmIG5vdCBmb3VuZFxuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0Q29uZmlnRnJvbUtleShrZXkpXG4gICAgcmV0dXJuIHtcbiAgICAgIHRva2VuczogY29uZmlnLm1heFRva2VucyxcbiAgICAgIGxhc3RSZWZpbGxUaW1lOiBEYXRlLm5vdygpLFxuICAgIH1cbiAgfVxuICBcbiAgLyoqXG4gICAqIFVwZGF0ZSB0b2tlbiBidWNrZXQgaW4gRHluYW1vREJcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlQnVja2V0KGtleTogc3RyaW5nLCB0b2tlbnM6IG51bWJlciwgbGFzdFJlZmlsbFRpbWU6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgVXBkYXRlQ29tbWFuZCh7XG4gICAgICAgIFRhYmxlTmFtZTogUkFURV9MSU1JVF9UQUJMRSxcbiAgICAgICAgS2V5OiB7IGJ1Y2tldEtleToga2V5IH0sXG4gICAgICAgIFVwZGF0ZUV4cHJlc3Npb246ICdTRVQgdG9rZW5zID0gOnRva2VucywgbGFzdFJlZmlsbFRpbWUgPSA6dGltZSwgdXBkYXRlZEF0ID0gOm5vdycsXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcbiAgICAgICAgICAnOnRva2Vucyc6IHRva2VucyxcbiAgICAgICAgICAnOnRpbWUnOiBsYXN0UmVmaWxsVGltZSxcbiAgICAgICAgICAnOm5vdyc6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSxcbiAgICAgIH0pKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciB1cGRhdGluZyBidWNrZXQ6JywgZXJyb3IpXG4gICAgfVxuICB9XG4gIFxuICAvKipcbiAgICogR2V0IHJlcXVlc3QgaGlzdG9yeSBmb3Igc2xpZGluZyB3aW5kb3dcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgZ2V0UmVxdWVzdEhpc3Rvcnkoa2V5OiBzdHJpbmcpOiBQcm9taXNlPG51bWJlcltdPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcbiAgICAgICAgVGFibGVOYW1lOiBSQVRFX0xJTUlUX1RBQkxFLFxuICAgICAgICBLZXk6IHsgYnVja2V0S2V5OiBrZXkgfSxcbiAgICAgIH0pKVxuICAgICAgXG4gICAgICBpZiAocmVzdWx0Lkl0ZW0/LnJlcXVlc3RIaXN0b3J5KSB7XG4gICAgICAgIHJldHVybiByZXN1bHQuSXRlbS5yZXF1ZXN0SGlzdG9yeVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBnZXR0aW5nIHJlcXVlc3QgaGlzdG9yeTonLCBlcnJvcilcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIFtdXG4gIH1cbiAgXG4gIC8qKlxuICAgKiBVcGRhdGUgcmVxdWVzdCBoaXN0b3J5IGZvciBzbGlkaW5nIHdpbmRvd1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyB1cGRhdGVSZXF1ZXN0SGlzdG9yeShcbiAgICBrZXk6IHN0cmluZyxcbiAgICBoaXN0b3J5OiBudW1iZXJbXSxcbiAgICB3aW5kb3dTaXplTXM6IG51bWJlclxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xuICAgICAgICBUYWJsZU5hbWU6IFJBVEVfTElNSVRfVEFCTEUsXG4gICAgICAgIEl0ZW06IHtcbiAgICAgICAgICBidWNrZXRLZXk6IGtleSxcbiAgICAgICAgICByZXF1ZXN0SGlzdG9yeTogaGlzdG9yeSxcbiAgICAgICAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICB0dGw6IE1hdGguZmxvb3IoKERhdGUubm93KCkgKyB3aW5kb3dTaXplTXMgKiAyKSAvIDEwMDApLCAgLy8gRXhwaXJlIGFmdGVyIDJ4IHdpbmRvd1xuICAgICAgICB9LFxuICAgICAgfSkpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHVwZGF0aW5nIHJlcXVlc3QgaGlzdG9yeTonLCBlcnJvcilcbiAgICB9XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBHZXQgcmF0ZSBsaW1pdCBjb25maWd1cmF0aW9uXG4gICAqL1xuICBwcml2YXRlIGdldENvbmZpZyhjb25maWdLZXk6IHN0cmluZyk6IFJhdGVMaW1pdENvbmZpZyB7XG4gICAgLy8gVHJ5IHRvIGdldCBzcGVjaWZpYyBjb25maWdcbiAgICBsZXQgY29uZmlnID0gdGhpcy5jb25maWdzLmdldChjb25maWdLZXkpXG4gICAgXG4gICAgLy8gRmFsbCBiYWNrIHRvIHNlcnZpY2UgZGVmYXVsdFxuICAgIGlmICghY29uZmlnKSB7XG4gICAgICBjb25zdCBbc2VydmljZV0gPSBjb25maWdLZXkuc3BsaXQoJzonKVxuICAgICAgY29uZmlnID0gdGhpcy5jb25maWdzLmdldChgJHtzZXJ2aWNlfTpkZWZhdWx0YClcbiAgICB9XG4gICAgXG4gICAgLy8gRmFsbCBiYWNrIHRvIGdsb2JhbCBkZWZhdWx0XG4gICAgaWYgKCFjb25maWcpIHtcbiAgICAgIGNvbmZpZyA9IHRoaXMuY29uZmlncy5nZXQoJ3Rva2VuLXNlcnZpY2U6ZGVmYXVsdCcpIVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4geyAuLi5jb25maWcgfSAgLy8gUmV0dXJuIGNvcHkgdG8gYXZvaWQgbXV0YXRpb25zXG4gIH1cbiAgXG4gIC8qKlxuICAgKiBFeHRyYWN0IGNvbmZpZyBmcm9tIGJ1Y2tldCBrZXlcbiAgICovXG4gIHByaXZhdGUgZ2V0Q29uZmlnRnJvbUtleShidWNrZXRLZXk6IHN0cmluZyk6IFJhdGVMaW1pdENvbmZpZyB7XG4gICAgY29uc3QgW2NvbmZpZ0tleV0gPSBidWNrZXRLZXkuc3BsaXQoJzonKVxuICAgIHJldHVybiB0aGlzLmdldENvbmZpZyhjb25maWdLZXkpXG4gIH1cbiAgXG4gIC8qKlxuICAgKiBSZWNvcmQgQ2xvdWRXYXRjaCBtZXRyaWNcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgcmVjb3JkTWV0cmljKFxuICAgIGNvbmZpZ0tleTogc3RyaW5nLFxuICAgIG1ldHJpY05hbWU6IHN0cmluZyxcbiAgICB2YWx1ZTogbnVtYmVyXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbG91ZFdhdGNoQ2xpZW50LnNlbmQobmV3IFB1dE1ldHJpY0RhdGFDb21tYW5kKHtcbiAgICAgICAgTmFtZXNwYWNlOiAnUG9zdG9saW8vUmF0ZUxpbWl0JyxcbiAgICAgICAgTWV0cmljRGF0YTogW3tcbiAgICAgICAgICBNZXRyaWNOYW1lOiBtZXRyaWNOYW1lLFxuICAgICAgICAgIFZhbHVlOiB2YWx1ZSxcbiAgICAgICAgICBVbml0OiAnQ291bnQnLFxuICAgICAgICAgIERpbWVuc2lvbnM6IFtcbiAgICAgICAgICAgIHsgTmFtZTogJ0NvbmZpZ0tleScsIFZhbHVlOiBjb25maWdLZXkgfSxcbiAgICAgICAgICAgIHsgTmFtZTogJ0Vudmlyb25tZW50JywgVmFsdWU6IEVOVklST05NRU5UIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICBUaW1lc3RhbXA6IG5ldyBEYXRlKCksXG4gICAgICAgIH1dLFxuICAgICAgfSkpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHJlY29yZGluZyBtZXRyaWM6JywgZXJyb3IpXG4gICAgfVxuICB9XG4gIFxuICAvKipcbiAgICogUmVzZXQgcmF0ZSBsaW1pdCBmb3IgYSBzcGVjaWZpYyBrZXlcbiAgICovXG4gIGFzeW5jIHJlc2V0UmF0ZUxpbWl0KGtleTogc3RyaW5nLCBjb25maWdLZXk6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0Q29uZmlnKGNvbmZpZ0tleSlcbiAgICBjb25zdCBidWNrZXRLZXkgPSBgJHtjb25maWdLZXl9OiR7a2V5fWBcbiAgICBcbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IFJBVEVfTElNSVRfVEFCTEUsXG4gICAgICBJdGVtOiB7XG4gICAgICAgIGJ1Y2tldEtleSxcbiAgICAgICAgdG9rZW5zOiBjb25maWcubWF4VG9rZW5zLFxuICAgICAgICBsYXN0UmVmaWxsVGltZTogRGF0ZS5ub3coKSxcbiAgICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9LFxuICAgIH0pKVxuICB9XG4gIFxuICAvKipcbiAgICogR2V0IGN1cnJlbnQgcmF0ZSBsaW1pdCBzdGF0dXNcbiAgICovXG4gIGFzeW5jIGdldFJhdGVMaW1pdFN0YXR1cyhrZXk6IHN0cmluZywgY29uZmlnS2V5OiBzdHJpbmcpOiBQcm9taXNlPGFueT4ge1xuICAgIGNvbnN0IGJ1Y2tldEtleSA9IGAke2NvbmZpZ0tleX06JHtrZXl9YFxuICAgIGNvbnN0IGJ1Y2tldCA9IGF3YWl0IHRoaXMuZ2V0QnVja2V0KGJ1Y2tldEtleSlcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldENvbmZpZyhjb25maWdLZXkpXG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIGN1cnJlbnRUb2tlbnM6IGJ1Y2tldC50b2tlbnMsXG4gICAgICBtYXhUb2tlbnM6IGNvbmZpZy5tYXhUb2tlbnMsXG4gICAgICByZWZpbGxSYXRlOiBjb25maWcucmVmaWxsUmF0ZSxcbiAgICAgIGxhc3RSZWZpbGxUaW1lOiBidWNrZXQubGFzdFJlZmlsbFRpbWUsXG4gICAgICBuZXh0UmVmaWxsQXQ6IGJ1Y2tldC5sYXN0UmVmaWxsVGltZSArICgxMDAwIC8gY29uZmlnLnJlZmlsbFJhdGUpLFxuICAgIH1cbiAgfVxuICBcbiAgLyoqXG4gICAqIENvbmZpZ3VyZSBjdXN0b20gcmF0ZSBsaW1pdFxuICAgKi9cbiAgc2V0Q29uZmlnKGNvbmZpZ0tleTogc3RyaW5nLCBjb25maWc6IFJhdGVMaW1pdENvbmZpZyk6IHZvaWQge1xuICAgIHRoaXMuY29uZmlncy5zZXQoY29uZmlnS2V5LCBjb25maWcpXG4gIH1cbn1cblxuLy8gRXhwb3J0IHNpbmdsZXRvbiBpbnN0YW5jZVxuZXhwb3J0IGNvbnN0IHJhdGVMaW1pdGVyID0gUmF0ZUxpbWl0ZXIuZ2V0SW5zdGFuY2UoKSJdfQ==