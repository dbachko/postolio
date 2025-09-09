import { randomBytes } from "crypto";
import Redis from "ioredis";
import { getDatabaseClient } from "../config/database.js";
import { AuditLogger, AuditEventType } from "./audit-logger.js";
import { signJWT } from "./jwt.js";
import { getRedisUrl } from "../utils/redis-url.js";

const prisma = getDatabaseClient();
const redis = new Redis(getRedisUrl());

interface RefreshToken {
  token: string;
  userId: string;
  family: string; // Token family for rotation tracking
  generation: number; // Generation number within family
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt?: Date;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export class RefreshTokenService {
  private static readonly TOKEN_LENGTH = 32;
  private static readonly TOKEN_EXPIRY_DAYS = 30;
  private static readonly FAMILY_EXPIRY_DAYS = 90; // Family tracking for 90 days
  private static readonly MAX_GENERATIONS = 100; // Maximum rotations per family

  /**
   * Generate a new refresh token
   */
  static async generateRefreshToken(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    refreshToken: string;
    accessToken: string;
    family: string;
  }> {
    // Generate token and family ID
    const token = randomBytes(this.TOKEN_LENGTH).toString("hex");
    const family = randomBytes(16).toString("hex");

    // Create expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.TOKEN_EXPIRY_DAYS);

    // Store in Redis with token metadata
    const tokenData: RefreshToken = {
      token,
      userId,
      family,
      generation: 1,
      expiresAt,
      createdAt: new Date(),
      ipAddress,
      userAgent,
    };

    await redis.setex(
      `refresh-token:${token}`,
      this.TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
      JSON.stringify(tokenData),
    );

    // Track token family for rotation detection
    await redis.setex(
      `token-family:${family}`,
      this.FAMILY_EXPIRY_DAYS * 24 * 60 * 60,
      JSON.stringify({
        userId,
        currentGeneration: 1,
        createdAt: new Date(),
      }),
    );

    // Generate new access token
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const accessToken = signJWT(
      { id: user.id, email: user.email },
      "15m", // Short-lived access token
    );

    // Log token generation
    await AuditLogger.log({
      userId,
      eventType: AuditEventType.REFRESH_TOKEN_GENERATED,
      metadata: { family, generation: 1, ipAddress, userAgent },
      success: true,
    });

    return { refreshToken: token, accessToken, family };
  }

  /**
   * Rotate refresh token (generate new token from old one)
   */
  static async rotateRefreshToken(
    oldToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    refreshToken: string;
    accessToken: string;
    family: string;
  } | null> {
    // Get old token data
    const oldTokenData = await redis.get(`refresh-token:${oldToken}`);

    if (!oldTokenData) {
      // Token doesn't exist or expired
      return null;
    }

    const oldTokenParsed: RefreshToken = JSON.parse(oldTokenData);

    // Check token expiry
    if (new Date(oldTokenParsed.expiresAt) < new Date()) {
      await redis.del(`refresh-token:${oldToken}`);
      return null;
    }

    // Check token family
    const familyData = await redis.get(`token-family:${oldTokenParsed.family}`);

    if (!familyData) {
      // Family expired or doesn't exist - potential security issue
      await this.invalidateTokenFamily(
        oldTokenParsed.family,
        oldTokenParsed.userId,
      );
      await AuditLogger.log({
        userId: oldTokenParsed.userId,
        eventType: AuditEventType.REFRESH_TOKEN_REUSE_DETECTED,
        metadata: {
          family: oldTokenParsed.family,
          generation: oldTokenParsed.generation,
          ipAddress,
          userAgent,
        },
        success: false,
      });
      return null;
    }

    const family = JSON.parse(familyData);

    // Check for token reuse (generation mismatch)
    if (oldTokenParsed.generation !== family.currentGeneration) {
      // Token reuse detected - invalidate entire family
      await this.invalidateTokenFamily(
        oldTokenParsed.family,
        oldTokenParsed.userId,
      );
      await AuditLogger.log({
        userId: oldTokenParsed.userId,
        eventType: AuditEventType.REFRESH_TOKEN_REUSE_DETECTED,
        metadata: {
          family: oldTokenParsed.family,
          expectedGeneration: family.currentGeneration,
          actualGeneration: oldTokenParsed.generation,
          ipAddress,
          userAgent,
        },
        success: false,
      });
      return null;
    }

    // Check max generations
    if (oldTokenParsed.generation >= this.MAX_GENERATIONS) {
      // Force new family creation
      await this.invalidateTokenFamily(
        oldTokenParsed.family,
        oldTokenParsed.userId,
      );
      return this.generateRefreshToken(
        oldTokenParsed.userId,
        ipAddress,
        userAgent,
      );
    }

    // Generate new token in same family
    const newToken = randomBytes(this.TOKEN_LENGTH).toString("hex");
    const newGeneration = oldTokenParsed.generation + 1;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.TOKEN_EXPIRY_DAYS);

    // Store new token
    const newTokenData: RefreshToken = {
      token: newToken,
      userId: oldTokenParsed.userId,
      family: oldTokenParsed.family,
      generation: newGeneration,
      expiresAt,
      createdAt: new Date(),
      ipAddress,
      userAgent,
    };

    await redis.setex(
      `refresh-token:${newToken}`,
      this.TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
      JSON.stringify(newTokenData),
    );

    // Update family generation
    await redis.setex(
      `token-family:${oldTokenParsed.family}`,
      this.FAMILY_EXPIRY_DAYS * 24 * 60 * 60,
      JSON.stringify({
        ...family,
        currentGeneration: newGeneration,
        lastRotatedAt: new Date(),
      }),
    );

    // Invalidate old token
    await redis.del(`refresh-token:${oldToken}`);

    // Generate new access token
    const user = await prisma.user.findUnique({
      where: { id: oldTokenParsed.userId },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const accessToken = signJWT(
      { id: user.id, email: user.email },
      "15m", // Short-lived access token
    );

    // Log rotation
    await AuditLogger.log({
      userId: oldTokenParsed.userId,
      eventType: AuditEventType.REFRESH_TOKEN_ROTATED,
      metadata: {
        family: oldTokenParsed.family,
        oldGeneration: oldTokenParsed.generation,
        newGeneration,
        ipAddress,
        userAgent,
      },
      success: true,
    });

    return {
      refreshToken: newToken,
      accessToken,
      family: oldTokenParsed.family,
    };
  }

  /**
   * Invalidate a refresh token
   */
  static async invalidateRefreshToken(token: string): Promise<boolean> {
    const tokenData = await redis.get(`refresh-token:${token}`);

    if (!tokenData) {
      return false;
    }

    const parsed: RefreshToken = JSON.parse(tokenData);

    // Delete token
    await redis.del(`refresh-token:${token}`);

    // Log invalidation
    await AuditLogger.log({
      userId: parsed.userId,
      eventType: AuditEventType.REFRESH_TOKEN_INVALIDATED,
      metadata: {
        family: parsed.family,
        generation: parsed.generation,
      },
      success: true,
    });

    return true;
  }

  /**
   * Invalidate entire token family (security breach response)
   */
  static async invalidateTokenFamily(
    family: string,
    userId: string,
  ): Promise<void> {
    // Delete family tracking
    await redis.del(`token-family:${family}`);

    // Find and delete all tokens in family
    const keys = await redis.keys(`refresh-token:*`);

    for (const key of keys) {
      const tokenData = await redis.get(key);
      if (tokenData) {
        const parsed: RefreshToken = JSON.parse(tokenData);
        if (parsed.family === family) {
          await redis.del(key);
        }
      }
    }

    // Log family invalidation
    await AuditLogger.log({
      userId,
      eventType: AuditEventType.REFRESH_TOKEN_FAMILY_INVALIDATED,
      metadata: { family },
      success: true,
    });
  }

  /**
   * Invalidate all refresh tokens for a user (logout from all devices)
   */
  static async invalidateAllUserTokens(userId: string): Promise<void> {
    const keys = await redis.keys(`refresh-token:*`);

    for (const key of keys) {
      const tokenData = await redis.get(key);
      if (tokenData) {
        const parsed: RefreshToken = JSON.parse(tokenData);
        if (parsed.userId === userId) {
          await redis.del(key);
        }
      }
    }

    // Log invalidation
    await AuditLogger.log({
      userId,
      eventType: AuditEventType.ALL_REFRESH_TOKENS_INVALIDATED,
      metadata: {},
      success: true,
    });
  }

  /**
   * Verify refresh token validity
   */
  static async verifyRefreshToken(token: string): Promise<RefreshToken | null> {
    const tokenData = await redis.get(`refresh-token:${token}`);

    if (!tokenData) {
      return null;
    }

    const parsed: RefreshToken = JSON.parse(tokenData);

    // Check expiry
    if (new Date(parsed.expiresAt) < new Date()) {
      await redis.del(`refresh-token:${token}`);
      return null;
    }

    // Update last used timestamp
    parsed.lastUsedAt = new Date();
    await redis.setex(
      `refresh-token:${token}`,
      this.TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
      JSON.stringify(parsed),
    );

    return parsed;
  }

  /**
   * Get all active refresh tokens for a user
   */
  static async getUserTokens(userId: string): Promise<RefreshToken[]> {
    const keys = await redis.keys(`refresh-token:*`);
    const tokens: RefreshToken[] = [];

    for (const key of keys) {
      const tokenData = await redis.get(key);
      if (tokenData) {
        const parsed: RefreshToken = JSON.parse(tokenData);
        if (parsed.userId === userId) {
          tokens.push(parsed);
        }
      }
    }

    return tokens;
  }

  /**
   * Clean up expired tokens (run periodically)
   */
  static async cleanupExpiredTokens(): Promise<number> {
    const keys = await redis.keys(`refresh-token:*`);
    let deletedCount = 0;

    for (const key of keys) {
      const tokenData = await redis.get(key);
      if (tokenData) {
        const parsed: RefreshToken = JSON.parse(tokenData);
        if (new Date(parsed.expiresAt) < new Date()) {
          await redis.del(key);
          deletedCount++;
        }
      }
    }

    return deletedCount;
  }
}
