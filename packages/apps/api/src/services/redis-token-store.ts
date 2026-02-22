import type { Redis } from 'ioredis';
import { createRedisClient } from './redis.js';

interface TokenMetadata {
  token: string;
  userId: string;
  family: string;
  generation: number;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt?: Date;
  ipAddress?: string;
  userAgent?: string;
  // Optional lifecycle fields used to safely handle concurrent refresh rotations
  retiredAt?: string;
  supersededBy?: string;
  supersededAt?: string;
}

/**
 * Efficient Redis-based token store using Sets for tracking
 * Replaces O(n) KEYS operations with O(1) Set operations
 */
export class RedisTokenStore {
  private redis: Redis;

  // Set keys for tracking
  private static readonly USER_TOKENS_SET = 'users:tokens:'; // users:tokens:{userId}
  private static readonly FAMILY_TOKENS_SET = 'families:tokens:'; // families:tokens:{family}
  private static readonly ALL_TOKENS_SET = 'tokens:all'; // Global set of all tokens
  private static readonly TOKEN_PREFIX = 'refresh-token:';
  private static readonly FAMILY_PREFIX = 'token-family:';

  constructor(redis?: Redis) {
    this.redis = redis || createRedisClient();
  }

  /**
   * Store a new refresh token with efficient Set tracking
   */
  async storeToken(tokenData: TokenMetadata, ttlSeconds: number): Promise<void> {
    const tokenKey = `${RedisTokenStore.TOKEN_PREFIX}${tokenData.token}`;
    const userSetKey = `${RedisTokenStore.USER_TOKENS_SET}${tokenData.userId}`;
    const familySetKey = `${RedisTokenStore.FAMILY_TOKENS_SET}${tokenData.family}`;

    // Use pipeline for atomic operations
    const pipeline = this.redis.pipeline();

    // Store token data with TTL
    pipeline.setex(tokenKey, ttlSeconds, JSON.stringify(tokenData));

    // Add token to tracking sets
    pipeline.sadd(RedisTokenStore.ALL_TOKENS_SET, tokenData.token);
    pipeline.sadd(userSetKey, tokenData.token);
    pipeline.sadd(familySetKey, tokenData.token);

    // Set TTL on tracking sets (cleanup after longest possible token life)
    pipeline.expire(userSetKey, ttlSeconds);
    pipeline.expire(familySetKey, ttlSeconds);

    await pipeline.exec();
  }

  /**
   * Store token family data
   */
  async storeFamily(
    family: string,
    familyData: Record<string, unknown>,
    ttlSeconds: number
  ): Promise<void> {
    const familyKey = `${RedisTokenStore.FAMILY_PREFIX}${family}`;
    await this.redis.setex(familyKey, ttlSeconds, JSON.stringify(familyData));
  }

  /**
   * Get a token by its ID
   */
  async getToken(token: string): Promise<TokenMetadata | null> {
    const tokenKey = `${RedisTokenStore.TOKEN_PREFIX}${token}`;
    const data = await this.redis.get(tokenKey);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Get family data
   */
  async getFamily(family: string): Promise<Record<string, unknown> | null> {
    const familyKey = `${RedisTokenStore.FAMILY_PREFIX}${family}`;
    const data = await this.redis.get(familyKey);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Delete a token and remove from all tracking sets
   */
  async deleteToken(token: string): Promise<void> {
    const tokenKey = `${RedisTokenStore.TOKEN_PREFIX}${token}`;

    // Get token data to find associated sets
    const tokenData = await this.getToken(token);
    if (!tokenData) {
      return;
    }

    const userSetKey = `${RedisTokenStore.USER_TOKENS_SET}${tokenData.userId}`;
    const familySetKey = `${RedisTokenStore.FAMILY_TOKENS_SET}${tokenData.family}`;

    // Use pipeline for atomic deletion
    const pipeline = this.redis.pipeline();

    // Delete token data
    pipeline.del(tokenKey);

    // Remove from tracking sets
    pipeline.srem(RedisTokenStore.ALL_TOKENS_SET, token);
    pipeline.srem(userSetKey, token);
    pipeline.srem(familySetKey, token);

    await pipeline.exec();
  }

  /**
   * Retire a token for a short grace window (keeps the token key briefly but removes it from sets).
   * This avoids false-positive "token reuse" detection when multiple refresh requests race.
   */
  async retireToken(
    token: string,
    ttlSeconds: number,
    overrides?: Partial<TokenMetadata>
  ): Promise<void> {
    const tokenKey = `${RedisTokenStore.TOKEN_PREFIX}${token}`;

    const tokenData = await this.getToken(token);
    if (!tokenData) {
      return;
    }

    const userSetKey = `${RedisTokenStore.USER_TOKENS_SET}${tokenData.userId}`;
    const familySetKey = `${RedisTokenStore.FAMILY_TOKENS_SET}${tokenData.family}`;

    const now = new Date().toISOString();
    const retiredData: TokenMetadata = {
      ...tokenData,
      ...overrides,
      retiredAt: overrides?.retiredAt || now,
    };

    const pipeline = this.redis.pipeline();
    pipeline.setex(tokenKey, ttlSeconds, JSON.stringify(retiredData));
    pipeline.srem(RedisTokenStore.ALL_TOKENS_SET, token);
    pipeline.srem(userSetKey, token);
    pipeline.srem(familySetKey, token);
    await pipeline.exec();
  }

  /**
   * Get all tokens for a user (O(n) where n = user's tokens, not all tokens)
   */
  async getUserTokens(userId: string): Promise<TokenMetadata[]> {
    const userSetKey = `${RedisTokenStore.USER_TOKENS_SET}${userId}`;
    const tokenIds = await this.redis.smembers(userSetKey);

    if (tokenIds.length === 0) {
      return [];
    }

    // Use pipeline to fetch all tokens efficiently
    const pipeline = this.redis.pipeline();
    for (const tokenId of tokenIds) {
      pipeline.get(`${RedisTokenStore.TOKEN_PREFIX}${tokenId}`);
    }

    const results = await pipeline.exec();
    const tokens: TokenMetadata[] = [];

    if (results) {
      for (const [err, data] of results) {
        if (!err && data) {
          const tokenData = JSON.parse(data as string);
          tokens.push(tokenData);
        }
      }
    }

    return tokens;
  }

  /**
   * Get all tokens in a family (O(n) where n = family tokens, not all tokens)
   */
  async getFamilyTokens(family: string): Promise<TokenMetadata[]> {
    const familySetKey = `${RedisTokenStore.FAMILY_TOKENS_SET}${family}`;
    const tokenIds = await this.redis.smembers(familySetKey);

    if (tokenIds.length === 0) {
      return [];
    }

    // Use pipeline to fetch all tokens efficiently
    const pipeline = this.redis.pipeline();
    for (const tokenId of tokenIds) {
      pipeline.get(`${RedisTokenStore.TOKEN_PREFIX}${tokenId}`);
    }

    const results = await pipeline.exec();
    const tokens: TokenMetadata[] = [];

    if (results) {
      for (const [err, data] of results) {
        if (!err && data) {
          const tokenData = JSON.parse(data as string);
          tokens.push(tokenData);
        }
      }
    }

    return tokens;
  }

  /**
   * Delete all tokens for a user
   */
  async deleteUserTokens(userId: string): Promise<void> {
    const userSetKey = `${RedisTokenStore.USER_TOKENS_SET}${userId}`;
    const tokenIds = await this.redis.smembers(userSetKey);

    if (tokenIds.length === 0) {
      return;
    }

    // Use pipeline for atomic deletion
    const pipeline = this.redis.pipeline();

    for (const tokenId of tokenIds) {
      const tokenKey = `${RedisTokenStore.TOKEN_PREFIX}${tokenId}`;

      // Get token data to find family set
      const tokenData = await this.getToken(tokenId);
      if (tokenData) {
        const familySetKey = `${RedisTokenStore.FAMILY_TOKENS_SET}${tokenData.family}`;

        // Delete token
        pipeline.del(tokenKey);

        // Remove from all sets
        pipeline.srem(RedisTokenStore.ALL_TOKENS_SET, tokenId);
        pipeline.srem(familySetKey, tokenId);
      }
    }

    // Delete the user's token set
    pipeline.del(userSetKey);

    await pipeline.exec();
  }

  /**
   * Delete all tokens in a family
   */
  async deleteFamilyTokens(family: string): Promise<void> {
    const familySetKey = `${RedisTokenStore.FAMILY_TOKENS_SET}${family}`;
    const tokenIds = await this.redis.smembers(familySetKey);

    if (tokenIds.length === 0) {
      // Still delete the family data even if no tokens
      await this.redis.del(`${RedisTokenStore.FAMILY_PREFIX}${family}`);
      return;
    }

    // Use pipeline for atomic deletion
    const pipeline = this.redis.pipeline();

    for (const tokenId of tokenIds) {
      const tokenKey = `${RedisTokenStore.TOKEN_PREFIX}${tokenId}`;

      // Get token data to find user set
      const tokenData = await this.getToken(tokenId);
      if (tokenData) {
        const userSetKey = `${RedisTokenStore.USER_TOKENS_SET}${tokenData.userId}`;

        // Delete token
        pipeline.del(tokenKey);

        // Remove from all sets
        pipeline.srem(RedisTokenStore.ALL_TOKENS_SET, tokenId);
        pipeline.srem(userSetKey, tokenId);
      }
    }

    // Delete the family's token set and family data
    pipeline.del(familySetKey);
    pipeline.del(`${RedisTokenStore.FAMILY_PREFIX}${family}`);

    await pipeline.exec();
  }

  /**
   * Update token (maintains Set membership)
   */
  async updateToken(token: string, tokenData: TokenMetadata, ttlSeconds: number): Promise<void> {
    const tokenKey = `${RedisTokenStore.TOKEN_PREFIX}${token}`;
    await this.redis.setex(tokenKey, ttlSeconds, JSON.stringify(tokenData));
  }

  /**
   * Get count of all tokens (O(1) operation)
   */
  async getTokenCount(): Promise<number> {
    return await this.redis.scard(RedisTokenStore.ALL_TOKENS_SET);
  }

  /**
   * Get count of user's tokens (O(1) operation)
   */
  async getUserTokenCount(userId: string): Promise<number> {
    const userSetKey = `${RedisTokenStore.USER_TOKENS_SET}${userId}`;
    return await this.redis.scard(userSetKey);
  }

  /**
   * Cleanup expired tokens (for background job)
   * This is the only method that needs to check all tokens
   */
  async cleanupExpiredTokens(): Promise<number> {
    const tokenIds = await this.redis.smembers(RedisTokenStore.ALL_TOKENS_SET);
    let deletedCount = 0;

    // Process in batches to avoid blocking
    const batchSize = 100;
    for (let i = 0; i < tokenIds.length; i += batchSize) {
      const batch = tokenIds.slice(i, i + batchSize);
      const pipeline = this.redis.pipeline();

      // Fetch batch of tokens
      for (const tokenId of batch) {
        pipeline.get(`${RedisTokenStore.TOKEN_PREFIX}${tokenId}`);
      }

      const results = await pipeline.exec();
      const toDelete: string[] = [];

      if (results) {
        for (let j = 0; j < results.length; j++) {
          const [err, data] = results[j];
          if (!err && data) {
            const tokenData: TokenMetadata = JSON.parse(data as string);
            if (new Date(tokenData.expiresAt) < new Date()) {
              toDelete.push(batch[j]);
            }
          } else if (!data) {
            // Token doesn't exist but is in set - clean it up
            toDelete.push(batch[j]);
          }
        }
      }

      // Delete expired tokens
      for (const tokenId of toDelete) {
        await this.deleteToken(tokenId);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Health check - verify Set integrity
   */
  async verifyIntegrity(): Promise<{
    valid: boolean;
    orphanedTokens: string[];
    missingFromSets: string[];
  }> {
    const allTokens = await this.redis.smembers(RedisTokenStore.ALL_TOKENS_SET);
    const orphanedTokens: string[] = [];
    const missingFromSets: string[] = [];

    // Check each token exists and is in appropriate sets
    for (const tokenId of allTokens) {
      const tokenData = await this.getToken(tokenId);

      if (!tokenData) {
        orphanedTokens.push(tokenId);
        continue;
      }

      // Verify token is in user set
      const userSetKey = `${RedisTokenStore.USER_TOKENS_SET}${tokenData.userId}`;
      const inUserSet = await this.redis.sismember(userSetKey, tokenId);

      // Verify token is in family set
      const familySetKey = `${RedisTokenStore.FAMILY_TOKENS_SET}${tokenData.family}`;
      const inFamilySet = await this.redis.sismember(familySetKey, tokenId);

      if (!inUserSet || !inFamilySet) {
        missingFromSets.push(tokenId);
      }
    }

    return {
      valid: orphanedTokens.length === 0 && missingFromSets.length === 0,
      orphanedTokens,
      missingFromSets,
    };
  }

  /**
   * Migrate from old KEYS-based system to Set-based tracking
   * Run this once during deployment
   */
  async migrateFromKeysToSets(): Promise<{
    migrated: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let migrated = 0;

    // Find all existing refresh tokens using KEYS (one last time)
    const keys = await this.redis.keys('refresh-token:*');

    for (const key of keys) {
      try {
        const tokenData = await this.redis.get(key);
        if (tokenData) {
          const parsed: TokenMetadata = JSON.parse(tokenData);
          const token = parsed.token;

          // Add to tracking sets
          const userSetKey = `${RedisTokenStore.USER_TOKENS_SET}${parsed.userId}`;
          const familySetKey = `${RedisTokenStore.FAMILY_TOKENS_SET}${parsed.family}`;

          const pipeline = this.redis.pipeline();
          pipeline.sadd(RedisTokenStore.ALL_TOKENS_SET, token);
          pipeline.sadd(userSetKey, token);
          pipeline.sadd(familySetKey, token);

          // Calculate remaining TTL
          const ttl = await this.redis.ttl(key);
          if (ttl > 0) {
            pipeline.expire(userSetKey, ttl);
            pipeline.expire(familySetKey, ttl);
          }

          await pipeline.exec();
          migrated++;
        }
      } catch (error) {
        errors.push(`Failed to migrate ${key}: ${error}`);
      }
    }

    return { migrated, errors };
  }
}
