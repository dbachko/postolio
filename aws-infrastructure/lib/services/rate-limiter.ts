/**
 * Rate Limiter Service
 * Token bucket algorithm with DynamoDB persistence for distributed rate limiting
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'

const dynamoClient = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(dynamoClient)
const cloudWatchClient = new CloudWatchClient({})

const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE_NAME || 'rate-limits'
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev'

export interface RateLimitConfig {
  maxTokens: number
  refillRate: number  // Tokens per second
  windowSizeMs?: number  // Sliding window size (optional)
  burstCapacity?: number  // Allow temporary bursts
}

export interface RateLimitResult {
  allowed: boolean
  remainingTokens: number
  nextRefillAt: number
  retryAfterMs?: number
  reason?: string
}

export class RateLimiter {
  private static instance: RateLimiter
  private configs: Map<string, RateLimitConfig> = new Map()
  
  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter()
    }
    return RateLimiter.instance
  }
  
  constructor() {
    // Initialize default rate limit configurations
    this.configs.set('token-service:default', {
      maxTokens: 100,
      refillRate: 1,  // 1 token per second
      burstCapacity: 20,
    })
    
    this.configs.set('token-service:premium', {
      maxTokens: 500,
      refillRate: 5,  // 5 tokens per second
      burstCapacity: 100,
    })
    
    this.configs.set('token-service:enterprise', {
      maxTokens: 2000,
      refillRate: 20,  // 20 tokens per second
      burstCapacity: 500,
    })
    
    this.configs.set('publisher:default', {
      maxTokens: 50,
      refillRate: 0.5,  // 1 token per 2 seconds
      burstCapacity: 10,
    })
    
    this.configs.set('scheduler:default', {
      maxTokens: 200,
      refillRate: 2,
      burstCapacity: 50,
    })
  }
  
  /**
   * Check rate limit using token bucket algorithm
   */
  async checkRateLimit(
    key: string,
    configKey: string = 'default',
    tokensRequested: number = 1
  ): Promise<RateLimitResult> {
    const config = this.getConfig(configKey)
    const bucketKey = `${configKey}:${key}`
    
    try {
      // Get current bucket state
      const bucket = await this.getBucket(bucketKey)
      const now = Date.now()
      
      // Calculate tokens to add based on time elapsed
      const timeSinceLastRefill = now - bucket.lastRefillTime
      const tokensToAdd = Math.floor((timeSinceLastRefill / 1000) * config.refillRate)
      
      // Update token count (capped at max + burst capacity)
      const maxCapacity = config.maxTokens + (config.burstCapacity || 0)
      const currentTokens = Math.min(bucket.tokens + tokensToAdd, maxCapacity)
      
      // Check if request can be fulfilled
      if (currentTokens >= tokensRequested) {
        // Consume tokens
        const newTokenCount = currentTokens - tokensRequested
        await this.updateBucket(bucketKey, newTokenCount, now)
        
        // Record successful request metric
        await this.recordMetric(configKey, 'Allowed', 1)
        
        return {
          allowed: true,
          remainingTokens: newTokenCount,
          nextRefillAt: now + (1000 / config.refillRate),
        }
      } else {
        // Calculate retry after time
        const tokensNeeded = tokensRequested - currentTokens
        const retryAfterMs = Math.ceil((tokensNeeded / config.refillRate) * 1000)
        
        // Record rate limited metric
        await this.recordMetric(configKey, 'RateLimited', 1)
        
        return {
          allowed: false,
          remainingTokens: currentTokens,
          nextRefillAt: now + retryAfterMs,
          retryAfterMs,
          reason: `Rate limit exceeded. Need ${tokensNeeded} more tokens.`,
        }
      }
    } catch (error) {
      console.error('Rate limit check error:', error)
      
      // Fail open on errors to avoid blocking legitimate requests
      return {
        allowed: true,
        remainingTokens: 0,
        nextRefillAt: Date.now() + 1000,
      }
    }
  }
  
  /**
   * Check rate limit with sliding window algorithm
   */
  async checkSlidingWindowLimit(
    key: string,
    configKey: string,
    windowSizeMs: number = 60000  // 1 minute default
  ): Promise<RateLimitResult> {
    const config = this.getConfig(configKey)
    const windowKey = `window:${configKey}:${key}`
    const now = Date.now()
    const windowStart = now - windowSizeMs
    
    try {
      // Get request history
      const history = await this.getRequestHistory(windowKey)
      
      // Filter requests within window
      const requestsInWindow = history.filter(timestamp => timestamp > windowStart)
      
      // Check if under limit
      if (requestsInWindow.length < config.maxTokens) {
        // Add current request to history
        requestsInWindow.push(now)
        await this.updateRequestHistory(windowKey, requestsInWindow, windowSizeMs)
        
        await this.recordMetric(configKey, 'SlidingWindowAllowed', 1)
        
        return {
          allowed: true,
          remainingTokens: config.maxTokens - requestsInWindow.length,
          nextRefillAt: requestsInWindow[0] + windowSizeMs,
        }
      } else {
        // Calculate when oldest request expires
        const oldestRequest = Math.min(...requestsInWindow)
        const retryAfterMs = oldestRequest + windowSizeMs - now
        
        await this.recordMetric(configKey, 'SlidingWindowRateLimited', 1)
        
        return {
          allowed: false,
          remainingTokens: 0,
          nextRefillAt: oldestRequest + windowSizeMs,
          retryAfterMs,
          reason: `Rate limit exceeded. Window: ${windowSizeMs}ms, Limit: ${config.maxTokens}`,
        }
      }
    } catch (error) {
      console.error('Sliding window check error:', error)
      return {
        allowed: true,
        remainingTokens: 0,
        nextRefillAt: Date.now() + 1000,
      }
    }
  }
  
  /**
   * Check IP-based rate limit
   */
  async checkIPRateLimit(
    ipAddress: string,
    service: string,
    tier: string = 'default'
  ): Promise<RateLimitResult> {
    const key = `ip:${ipAddress}:${service}`
    const configKey = `${service}:${tier}`
    
    // Apply stricter limits for IP-based checks
    const ipConfig = this.getConfig(configKey)
    ipConfig.maxTokens = Math.floor(ipConfig.maxTokens * 0.5)  // 50% of user limit
    ipConfig.refillRate = ipConfig.refillRate * 0.5  // Slower refill
    
    return this.checkRateLimit(key, configKey)
  }
  
  /**
   * Check user-based rate limit
   */
  async checkUserRateLimit(
    userId: string,
    service: string,
    tier: string = 'default'
  ): Promise<RateLimitResult> {
    const key = `user:${userId}:${service}`
    const configKey = `${service}:${tier}`
    
    return this.checkRateLimit(key, configKey)
  }
  
  /**
   * Get token bucket from DynamoDB
   */
  private async getBucket(key: string): Promise<any> {
    try {
      const result = await docClient.send(new GetCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: { bucketKey: key },
      }))
      
      if (result.Item) {
        return {
          tokens: result.Item.tokens,
          lastRefillTime: result.Item.lastRefillTime,
        }
      }
    } catch (error) {
      console.error('Error getting bucket:', error)
    }
    
    // Return new bucket if not found
    const config = this.getConfigFromKey(key)
    return {
      tokens: config.maxTokens,
      lastRefillTime: Date.now(),
    }
  }
  
  /**
   * Update token bucket in DynamoDB
   */
  private async updateBucket(key: string, tokens: number, lastRefillTime: number): Promise<void> {
    try {
      await docClient.send(new UpdateCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: { bucketKey: key },
        UpdateExpression: 'SET tokens = :tokens, lastRefillTime = :time, updatedAt = :now',
        ExpressionAttributeValues: {
          ':tokens': tokens,
          ':time': lastRefillTime,
          ':now': new Date().toISOString(),
        },
      }))
    } catch (error) {
      console.error('Error updating bucket:', error)
    }
  }
  
  /**
   * Get request history for sliding window
   */
  private async getRequestHistory(key: string): Promise<number[]> {
    try {
      const result = await docClient.send(new GetCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: { bucketKey: key },
      }))
      
      if (result.Item?.requestHistory) {
        return result.Item.requestHistory
      }
    } catch (error) {
      console.error('Error getting request history:', error)
    }
    
    return []
  }
  
  /**
   * Update request history for sliding window
   */
  private async updateRequestHistory(
    key: string,
    history: number[],
    windowSizeMs: number
  ): Promise<void> {
    try {
      await docClient.send(new PutCommand({
        TableName: RATE_LIMIT_TABLE,
        Item: {
          bucketKey: key,
          requestHistory: history,
          updatedAt: new Date().toISOString(),
          ttl: Math.floor((Date.now() + windowSizeMs * 2) / 1000),  // Expire after 2x window
        },
      }))
    } catch (error) {
      console.error('Error updating request history:', error)
    }
  }
  
  /**
   * Get rate limit configuration
   */
  private getConfig(configKey: string): RateLimitConfig {
    // Try to get specific config
    let config = this.configs.get(configKey)
    
    // Fall back to service default
    if (!config) {
      const [service] = configKey.split(':')
      config = this.configs.get(`${service}:default`)
    }
    
    // Fall back to global default
    if (!config) {
      config = this.configs.get('token-service:default')!
    }
    
    return { ...config }  // Return copy to avoid mutations
  }
  
  /**
   * Extract config from bucket key
   */
  private getConfigFromKey(bucketKey: string): RateLimitConfig {
    const [configKey] = bucketKey.split(':')
    return this.getConfig(configKey)
  }
  
  /**
   * Record CloudWatch metric
   */
  private async recordMetric(
    configKey: string,
    metricName: string,
    value: number
  ): Promise<void> {
    try {
      await cloudWatchClient.send(new PutMetricDataCommand({
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
      }))
    } catch (error) {
      console.error('Error recording metric:', error)
    }
  }
  
  /**
   * Reset rate limit for a specific key
   */
  async resetRateLimit(key: string, configKey: string): Promise<void> {
    const config = this.getConfig(configKey)
    const bucketKey = `${configKey}:${key}`
    
    await docClient.send(new PutCommand({
      TableName: RATE_LIMIT_TABLE,
      Item: {
        bucketKey,
        tokens: config.maxTokens,
        lastRefillTime: Date.now(),
        updatedAt: new Date().toISOString(),
      },
    }))
  }
  
  /**
   * Get current rate limit status
   */
  async getRateLimitStatus(key: string, configKey: string): Promise<any> {
    const bucketKey = `${configKey}:${key}`
    const bucket = await this.getBucket(bucketKey)
    const config = this.getConfig(configKey)
    
    return {
      currentTokens: bucket.tokens,
      maxTokens: config.maxTokens,
      refillRate: config.refillRate,
      lastRefillTime: bucket.lastRefillTime,
      nextRefillAt: bucket.lastRefillTime + (1000 / config.refillRate),
    }
  }
  
  /**
   * Configure custom rate limit
   */
  setConfig(configKey: string, config: RateLimitConfig): void {
    this.configs.set(configKey, config)
  }
}

// Export singleton instance
export const rateLimiter = RateLimiter.getInstance()