/**
 * Publisher Content Service
 * Provides fresh content details for AWS publisher Lambda at publish time
 * This ensures we always publish the latest edited content, not stale data
 */

import { getDatabaseClient } from '../config/database.js';
import { getRedisClient } from '../services/redis.js';

const prisma = getDatabaseClient();

export interface PublisherContent {
  id: string;
  caption: string;
  hashtags: string[];
  mediaUrls: string[];
  cdnImageUrl: string | null;
  brandId: string;
  contentType: 'image' | 'video' | 'carousel' | 'reel' | 'story';
  brandName: string;
}

export interface ContentValidationResult {
  isValid: boolean;
  error?: string;
  statusCode?: number;
}

// Cache TTL: 2 minutes (content can change frequently during editing)
const CACHE_TTL_SECONDS = 120;

export class PublisherContentService {
  /**
   * Fetch fresh content details for publishing with caching
   * This should be called by the publisher Lambda at publish time
   */
  static async getContentForPublishing(contentId: string): Promise<PublisherContent | null> {
    try {
      // Try cache first (shorter TTL than credentials since content changes more often)
      const redis = getRedisClient();
      const cacheKey = `publisher:content:${contentId}`;
      
      if (redis) {
        try {
          const cached = await redis.get(cacheKey);
          if (cached) {
            console.log(`Content cache hit for ${contentId}`);
            return JSON.parse(cached);
          }
        } catch (cacheError) {
          console.warn('Redis content cache read failed, falling back to database:', cacheError);
        }
      }

      // Cache miss - fetch from database with optimized query
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          cdnImageUrl: true,
          brandId: true,
          status: true,
          generationParams: true, // For contentType detection
          brand: {
            select: {
              id: true,
              name: true,
              userId: true, // For authorization validation
            }
          }
        },
      });

      if (!content) {
        console.error(`Content not found: ${contentId}`);
        return null;
      }

      // Validate content is publishable
      const validation = this.validateContentForPublishing(content);
      if (!validation.isValid) {
        console.error(`Content validation failed: ${validation.error}`);
        return null;
      }

      // Prepare media URLs array with fallback logic
      const mediaUrls = this.prepareMediaUrls(content);

      // Detect content type from generation params or default to image
      const contentType = this.detectContentType(content.generationParams);

      const publisherContent: PublisherContent = {
        id: content.id,
        caption: content.caption,
        hashtags: content.hashtags,
        mediaUrls,
        cdnImageUrl: content.cdnImageUrl,
        brandId: content.brandId,
        contentType,
        brandName: content.brand.name,
      };

      // Cache the result (shorter TTL for content)
      if (redis) {
        try {
          await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(publisherContent));
          console.log(`Cached content for ${contentId} (TTL: ${CACHE_TTL_SECONDS}s)`);
        } catch (cacheError) {
          console.warn('Redis content cache write failed:', cacheError);
        }
      }

      return publisherContent;
    } catch (error) {
      console.error('Error fetching publisher content:', error);
      return null;
    }
  }

  /**
   * Validate that content is in a publishable state
   */
  static validateContentForPublishing(content: any): ContentValidationResult {
    if (content.status !== 'scheduled') {
      return {
        isValid: false,
        error: `Content ${content.id} is not scheduled for publishing (status: ${content.status})`,
        statusCode: 400
      };
    }

    if (!content.caption && (!content.hashtags || content.hashtags.length === 0)) {
      return {
        isValid: false,
        error: `Content ${content.id} has no caption or hashtags`,
        statusCode: 400
      };
    }

    if (!content.cdnImageUrl) {
      return {
        isValid: false,
        error: `Content ${content.id} has no media URLs`,
        statusCode: 400
      };
    }

    return { isValid: true };
  }

  /**
   * Prepare media URLs with fallback logic and validation
   */
  static prepareMediaUrls(content: any): string[] {
    const mediaUrls: string[] = [];
    
    // Add CDN URL if available
    if (content.cdnImageUrl) {
      mediaUrls.push(content.cdnImageUrl);
    }

    // Validate URLs
    return mediaUrls.filter(url => {
      try {
        new URL(url);
        return true;
      } catch {
        console.warn(`Invalid media URL filtered out: ${url}`);
        return false;
      }
    });
  }

  /**
   * Detect content type from generation parameters
   */
  static detectContentType(generationParams: any): PublisherContent['contentType'] {
    if (!generationParams) return 'image';
    
    const params = typeof generationParams === 'string' 
      ? JSON.parse(generationParams) 
      : generationParams;

    // Check for explicit content type
    if (params.contentType) {
      return params.contentType;
    }

    // Infer from other parameters
    if (params.videoUrl || params.isVideo) return 'video';
    if (params.isCarousel || params.multipleImages) return 'carousel';
    if (params.isReel) return 'reel';
    if (params.isStory) return 'story';

    return 'image'; // Default
  }

  /**
   * Invalidate cached content when user edits content
   * Call this when content is updated
   */
  static async invalidateContentCache(contentId: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    const cacheKey = `publisher:content:${contentId}`;
    try {
      await redis.del(cacheKey);
      console.log(`Invalidated content cache for ${contentId}`);
    } catch (error) {
      console.error('Failed to invalidate content cache:', error);
    }
  }

  /**
   * Get multiple content items for batch publishing (future enhancement)
   */
  static async getMultipleContentForPublishing(contentIds: string[]): Promise<(PublisherContent | null)[]> {
    const promises = contentIds.map(id => this.getContentForPublishing(id));
    return Promise.all(promises);
  }
}