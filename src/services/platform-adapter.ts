/**
 * Platform Adapter Service
 * Provides a unified interface for publishing to multiple social media platforms
 */

import { FastifyInstance } from 'fastify'

export interface PlatformContent {
  caption: string
  hashtags: string[]
  mediaUrl?: string
  mediaType?: 'image' | 'video' | 'carousel'
  metadata?: Record<string, any>
}

export interface PublishResult {
  platform: string
  postId: string
  permalink?: string
  publishedAt: string
  metrics?: {
    impressions?: number
    reach?: number
    engagement?: number
  }
}

export interface PlatformCredentials {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  platformSpecific?: Record<string, any>
}

export interface PlatformAdapter {
  platform: string
  
  /**
   * Validate content meets platform requirements
   */
  validateContent(content: PlatformContent): ValidationResult
  
  /**
   * Format content according to platform specifications
   */
  formatContent(content: PlatformContent): PlatformContent
  
  /**
   * Publish content to the platform
   */
  publish(content: PlatformContent, credentials: PlatformCredentials): Promise<PublishResult>
  
  /**
   * Get post insights/analytics
   */
  getInsights?(postId: string, credentials: PlatformCredentials): Promise<any>
  
  /**
   * Delete a post from the platform
   */
  deletePost?(postId: string, credentials: PlatformCredentials): Promise<boolean>
  
  /**
   * Get platform-specific rate limits
   */
  getRateLimits(): RateLimits
  
  /**
   * Refresh OAuth tokens if needed
   */
  refreshToken?(refreshToken: string): Promise<PlatformCredentials>
}

export interface ValidationResult {
  valid: boolean
  errors?: string[]
  warnings?: string[]
}

export interface RateLimits {
  postsPerHour?: number
  postsPerDay?: number
  apiCallsPerHour?: number
  customLimits?: Record<string, number>
}

/**
 * Instagram Adapter Implementation
 */
export class InstagramAdapter implements PlatformAdapter {
  platform = 'instagram'
  
  validateContent(content: PlatformContent): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []
    
    // Instagram validation rules
    if (!content.mediaUrl) {
      errors.push('Instagram requires at least one image or video')
    }
    
    if (content.caption.length > 2200) {
      errors.push('Caption exceeds Instagram limit of 2,200 characters')
    }
    
    if (content.hashtags.length > 30) {
      warnings.push('Instagram allows maximum 30 hashtags, excess will be truncated')
    }
    
    // Check for banned hashtags (simplified list)
    const bannedHashtags = ['spam', 'follow4follow']
    const hasBanned = content.hashtags.some(tag => 
      bannedHashtags.includes(tag.toLowerCase().replace('#', ''))
    )
    if (hasBanned) {
      warnings.push('Content contains potentially banned hashtags')
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }
  
  formatContent(content: PlatformContent): PlatformContent {
    // Format hashtags
    const formattedHashtags = content.hashtags
      .slice(0, 30) // Limit to 30
      .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
    
    // Combine caption and hashtags
    const fullCaption = `${content.caption}\n\n${formattedHashtags.join(' ')}`
    
    // Truncate if needed
    const finalCaption = fullCaption.length > 2200 
      ? fullCaption.substring(0, 2197) + '...'
      : fullCaption
    
    return {
      ...content,
      caption: finalCaption,
      hashtags: [], // Hashtags are now in caption
    }
  }
  
  async publish(content: PlatformContent, credentials: PlatformCredentials): Promise<PublishResult> {
    // This would call the Instagram Graph API
    // For now, returning mock data
    return {
      platform: 'instagram',
      postId: `ig_${Date.now()}`,
      permalink: `https://instagram.com/p/mock_${Date.now()}`,
      publishedAt: new Date().toISOString(),
    }
  }
  
  getRateLimits(): RateLimits {
    return {
      postsPerHour: 25,
      postsPerDay: 100,
      apiCallsPerHour: 200,
    }
  }
}

/**
 * LinkedIn Adapter Implementation
 */
export class LinkedInAdapter implements PlatformAdapter {
  platform = 'linkedin'
  
  validateContent(content: PlatformContent): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []
    
    // LinkedIn validation rules
    if (content.caption.length > 3000) {
      errors.push('Caption exceeds LinkedIn limit of 3,000 characters')
    }
    
    if (content.hashtags.length > 30) {
      warnings.push('LinkedIn performs best with 3-5 hashtags')
    }
    
    if (content.mediaType === 'carousel') {
      warnings.push('LinkedIn does not support carousel posts, will post as single image')
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }
  
  formatContent(content: PlatformContent): PlatformContent {
    // LinkedIn prefers hashtags at the end
    const formattedHashtags = content.hashtags
      .slice(0, 10) // LinkedIn best practice
      .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
    
    const fullCaption = `${content.caption}\n\n${formattedHashtags.join(' ')}`
    
    return {
      ...content,
      caption: fullCaption.substring(0, 3000),
      hashtags: [],
    }
  }
  
  async publish(content: PlatformContent, credentials: PlatformCredentials): Promise<PublishResult> {
    // This would call the LinkedIn API
    return {
      platform: 'linkedin',
      postId: `li_${Date.now()}`,
      permalink: `https://linkedin.com/feed/update/mock_${Date.now()}`,
      publishedAt: new Date().toISOString(),
    }
  }
  
  getRateLimits(): RateLimits {
    return {
      postsPerHour: 10,
      postsPerDay: 50,
      apiCallsPerHour: 100,
    }
  }
}

/**
 * Facebook Adapter Implementation
 */
export class FacebookAdapter implements PlatformAdapter {
  platform = 'facebook'
  
  validateContent(content: PlatformContent): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []
    
    // Facebook validation rules
    if (content.caption.length > 63206) {
      errors.push('Caption exceeds Facebook limit of 63,206 characters')
    }
    
    if (content.hashtags.length > 30) {
      warnings.push('Facebook hashtags are less effective than on other platforms')
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }
  
  formatContent(content: PlatformContent): PlatformContent {
    // Facebook hashtags are optional
    const hashtagString = content.hashtags
      .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
      .join(' ')
    
    const fullCaption = hashtagString 
      ? `${content.caption}\n\n${hashtagString}`
      : content.caption
    
    return {
      ...content,
      caption: fullCaption,
      hashtags: [],
    }
  }
  
  async publish(content: PlatformContent, credentials: PlatformCredentials): Promise<PublishResult> {
    // This would call the Facebook Graph API
    return {
      platform: 'facebook',
      postId: `fb_${Date.now()}`,
      permalink: `https://facebook.com/mock_${Date.now()}`,
      publishedAt: new Date().toISOString(),
    }
  }
  
  getRateLimits(): RateLimits {
    return {
      postsPerHour: 50,
      postsPerDay: 200,
      apiCallsPerHour: 200,
    }
  }
}

/**
 * TikTok Adapter Implementation (Beta)
 */
export class TikTokAdapter implements PlatformAdapter {
  platform = 'tiktok'
  
  validateContent(content: PlatformContent): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []
    
    // TikTok validation rules
    if (content.mediaType !== 'video') {
      errors.push('TikTok requires video content')
    }
    
    if (content.caption.length > 2200) {
      errors.push('Caption exceeds TikTok limit of 2,200 characters')
    }
    
    if (content.hashtags.length > 100) {
      warnings.push('TikTok allows up to 100 hashtags but 3-5 is recommended')
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }
  
  formatContent(content: PlatformContent): PlatformContent {
    // TikTok hashtags in caption
    const formattedHashtags = content.hashtags
      .slice(0, 10) // Reasonable limit
      .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
    
    const fullCaption = `${content.caption} ${formattedHashtags.join(' ')}`
    
    return {
      ...content,
      caption: fullCaption.substring(0, 2200),
      hashtags: [],
    }
  }
  
  async publish(content: PlatformContent, credentials: PlatformCredentials): Promise<PublishResult> {
    // TikTok API is still in development
    throw new Error('TikTok publishing is in beta')
  }
  
  getRateLimits(): RateLimits {
    return {
      postsPerHour: 5,
      postsPerDay: 10,
      apiCallsPerHour: 50,
    }
  }
}

/**
 * Platform Adapter Factory
 */
export class PlatformAdapterFactory {
  private static adapters = new Map<string, PlatformAdapter>()
  
  static {
    // Register default adapters
    this.registerAdapter(new InstagramAdapter())
    this.registerAdapter(new LinkedInAdapter())
    this.registerAdapter(new FacebookAdapter())
    this.registerAdapter(new TikTokAdapter())
  }
  
  static registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter)
  }
  
  static getAdapter(platform: string): PlatformAdapter {
    const adapter = this.adapters.get(platform.toLowerCase())
    if (!adapter) {
      throw new Error(`Unsupported platform: ${platform}`)
    }
    return adapter
  }
  
  static getSupportedPlatforms(): string[] {
    return Array.from(this.adapters.keys())
  }
  
  static validateAllPlatforms(content: PlatformContent, platforms: string[]): Map<string, ValidationResult> {
    const results = new Map<string, ValidationResult>()
    
    for (const platform of platforms) {
      try {
        const adapter = this.getAdapter(platform)
        results.set(platform, adapter.validateContent(content))
      } catch (error) {
        results.set(platform, {
          valid: false,
          errors: [`Platform ${platform} is not supported`],
        })
      }
    }
    
    return results
  }
}

/**
 * Platform Service for Fastify integration
 */
export class PlatformService {
  constructor(private fastify: FastifyInstance) {}
  
  /**
   * Publish content to multiple platforms
   */
  async publishToMultiplePlatforms(
    content: PlatformContent,
    platforms: Array<{ platform: string; credentials: PlatformCredentials }>
  ): Promise<Map<string, PublishResult | Error>> {
    const results = new Map<string, PublishResult | Error>()
    
    // Validate content for all platforms first
    const validations = PlatformAdapterFactory.validateAllPlatforms(
      content,
      platforms.map(p => p.platform)
    )
    
    // Check for validation errors
    for (const [platform, validation] of validations.entries()) {
      if (!validation.valid) {
        results.set(platform, new Error(validation.errors?.join(', ')))
      }
    }
    
    // Publish to valid platforms
    const publishPromises = platforms
      .filter(p => validations.get(p.platform)?.valid)
      .map(async ({ platform, credentials }) => {
        try {
          const adapter = PlatformAdapterFactory.getAdapter(platform)
          const formattedContent = adapter.formatContent(content)
          const result = await adapter.publish(formattedContent, credentials)
          results.set(platform, result)
        } catch (error) {
          results.set(platform, error as Error)
        }
      })
    
    await Promise.allSettled(publishPromises)
    
    return results
  }
  
  /**
   * Get rate limit status for all platforms
   */
  getRateLimitStatus(): Map<string, RateLimits> {
    const status = new Map<string, RateLimits>()
    
    for (const platform of PlatformAdapterFactory.getSupportedPlatforms()) {
      const adapter = PlatformAdapterFactory.getAdapter(platform)
      status.set(platform, adapter.getRateLimits())
    }
    
    return status
  }
}