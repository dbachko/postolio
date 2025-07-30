import axios from 'axios'
import { redisService } from './redis.js'
import crypto from 'crypto'
import { analyticsCache } from './analytics-cache.js'

export interface InstagramPost {
  id: string
  caption: string
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
  media_url: string
  permalink: string
  timestamp: string
  hashtags: string[]
  like_count?: number
  comments_count?: number
}

export interface InstagramProfile {
  id: string
  username: string
  account_type: string
  media_count: number
  followers_count: number
  follows_count: number
  name: string
  biography: string
  website: string
  profile_picture_url: string
}

export interface PublishMediaRequest {
  imageUrl: string
  caption: string
  hashtags: string[]
}

export interface PublishMediaResult {
  id: string
  permalink: string
  published: boolean
}

export interface AccountInsights {
  followers: number
  impressions: number
  reach: number
  profile_views?: number
  website_clicks?: number
}

export interface MediaInsights {
  impressions: number
  reach: number
  engagement: number
  saves?: number
  video_views?: number
}

export interface AnalyticsOverview {
  data: AccountInsights
  lastUpdated: string
  fromCache: boolean
}

export interface PostPerformance {
  posts: Array<{
    id: string
    caption: string
    impressions: number
    engagement: number
    media_url: string
    posted_at: string
  }>
  lastUpdated: string
}

interface BrandData {
  instagramAccessToken?: string | null
  instagramAccountId?: string | null
  instagramPageId?: string | null
}

class InstagramService {
  private rateLimitWindow: Map<string, number> = new Map()

  constructor() {
    // No initialization needed - we'll get tokens from database per request
  }

  /**
   * Check if a brand has Instagram connected
   */
  isConfigured(brand: BrandData): boolean {
    return !!(brand.instagramAccessToken && brand.instagramAccountId)
  }

  /**
   * Get default profile picture URL when none is available
   */
  private getDefaultProfilePicture(): string {
    return 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y&s=150'
  }

  /**
   * Check rate limiting for Instagram API calls
   */
  private async checkRateLimit(identifier: string): Promise<boolean> {
    const key = `instagram_rate_limit:${identifier}`
    
    if (redisService.isConnected()) {
      const count = await redisService.increment(key, 3600)
      return count ? count <= 200 : true
    } else {
      // Fallback to in-memory rate limiting
      const now = Date.now()
      const windowStart = Math.floor(now / (60 * 60 * 1000)) * (60 * 60 * 1000)
      const windowKey = `${identifier}_${windowStart}`
      
      const currentCount = this.rateLimitWindow.get(windowKey) || 0
      if (currentCount >= 200) {
        return false
      }
      
      this.rateLimitWindow.set(windowKey, currentCount + 1)
      
      // Clean up old windows
      for (const [key, _] of this.rateLimitWindow) {
        const keyTime = parseInt(key.split('_')[1] || '0')
        if (keyTime < windowStart - (60 * 60 * 1000)) {
          this.rateLimitWindow.delete(key)
        }
      }
      
      return true
    }
  }

  /**
   * Refresh Instagram access token
   */
  async refreshAccessToken(currentToken: string): Promise<{ accessToken: string; expiresAt: string } | null> {
    try {
      const url = `https://graph.facebook.com/v23.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_APP_SECRET}&fb_exchange_token=${currentToken}`
      
      const response = await axios.get(url)
      const data = response.data
      
      if (data.access_token) {
        const expiresAt = data.expires_in ? 
          new Date(Date.now() + data.expires_in * 1000).toISOString() :
          new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() // 60 days default
        
        return {
          accessToken: data.access_token,
          expiresAt
        }
      }
      
      return null
    } catch (error) {
      console.error('Token refresh failed:', error)
      return null
    }
  }

  /**
   * Validate webhook signature
   */
  static validateWebhookSignature(payload: string, signature: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', process.env.FACEBOOK_APP_SECRET || 'test_secret')
      .update(payload)
      .digest('hex')
    
    const receivedSignature = signature.replace('sha256=', '')
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(receivedSignature, 'hex')
    )
  }

  /**
   * Get Instagram profile information from Graph API
   */
  async getProfile(brand: BrandData): Promise<InstagramProfile> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not connected for this brand')
    }

    try {
      await this.checkRateLimit(brand.instagramAccountId!)

      const fields = 'id,username,name,biography,followers_count,media_count,profile_picture_url,website'
      const url = `https://graph.facebook.com/v23.0/${brand.instagramAccountId}?fields=${fields}&access_token=${brand.instagramAccessToken}`
      
      const response = await axios.get(url)
      const profile = response.data
      
      return {
        id: profile.id,
        username: profile.username,
        account_type: 'BUSINESS', // Since we're using Instagram Business API, this is always a business account
        media_count: profile.media_count || 0,
        followers_count: profile.followers_count || 0,
        follows_count: profile.follows_count || 0,
        name: profile.name || '',
        biography: profile.biography || '',
        website: profile.website || '',
        profile_picture_url: profile.profile_picture_url || this.getDefaultProfilePicture()
      }
    } catch (error) {
      console.error('Failed to fetch Instagram profile:', error)
      throw new Error(`Failed to fetch Instagram profile: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get recent posts from Instagram account
   */
  async getRecentPosts(brand: BrandData, limit: number = 25): Promise<InstagramPost[]> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not connected for this brand')
    }

    try {
      await this.checkRateLimit(brand.instagramAccountId!)

      const fields = 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count'
      const url = `https://graph.facebook.com/v23.0/${brand.instagramAccountId}/media?fields=${fields}&limit=${limit}&access_token=${brand.instagramAccessToken}`
      
      const response = await axios.get(url)
      const mediaData = response.data.data || []
      
      return mediaData.map((media: any) => {
        // Extract hashtags from caption
        const caption = media.caption || ''
        const hashtagMatches = caption.match(/#\w+/g) || []
        const hashtags = hashtagMatches.map((tag: string) => tag.substring(1))
        
        return {
          id: media.id,
          caption: caption,
          media_type: media.media_type,
          media_url: media.media_url,
          permalink: media.permalink,
          timestamp: media.timestamp,
          hashtags: hashtags,
          like_count: media.like_count,
          comments_count: media.comments_count
        }
      })
    } catch (error) {
      console.error('Failed to fetch Instagram posts:', error)
      throw new Error(`Failed to fetch Instagram posts: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Publish media to Instagram
   */
  async publishMedia(brand: BrandData, request: PublishMediaRequest): Promise<PublishMediaResult> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not connected for this brand')
    }

    try {
      await this.checkRateLimit(brand.instagramAccountId!)

      // Step 1: Create media container
      const caption = `${request.caption}\n\n${request.hashtags.map(tag => `#${tag}`).join(' ')}`
      const containerUrl = `https://graph.facebook.com/v23.0/${brand.instagramAccountId}/media`
      
      const containerData = {
        image_url: request.imageUrl,
        caption: caption,
        access_token: brand.instagramAccessToken
      }
      
      const containerResponse = await axios.post(containerUrl, containerData)
      const containerId = containerResponse.data.id
      
      // Step 2: Publish the media container
      const publishUrl = `https://graph.facebook.com/v23.0/${brand.instagramAccountId}/media_publish`
      const publishData = {
        creation_id: containerId,
        access_token: brand.instagramAccessToken
      }
      
      const publishResponse = await axios.post(publishUrl, publishData)
      const mediaId = publishResponse.data.id
      
      // Step 3: Get the permalink
      const permalinkUrl = `https://graph.facebook.com/v23.0/${mediaId}?fields=permalink&access_token=${brand.instagramAccessToken}`
      const permalinkResponse = await axios.get(permalinkUrl)
      
      return {
        id: mediaId,
        permalink: permalinkResponse.data.permalink,
        published: true
      }
    } catch (error) {
      console.error('Failed to publish Instagram media:', error)
      throw new Error(`Failed to publish Instagram media: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get media insights for analytics
   */
  async getMediaInsights(brand: BrandData, mediaId: string): Promise<any> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not connected for this brand')
    }

    try {
      await this.checkRateLimit(brand.instagramAccountId!)

      const metrics = 'impressions,reach,engagement,likes,comments,saves,shares'
      const url = `https://graph.facebook.com/v23.0/${mediaId}/insights?metric=${metrics}&access_token=${brand.instagramAccessToken}`
      
      const response = await axios.get(url)
      return response.data
    } catch (error) {
      console.error('Failed to fetch media insights:', error)
      throw new Error(`Failed to fetch media insights: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get account insights with caching
   */
  async getAccountInsights(brand: BrandData, timeRange: '7d' | '30d' | '90d' = '7d'): Promise<AnalyticsOverview> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not configured for this brand')
    }

    const today = new Date().toISOString().split('T')[0]
    const cacheKey = `${brand.instagramAccountId || 'unknown'}_${timeRange}`
    
    // Check cache first
    const cachedData = await analyticsCache.getAccountInsights(cacheKey, today)
    if (cachedData) {
      return {
        data: cachedData,
        lastUpdated: new Date().toISOString(),
        fromCache: true
      }
    }

    // Check rate limit before API call
    const canMakeRequest = await this.checkRateLimit(brand.instagramAccountId!)
    if (!canMakeRequest) {
      throw new Error('Rate limit exceeded for Instagram API')
    }

    try {
      // Increment rate limit counter
      await analyticsCache.incrementRateLimit(cacheKey)

      // Calculate date range
      const endDate = new Date()
      const startDate = new Date()
      const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
      startDate.setDate(endDate.getDate() - days)

      // Get follower count (lifetime metric)
      const followerUrl = `https://graph.facebook.com/v23.0/${brand.instagramAccountId}?fields=followers_count&access_token=${brand.instagramAccessToken}`
      const followerResponse = await axios.get(followerUrl)
      
      // Get insights for the time range
      const metricsUrl = `https://graph.facebook.com/v23.0/${brand.instagramAccountId}/insights?metric=impressions,reach,profile_views&period=day&since=${startDate.toISOString().split('T')[0]}&until=${endDate.toISOString().split('T')[0]}&access_token=${brand.instagramAccessToken}`
      const insightsResponse = await axios.get(metricsUrl)

      // Process insights data
      const insights = insightsResponse.data.data
      const processedData: AccountInsights = {
        followers: followerResponse.data.followers_count || 0,
        impressions: this.aggregateInsightValues(insights, 'impressions'),
        reach: this.aggregateInsightValues(insights, 'reach'),
        profile_views: this.aggregateInsightValues(insights, 'profile_views')
      }

      // Cache the result
      await analyticsCache.setAccountInsights(cacheKey, today, processedData)

      return {
        data: processedData,
        lastUpdated: new Date().toISOString(),
        fromCache: false
      }
    } catch (error) {
      console.error('Failed to fetch account insights:', error)
      throw new Error(`Failed to fetch account insights: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get recent posts with performance data
   */
  async getRecentPostsPerformance(brand: BrandData, limit: number = 10): Promise<PostPerformance> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not configured for this brand')
    }

    // Check cache first
    const cachedPosts = await analyticsCache.getRecentPosts(brand.instagramAccountId!)
    if (cachedPosts) {
      return {
        posts: cachedPosts.posts.slice(0, limit) as any,
        lastUpdated: new Date().toISOString()
      }
    }

    // Check rate limit
    const canMakeRequest = await this.checkRateLimit(brand.instagramAccountId!)
    if (!canMakeRequest) {
      throw new Error('Rate limit exceeded for Instagram API')
    }

    try {
      // Get recent media
      const mediaUrl = `https://graph.facebook.com/v23.0/${brand.instagramAccountId}/media?fields=id,caption,media_type,media_url,permalink,timestamp&limit=${limit}&access_token=${brand.instagramAccessToken}`
      const mediaResponse = await axios.get(mediaUrl)

      const posts = []
      
      // Get insights for each media item
      for (const media of mediaResponse.data.data) {
        try {
          const insightsUrl = `https://graph.facebook.com/v23.0/${media.id}/insights?metric=impressions,reach,engagement&access_token=${brand.instagramAccessToken}`
          const insightsResponse = await axios.get(insightsUrl)
          
          const insights = insightsResponse.data.data
          posts.push({
            id: media.id,
            caption: media.caption || '',
            impressions: this.getInsightValue(insights, 'impressions'),
            engagement: this.getInsightValue(insights, 'engagement'),
            media_url: media.media_url,
            posted_at: media.timestamp
          })
        } catch (insightError) {
          // If insights fail for individual post, include it without metrics
          posts.push({
            id: media.id,
            caption: media.caption || '',
            impressions: 0,
            engagement: 0,
            media_url: media.media_url,
            posted_at: media.timestamp
          })
        }
      }

      // Cache the results
      await analyticsCache.setRecentPosts(brand.instagramAccountId!, { posts })

      return {
        posts,
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      console.error('Failed to fetch recent posts performance:', error)
      throw new Error(`Failed to fetch recent posts performance: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Force refresh analytics data (bypass cache)
   */
  async refreshAnalyticsData(brand: BrandData): Promise<{ success: boolean; message: string; nextRefreshAllowed: string }> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not configured for this brand')
    }

    // Check if user is within rate limits
    const rateLimitCount = await analyticsCache.getRateLimit(brand.instagramAccountId!)
    if (rateLimitCount >= 180) { // Leave some buffer before 200 limit
      const nextRefresh = new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now
      return {
        success: false,
        message: 'Rate limit nearly exceeded. Please wait before refreshing again.',
        nextRefreshAllowed: nextRefresh.toISOString()
      }
    }

    try {
      // Clear existing cache for this brand
      const today = new Date().toISOString().split('T')[0]
      await analyticsCache.clear() // This clears all analytics cache - in production you'd be more selective

      // Force fresh data fetch
      await this.getAccountInsights(brand, '7d')
      await this.getRecentPostsPerformance(brand, 10)

      return {
        success: true,
        message: 'Analytics data refreshed successfully',
        nextRefreshAllowed: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 minutes
      }
    } catch (error) {
      console.error('Failed to refresh analytics data:', error)
      return {
        success: false,
        message: `Failed to refresh data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        nextRefreshAllowed: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      }
    }
  }

  /**
   * Get analytics cache status
   */
  async getAnalyticsCacheStatus(brand: BrandData): Promise<{
    lastUpdated: string | null
    cacheAge: number
    rateLimitRemaining: number
  }> {
    if (!this.isConfigured(brand)) {
      throw new Error('Instagram not configured for this brand')
    }

    const status = await analyticsCache.getCacheStatus(brand.instagramAccountId!)
    const rateLimitCount = await analyticsCache.getRateLimit(brand.instagramAccountId!)
    
    return {
      lastUpdated: status.lastUpdated,
      cacheAge: status.accountDataAge,
      rateLimitRemaining: Math.max(0, 200 - rateLimitCount)
    }
  }

  /**
   * Helper method to aggregate insight values across time periods
   */
  private aggregateInsightValues(insights: any[], metricName: string): number {
    const metric = insights.find(insight => insight.name === metricName)
    if (!metric || !metric.values) return 0
    
    return metric.values.reduce((sum: number, value: any) => sum + (value.value || 0), 0)
  }

  /**
   * Helper method to get single insight value
   */
  private getInsightValue(insights: any[], metricName: string): number {
    const metric = insights.find(insight => insight.name === metricName)
    return metric?.values?.[0]?.value || 0
  }

  /**
   * Handle webhook event
   */
  async handleWebhookEvent(event: any): Promise<void> {
    try {
      // Process Instagram webhook events
      console.log('Processing Instagram webhook event:', event)
      
      // Implementation depends on specific webhook events you want to handle
      // Common events: media published, comments, mentions, etc.
    } catch (error) {
      console.error('Failed to handle webhook event:', error)
    }
  }
}

export const instagramService = new InstagramService()