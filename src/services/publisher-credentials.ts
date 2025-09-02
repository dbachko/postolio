/**
 * Publisher Credentials Service
 * Provides a secure way for the AWS publisher Lambda to fetch fresh Instagram credentials
 * This ensures credentials are always up-to-date even if user reconnects their account
 */

import { getDatabaseClient } from '../config/database.js';
import { getRedisClient } from '../services/redis.js';
import { getTokenService } from './service-clients.js';

const prisma = getDatabaseClient();

export interface PublisherCredentials {
  accessToken: string | null;
  accountId: string | null;
  pageId: string | null;
  brandName: string;
  platform?: string;
}

// Cache TTL: 5 minutes (credentials rarely change)
const CACHE_TTL_SECONDS = 300;

export class PublisherCredentialsService {
  /**
   * Fetch fresh Instagram credentials for a brand with caching
   * This should be called by the publisher Lambda at publish time
   * to ensure we always have the latest valid credentials
   */
  static async getCredentialsForBrand(brandId: string): Promise<PublisherCredentials | null> {
    try {
      // Try cache first
      const redis = getRedisClient();
      const cacheKey = `publisher:credentials:${brandId}`;
      
      if (redis) {
        try {
          const cached = await redis.get(cacheKey);
          if (cached) {
            console.log(`Cache hit for brand ${brandId} credentials`);
            return JSON.parse(cached);
          }
        } catch (cacheError) {
          console.warn('Redis cache read failed, falling back to Token Service:', cacheError);
        }
      }

      // Cache miss - fetch brand metadata from database
      const brand = await prisma.brand.findUnique({
        where: { id: brandId },
        select: {
          id: true,
          name: true,
          userId: true,
          instagramAccountId: true,
          instagramPageId: true,
        },
      });

      if (!brand) {
        console.error(`Brand not found: ${brandId}`);
        return null;
      }

      // Fetch token from Token Service (using service discovery)
      const tokenServiceClient = await getTokenService();
      const tokenData = await tokenServiceClient.getToken(
        brand.userId,
        brand.id,
        'instagram'
      );

      if (!tokenData) {
        console.error(`No Instagram token found for brand: ${brandId}`);
        return null;
      }

      // Check if platform is connected
      if (!tokenData.accessToken) {
        console.error(`No token found for brand: ${brandId}`);
        return null;
      }

      const credentials = {
        accessToken: tokenData.accessToken,
        accountId: tokenData.metadata?.accountId || brand.instagramAccountId,
        pageId: tokenData.metadata?.pageId || brand.instagramPageId,
        brandName: brand.name,
        platform: 'instagram',
      };

      // Cache the result
      if (redis) {
        try {
          await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(credentials));
          console.log(`Cached credentials for brand ${brandId} (TTL: ${CACHE_TTL_SECONDS}s)`);
        } catch (cacheError) {
          console.warn('Redis cache write failed:', cacheError);
        }
      }

      return credentials;
    } catch (error) {
      console.error('Error fetching publisher credentials:', error);
      return null;
    }
  }

  /**
   * Validate that credentials are still valid
   */
  static async validateCredentials(credentials: PublisherCredentials): Promise<boolean> {
    if (!credentials.accessToken) {
      return false;
    }

    // Token Service handles expiry validation and auto-refresh
    // If we get a token from Token Service, it's already validated
    return true;
  }

  /**
   * Get credentials for publishing
   * This is the main method the publisher Lambda should call
   */
  static async getPublishingCredentials(brandId: string): Promise<PublisherCredentials | null> {
    const credentials = await this.getCredentialsForBrand(brandId);
    
    if (!credentials) {
      return null;
    }

    const isValid = await this.validateCredentials(credentials);
    
    if (!isValid) {
      console.error(`Invalid credentials for brand ${brandId}`);
      return null;
    }

    return credentials;
  }

  /**
   * Invalidate cached credentials when Instagram is reconnected
   * Call this when user updates their Instagram connection
   */
  static async invalidateCredentialsCache(brandId: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    const cacheKey = `publisher:credentials:${brandId}`;
    try {
      await redis.del(cacheKey);
      console.log(`Invalidated credential cache for brand ${brandId}`);
    } catch (error) {
      console.error('Failed to invalidate cache:', error);
    }
  }
}