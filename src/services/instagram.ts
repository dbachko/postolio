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
        const keyTime = parseInt(key.split('_')[1])
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