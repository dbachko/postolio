import Redis from 'ioredis'

interface AccountInsights {
  followers: number
  impressions: number
  reach: number
  profile_views?: number
  website_clicks?: number
}

interface MediaInsights {
  impressions: number
  reach: number
  engagement: number
  saves?: number
  video_views?: number
}

interface PostsListData {
  posts: Array<{
    id: string
    caption: string
    media_url: string
    posted_at: string
  }>
}

export class AnalyticsCache {
  private redis: Redis | null = null

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
    this.redis = new Redis(redisUrl, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
    })

    this.redis.on('error', (err: any) => {
      console.error('AnalyticsCache Redis error:', err)
    })
  }

  // Account insights (TTL: 1 hour)
  async setAccountInsights(brandId: string, date: string, data: AccountInsights): Promise<void> {
    if (!this.redis) return
    const key = `analytics:account:${brandId}:${date}`
    await this.redis.setex(key, 3600, JSON.stringify(data)) // 1 hour TTL
  }

  async getAccountInsights(brandId: string, date: string): Promise<AccountInsights | null> {
    if (!this.redis) return null
    const key = `analytics:account:${brandId}:${date}`
    const data = await this.redis.get(key)
    return data ? JSON.parse(data) : null
  }

  // Media insights (TTL: 6 hours)
  async setMediaInsights(brandId: string, mediaId: string, data: MediaInsights): Promise<void> {
    if (!this.redis) return
    const key = `analytics:media:${brandId}:${mediaId}`
    await this.redis.setex(key, 21600, JSON.stringify(data)) // 6 hours TTL
  }

  async getMediaInsights(brandId: string, mediaId: string): Promise<MediaInsights | null> {
    if (!this.redis) return null
    const key = `analytics:media:${brandId}:${mediaId}`
    const data = await this.redis.get(key)
    return data ? JSON.parse(data) : null
  }

  // Recent posts list (TTL: 30 minutes)
  async setRecentPosts(brandId: string, data: PostsListData): Promise<void> {
    if (!this.redis) return
    const key = `analytics:posts:${brandId}:recent`
    await this.redis.setex(key, 1800, JSON.stringify(data)) // 30 minutes TTL
  }

  async getRecentPosts(brandId: string): Promise<PostsListData | null> {
    if (!this.redis) return null
    const key = `analytics:posts:${brandId}:recent`
    const data = await this.redis.get(key)
    return data ? JSON.parse(data) : null
  }

  // Rate limit tracking (TTL: 1 hour)
  async setRateLimit(brandId: string, callCount: number): Promise<void> {
    if (!this.redis) return
    const key = `analytics:ratelimit:${brandId}`
    await this.redis.setex(key, 3600, callCount.toString()) // 1 hour TTL
  }

  async getRateLimit(brandId: string): Promise<number> {
    if (!this.redis) return 0
    const key = `analytics:ratelimit:${brandId}`
    const data = await this.redis.get(key)
    return data ? parseInt(data) : 0
  }

  async incrementRateLimit(brandId: string): Promise<number> {
    if (!this.redis) return 0
    const key = `analytics:ratelimit:${brandId}`
    const result = await this.redis.incr(key)

    // Set TTL on first increment
    if (result === 1) {
      await this.redis.expire(key, 3600) // 1 hour TTL
    }

    return result
  }

  // Utility methods
  async getTTL(key: string): Promise<number> {
    if (!this.redis) return -1
    return await this.redis.ttl(key)
  }

  async clear(): Promise<void> {
    if (!this.redis) return
    const keys = await this.redis.keys('analytics:*')
    if (keys.length > 0) {
      await this.redis.del(...keys)
    }
  }

  async disconnect(): Promise<void> {
    if (!this.redis) return
    await this.redis.disconnect()
  }

  // Check if data exists and is fresh
  async isDataFresh(brandId: string, type: 'account' | 'media' | 'posts', identifier?: string): Promise<boolean> {
    let key: string

    switch (type) {
      case 'account': {
        const today = new Date().toISOString().split('T')[0]
        key = `analytics:account:${brandId}:${today}`
        break
      }
      case 'media':
        if (!identifier) return false
        key = `analytics:media:${brandId}:${identifier}`
        break
      case 'posts':
        key = `analytics:posts:${brandId}:recent`
        break
      default:
        return false
    }

    if (!this.redis) return false
    const ttl = await this.redis.ttl(key)
    return ttl > 0
  }

  // Get cache metadata
  async getCacheStatus(brandId: string): Promise<{
    lastUpdated: string | null
    accountDataAge: number
    postsDataAge: number
    rateLimitCount: number
  }> {
    const today = new Date().toISOString().split('T')[0]
    const accountKey = `analytics:account:${brandId}:${today}`
    const postsKey = `analytics:posts:${brandId}:recent`

    const [accountTTL, postsTTL, rateLimitCount] = await Promise.all([
      this.redis ? this.redis.ttl(accountKey) : -1,
      this.redis ? this.redis.ttl(postsKey) : -1,
      this.getRateLimit(brandId),
    ])

    return {
      lastUpdated: accountTTL > 0 ? new Date(Date.now() - (3600 - accountTTL) * 1000).toISOString() : null,
      accountDataAge: accountTTL > 0 ? 3600 - accountTTL : -1,
      postsDataAge: postsTTL > 0 ? 1800 - postsTTL : -1,
      rateLimitCount,
    }
  }
}

// Export singleton instance
export const analyticsCache = new AnalyticsCache()
