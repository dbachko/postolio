/**
 * Publisher Credentials Service
 * Provides a secure way for the AWS publisher Lambda to fetch fresh Instagram credentials
 * This ensures credentials are always up-to-date even if user reconnects their account
 */

import { logger as baseLogger } from '@postolio/logger';
import { getDatabaseClient } from '../config/database.js';
import { getRedisClient } from '../services/redis.js';
import { getTokenService } from './service-clients.js';
import { formatError } from '../utils/logging.js';
import { resolvePrimarySocialAccount } from './social-account-resolver.js';

const prisma = getDatabaseClient();
const credentialsLogger = baseLogger.child({ module: 'publisher-credentials' });

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
            credentialsLogger.info(`Cache hit for brand ${brandId} credentials`);
            return JSON.parse(cached);
          }
        } catch (cacheError) {
          credentialsLogger.warn('Redis cache read failed, falling back to Token Service', {
            cacheKey,
            ...formatError(cacheError),
          });
        }
      }

      // Cache miss - fetch brand metadata from database
      const brand = await prisma.brand.findUnique({
        where: { id: brandId },
        select: {
          id: true,
          name: true,
          userId: true,
        },
      });

      if (!brand) {
        credentialsLogger.error(`Brand not found: ${brandId}`);
        return null;
      }

      const instagramAccount = await resolvePrimarySocialAccount(brandId, 'instagram');
      if (!instagramAccount) {
        credentialsLogger.error(`No Instagram account connected for brand: ${brandId}`);
        return null;
      }

      // Fetch token from Token Service (using service discovery)
      const tokenServiceClient = await getTokenService();
      const tokenData = await tokenServiceClient.getTokenForSocialAccount(
        brand.userId,
        brand.id,
        'instagram',
        instagramAccount.id
      );

      if (!tokenData) {
        credentialsLogger.error(`No Instagram token found for brand: ${brandId}`);
        return null;
      }

      // Check if platform is connected
      if (!tokenData.accessToken) {
        credentialsLogger.error(`No token found for brand: ${brandId}`);
        return null;
      }

      const credentials = {
        accessToken: tokenData.accessToken,
        accountId: tokenData.metadata?.accountId || instagramAccount.externalAccountId,
        pageId: tokenData.metadata?.pageId || instagramAccount.externalPageId,
        brandName: brand.name,
        platform: 'instagram',
      };

      // Cache the result
      if (redis) {
        try {
          await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(credentials));
          credentialsLogger.info(
            `Cached credentials for brand ${brandId} (TTL: ${CACHE_TTL_SECONDS}s)`
          );
        } catch (cacheError) {
          credentialsLogger.warn('Redis cache write failed', {
            cacheKey,
            ...formatError(cacheError),
          });
        }
      }

      return credentials;
    } catch (error) {
      credentialsLogger.error('Error fetching publisher credentials', formatError(error));
      return null;
    }
  }

  /**
   * Fetch fresh platform credentials for a specific social account with caching.
   * This avoids the "primary account leakage" problem when a brand has multiple
   * connected accounts for the same platform.
   */
  static async getCredentialsForSocialAccount(
    socialAccountId: string
  ): Promise<PublisherCredentials | null> {
    try {
      const redis = getRedisClient();
      const cacheKey = `publisher:credentials:social:${socialAccountId}`;

      if (redis) {
        try {
          const cached = await redis.get(cacheKey);
          if (cached) {
            credentialsLogger.info(`Cache hit for social account ${socialAccountId} credentials`);
            return JSON.parse(cached);
          }
        } catch (cacheError) {
          credentialsLogger.warn('Redis cache read failed, falling back to Token Service', {
            cacheKey,
            ...formatError(cacheError),
          });
        }
      }

      const account = await prisma.socialAccount.findUnique({
        where: { id: socialAccountId },
        select: {
          id: true,
          platform: true,
          externalAccountId: true,
          externalPageId: true,
          metadata: true,
          brand: {
            select: {
              id: true,
              name: true,
              userId: true,
            },
          },
        },
      });

      if (!account?.brand) {
        credentialsLogger.error(`Social account not found: ${socialAccountId}`);
        return null;
      }

      const accountMetadata = (account.metadata || {}) as Record<string, unknown>;
      if (
        accountMetadata &&
        typeof accountMetadata === 'object' &&
        (accountMetadata as any).disconnected
      ) {
        credentialsLogger.error(`Social account disconnected: ${socialAccountId}`);
        return null;
      }

      const platform = String(account.platform);

      const tokenServiceClient = await getTokenService();
      const tokenData = await tokenServiceClient.getTokenForSocialAccount(
        account.brand.userId,
        account.brand.id,
        platform,
        account.id
      );

      if (!tokenData?.accessToken) {
        credentialsLogger.error(`No token found for social account: ${socialAccountId}`);
        return null;
      }

      const credentials: PublisherCredentials = {
        accessToken: tokenData.accessToken,
        accountId: tokenData.metadata?.accountId || account.externalAccountId,
        pageId: tokenData.metadata?.pageId || account.externalPageId,
        brandName: account.brand.name,
        platform,
      };

      if (redis) {
        try {
          await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(credentials));
          credentialsLogger.info(
            `Cached credentials for social account ${socialAccountId} (TTL: ${CACHE_TTL_SECONDS}s)`
          );
        } catch (cacheError) {
          credentialsLogger.warn('Redis cache write failed', {
            cacheKey,
            ...formatError(cacheError),
          });
        }
      }

      return credentials;
    } catch (error) {
      credentialsLogger.error('Error fetching social account credentials', formatError(error));
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
      credentialsLogger.error(`Invalid credentials for brand ${brandId}`);
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
      credentialsLogger.info(`Invalidated credential cache for brand ${brandId}`);
    } catch (error) {
      credentialsLogger.error('Failed to invalidate cache', {
        cacheKey,
        ...formatError(error),
      });
    }
  }
}
