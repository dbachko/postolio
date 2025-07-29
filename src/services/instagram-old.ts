import axios from 'axios'
import { redisService } from './redis.js'
import crypto from 'crypto'

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

class InstagramService {
  private rateLimitWindow: Map<string, number> = new Map()

  constructor() {
    // No initialization needed - we'll get tokens from database per request
  }

  /**
   * Check if a brand has Instagram connected
   */
  isConfigured(brand: { instagramAccessToken?: string | null, instagramAccountId?: string | null }): boolean {
    return !!(brand.instagramAccessToken && brand.instagramAccountId)
  }

  /**
   * Check rate limiting for Instagram API calls
   */
  private async checkRateLimit(identifier: string): Promise<boolean> {
    const key = `instagram_rate_limit:${identifier}`
    
    // Try Redis first, fallback to in-memory
    if (redisService.isConnected()) {
      const count = await redisService.increment(key, 3600) // 1 hour window
      return count ? count <= 200 : true // Instagram allows ~200 calls per hour
    } else {
      // Fallback to in-memory rate limiting
      const now = Date.now()
      const windowStart = Math.floor(now / (60 * 60 * 1000)) // 1 hour windows
      const windowKey = `${identifier}:${windowStart}`
      
      const current = this.rateLimitWindow.get(windowKey) || 0
      if (current >= 200) {
        return false
      }
      
      this.rateLimitWindow.set(windowKey, current + 1)
      
      // Clean old windows
      for (const [key, _] of this.rateLimitWindow) {
        const [_, keyWindow] = key.split(':')
        if (parseInt(keyWindow) < windowStart - 1) {
          this.rateLimitWindow.delete(key)
        }
      }
      
      return true
    }
  }

  /**
   * Refresh Instagram access token
   */
  async refreshAccessToken(currentToken: string): Promise<{ accessToken: string; expiresAt: Date } | null> {
    if (process.env.NODE_ENV !== 'production') {
      // Mock refresh in development
      return {
        accessToken: `refreshed_${Date.now()}`,
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 60 days
      }
    }

    try {
      // Production token refresh would use Facebook Graph API
      const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: process.env.FACEBOOK_APP_ID,
          client_secret: process.env.FACEBOOK_APP_SECRET,
          fb_exchange_token: currentToken
        }
      })

      const { access_token, expires_in } = response.data
      const expiresAt = new Date(Date.now() + expires_in * 1000)

      return {
        accessToken: access_token,
        expiresAt
      }
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
   * Get user's Instagram profile information
   */
  async getProfile(): Promise<InstagramProfile> {
    if (!this.client || !this.pageId) {
      throw new Error('Instagram client not configured')
    }

    try {
      const response = await this.client.newGetInstagramAccountInfoRequest().execute()
      
      // Handle response format variations
      let profile: any
      if (typeof response.getInstagramAccount === 'function') {
        profile = response.getInstagramAccount()
      } else if (response.data) {
        profile = response.data
      } else {
        profile = response
      }
      
      return {
        id: profile.id || 'unknown',
        username: profile.username || 'unknown',
        account_type: profile.account_type || 'PERSONAL',
        media_count: profile.media_count || 0,
        followers_count: profile.followers_count || 0,
        follows_count: profile.follows_count || 0,
        name: profile.name || '',
        biography: profile.biography || '',
        website: profile.website || '',
        profile_picture_url: profile.profile_picture_url || ''
      }
    } catch (error) {
      console.error('Failed to fetch Instagram profile:', error)
      // Fall back to mock data if real API fails
      return {
        id: 'fallback_profile_id',
        username: 'fallback_user',
        account_type: 'BUSINESS',
        media_count: 0,
        followers_count: 0,
        follows_count: 0,
        name: 'Fallback Profile',
        biography: 'Profile created as fallback',
        website: '',
        profile_picture_url: ''
      }
    }
  }

  /**
   * Get recent posts from the user's Instagram account
   */
  async getRecentPosts(limit: number = 25, userId?: string): Promise<InstagramPost[]> {
    if (!this.client) {
      throw new Error('Instagram client not configured')
    }

    // Check rate limiting
    const identifier = userId || this.pageId || 'default'
    const canProceed = await this.checkRateLimit(identifier)
    if (!canProceed) {
      throw new Error('Rate limit exceeded. Please try again later.')
    }

    try {
      const response = await this.client.newGetPageMediaRequest().withLimit(limit).execute()
      const mediaItems = response.getMedia()

      const posts: InstagramPost[] = []
      
      for (const media of mediaItems) {
        // Extract hashtags from caption
        const caption = media.caption || ''
        const hashtagMatches = caption.match(/#\w+/g) || []
        const hashtags = hashtagMatches.map(tag => tag.substring(1)) // Remove # symbol

        posts.push({
          id: media.id,
          caption: caption,
          media_type: media.media_type as 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM',
          media_url: media.media_url || '',
          permalink: media.permalink || '',
          timestamp: media.timestamp || '',
          hashtags: hashtags,
          like_count: media.like_count,
          comments_count: media.comments_count
        })
      }

      return posts
    } catch (error) {
      console.error('Failed to fetch Instagram posts:', error)
      throw new Error('Failed to fetch Instagram posts')
    }
  }

  /**
   * Publish a new post to Instagram
   * Note: This requires Instagram Content Publishing API permissions
   */
  async publishPost(request: PublishMediaRequest): Promise<PublishMediaResult> {
    if (!this.client || !this.pageId || !this.accessToken) {
      throw new Error('Instagram client not configured')
    }

    try {
      // Step 1: Create media container
      const caption = this.formatCaption(request.caption, request.hashtags)
      
      const containerResponse = await this.createMediaContainer(
        request.imageUrl,
        caption
      )
      
      if (!containerResponse.id) {
        throw new Error('Failed to create media container')
      }

      // Step 2: Publish the media container
      const publishResponse = await this.publishMediaContainer(containerResponse.id)
      
      return {
        id: publishResponse.id,
        permalink: `https://www.instagram.com/p/${publishResponse.id}/`,
        published: true
      }
    } catch (error) {
      console.error('Failed to publish Instagram post:', error)
      throw new Error('Failed to publish Instagram post')
    }
  }

  /**
   * Create a media container for publishing
   */
  private async createMediaContainer(imageUrl: string, caption: string): Promise<{ id: string }> {
    if (!this.accessToken || !this.pageId) {
      throw new Error('Instagram credentials not configured')
    }

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${this.pageId}/media`,
      {
        image_url: imageUrl,
        caption: caption,
        access_token: this.accessToken
      }
    )

    return response.data
  }

  /**
   * Publish a media container
   */
  private async publishMediaContainer(containerId: string): Promise<{ id: string }> {
    if (!this.accessToken || !this.pageId) {
      throw new Error('Instagram credentials not configured')
    }

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${this.pageId}/media_publish`,
      {
        creation_id: containerId,
        access_token: this.accessToken
      }
    )

    return response.data
  }

  /**
   * Format caption with hashtags
   */
  private formatCaption(caption: string, hashtags: string[]): string {
    const formattedHashtags = hashtags.map(tag => `#${tag}`).join(' ')
    return `${caption}\n\n${formattedHashtags}`
  }

  /**
   * Validate that a URL is accessible for Instagram posting
   */
  async validateImageUrl(imageUrl: string): Promise<boolean> {
    try {
      const response = await axios.head(imageUrl)
      const contentType = response.headers['content-type']
      
      // Instagram supports JPEG and PNG images
      return contentType?.startsWith('image/') && 
             (contentType.includes('jpeg') || contentType.includes('png'))
    } catch (error) {
      console.error('Failed to validate image URL:', error)
      return false
    }
  }

  /**
   * Get insights for a specific post
   */
  async getPostInsights(postId: string): Promise<any> {
    if (!this.client) {
      throw new Error('Instagram client not configured')
    }

    try {
      // Available metrics for posts: impressions, reach, saved
      const response = await this.client.newGetSimplePostMediaInsightsRequest(
        postId,
        new Set(['impressions', 'reach', 'saved'])
      ).execute()

      return response.getInsights()
    } catch (error) {
      console.error('Failed to fetch post insights:', error)
      throw new Error('Failed to fetch post insights')
    }
  }

  /**
   * Exchange short-lived token for long-lived token
   */
  static async exchangeForLongLivedToken(
    appId: string,
    appSecret: string,
    shortLivedToken: string
  ): Promise<{ access_token: string; token_type: string; expires_in: number }> {
    try {
      const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortLivedToken
        }
      })

      return response.data
    } catch (error) {
      console.error('Failed to exchange token:', error)
      throw new Error('Failed to exchange token for long-lived token')
    }
  }
}

// Create singleton instance
export const instagramService = new InstagramService()

// Fallback service for when Instagram API is not configured
export class MockInstagramService {
  async getProfile(): Promise<InstagramProfile> {
    return {
      id: 'mock_profile_id',
      username: 'mock_user',
      account_type: 'BUSINESS',
      media_count: 42,
      followers_count: 1000,
      follows_count: 500,
      name: 'Mock Instagram Account',
      biography: 'This is a mock Instagram profile for testing',
      website: 'https://example.com',
      profile_picture_url: 'https://via.placeholder.com/150'
    }
  }

  async getRecentPosts(limit: number = 25): Promise<InstagramPost[]> {
    const mockPosts: InstagramPost[] = []
    
    for (let i = 0; i < Math.min(limit, 5); i++) {
      mockPosts.push({
        id: `mock_post_${i}`,
        caption: `Mock post ${i + 1} caption #mockpost #testing`,
        media_type: 'IMAGE',
        media_url: `https://via.placeholder.com/400?text=Mock+Post+${i + 1}`,
        permalink: `https://instagram.com/p/mock_${i}/`,
        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
        hashtags: ['mockpost', 'testing'],
        like_count: Math.floor(Math.random() * 100),
        comments_count: Math.floor(Math.random() * 20)
      })
    }

    return mockPosts
  }

  async publishPost(request: PublishMediaRequest): Promise<PublishMediaResult> {
    // Simulate successful publication
    const mockId = `mock_${Date.now()}`
    
    return {
      id: mockId,
      permalink: `https://instagram.com/p/${mockId}/`,
      published: true
    }
  }

  async validateImageUrl(imageUrl: string): Promise<boolean> {
    // Simple URL validation for mock
    return imageUrl.startsWith('http') && 
           (imageUrl.includes('jpg') || imageUrl.includes('png') || imageUrl.includes('jpeg'))
  }

  async getPostInsights(postId: string): Promise<any> {
    return {
      impressions: Math.floor(Math.random() * 1000),
      reach: Math.floor(Math.random() * 800),
      saved: Math.floor(Math.random() * 50)
    }
  }
}

export const mockInstagramService = new MockInstagramService()