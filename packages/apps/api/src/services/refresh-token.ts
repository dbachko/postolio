import { randomBytes, createHash } from 'crypto';
import { getDatabaseClient } from '../config/database.js';
import { AuditLogger, AuditEventType } from './audit-logger.js';
import { RedisTokenStore } from './redis-token-store.js';
import { rotateRefreshToken } from './refresh-token/rotate-refresh-token.js';
import { SessionService, type SessionMetadata } from './session.service.js';
import type { FastifyInstance } from 'fastify';

const prisma = getDatabaseClient();
const tokenStore = new RedisTokenStore();

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
  // With 12-minute refreshes, 100 generations is reached in ~20 hours. Keep this high enough
  // to avoid churn in normal usage while still providing a theoretical safety cap.
  private static readonly MAX_GENERATIONS = 20_000; // Maximum rotations per family
  private static readonly ROTATION_GRACE_MS = 15_000; // Allow for concurrent refresh requests

  /**
   * Generate a new refresh token
   */
  static async generateRefreshToken(
    fastify: FastifyInstance,
    userId: string,
    ipAddress?: string,
    userAgent?: string,
    sessionMetadata?: SessionMetadata
  ): Promise<{
    refreshToken: string;
    accessToken: string;
    family: string;
    sessionId: string;
  }> {
    // Generate token and family ID
    const token = randomBytes(this.TOKEN_LENGTH).toString('hex');
    const family = randomBytes(16).toString('hex');

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

    // Store token with efficient Set tracking
    await tokenStore.storeToken(tokenData, this.TOKEN_EXPIRY_DAYS * 24 * 60 * 60);

    // Track token family for rotation detection
    await tokenStore.storeFamily(
      family,
      {
        userId,
        currentGeneration: 1,
        createdAt: new Date(),
      },
      this.FAMILY_EXPIRY_DAYS * 24 * 60 * 60
    );

    // Create session in database
    const session = await SessionService.createSession({
      userId,
      refreshToken: token,
      metadata: {
        ...sessionMetadata,
        ipAddress,
        userAgent,
      },
      refreshTokenExpiry: this.TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
    });

    // Generate new access token
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const accessToken = fastify.jwt.sign(
      { id: user.id, email: user.email, sid: session.id }
      // Token expiry is configured in auth plugin (default 1h)
    );

    // Log token generation
    await AuditLogger.log({
      userId,
      eventType: AuditEventType.REFRESH_TOKEN_GENERATED,
      metadata: { family, generation: 1, ipAddress, userAgent, sessionId: session.id },
      success: true,
    });

    return { refreshToken: token, accessToken, family, sessionId: session.id };
  }

  /**
   * Rotate refresh token (generate new token from old one)
   */
  static async rotateRefreshToken(
    fastify: FastifyInstance,
    oldToken: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{
    refreshToken: string;
    accessToken: string;
    family: string;
  } | null> {
    return rotateRefreshToken({
      fastify,
      oldToken,
      ipAddress,
      userAgent,
      tokenLength: this.TOKEN_LENGTH,
      tokenExpiryDays: this.TOKEN_EXPIRY_DAYS,
      familyExpiryDays: this.FAMILY_EXPIRY_DAYS,
      maxGenerations: this.MAX_GENERATIONS,
      rotationGraceMs: this.ROTATION_GRACE_MS,
      tokenStore,
      prisma,
      sessionService: SessionService,
      auditLogger: AuditLogger,
      auditEventType: {
        REFRESH_TOKEN_REUSE_DETECTED: AuditEventType.REFRESH_TOKEN_REUSE_DETECTED,
        REFRESH_TOKEN_ROTATED: AuditEventType.REFRESH_TOKEN_ROTATED,
      },
      invalidateTokenFamily: (family, userId) => this.invalidateTokenFamily(family, userId),
    });
  }

  /**
   * Invalidate a session's refresh token by matching its stored hash.
   * Returns true if a token was found and deleted.
   */
  static async invalidateSessionTokenByHash(
    userId: string,
    refreshTokenHash: string
  ): Promise<boolean> {
    const userTokens = await tokenStore.getUserTokens(userId);
    for (const t of userTokens) {
      const hash = createHash('sha256').update(t.token).digest('hex');
      if (hash === refreshTokenHash) {
        await tokenStore.deleteToken(t.token);
        return true;
      }
    }
    return false;
  }

  /**
   * Invalidate all user's refresh tokens except the one matching keepHash (if provided).
   * Returns the number of tokens deleted.
   */
  static async invalidateAllUserTokensExceptHash(
    userId: string,
    keepHash?: string
  ): Promise<number> {
    const userTokens = await tokenStore.getUserTokens(userId);
    let deleted = 0;
    for (const t of userTokens) {
      const hash = createHash('sha256').update(t.token).digest('hex');
      if (!keepHash || hash !== keepHash) {
        await tokenStore.deleteToken(t.token);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Invalidate a refresh token
   */
  static async invalidateRefreshToken(token: string): Promise<boolean> {
    const parsed = await tokenStore.getToken(token);

    if (!parsed) {
      return false;
    }

    // Delete token
    await tokenStore.deleteToken(token);

    // Revoke session
    const session = await SessionService.findSessionByToken(token);
    if (session) {
      await SessionService.revokeSession(session.id, 'user_logout');
    }

    // Log invalidation
    await AuditLogger.log({
      userId: parsed.userId,
      eventType: AuditEventType.REFRESH_TOKEN_INVALIDATED,
      metadata: {
        family: parsed.family,
        generation: parsed.generation,
        sessionId: session?.id,
      },
      success: true,
    });

    return true;
  }

  /**
   * Invalidate entire token family (security breach response)
   */
  static async invalidateTokenFamily(family: string, userId: string): Promise<void> {
    // Delete all tokens in family using efficient Set operations
    await tokenStore.deleteFamilyTokens(family);

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
    // Delete all user tokens using efficient Set operations
    await tokenStore.deleteUserTokens(userId);

    // Revoke all user sessions
    await SessionService.revokeAllUserSessions(userId);

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
    const parsed = await tokenStore.getToken(token);

    if (!parsed) {
      return null;
    }

    // Check expiry
    if (new Date(parsed.expiresAt) < new Date()) {
      await tokenStore.deleteToken(token);
      return null;
    }

    // Update last used timestamp
    parsed.lastUsedAt = new Date();
    await tokenStore.updateToken(token, parsed, this.TOKEN_EXPIRY_DAYS * 24 * 60 * 60);

    return parsed;
  }

  /**
   * Get all active refresh tokens for a user
   */
  static async getUserTokens(userId: string): Promise<RefreshToken[]> {
    // Use efficient Set-based lookup
    return await tokenStore.getUserTokens(userId);
  }

  /**
   * Clean up expired tokens (run periodically)
   */
  static async cleanupExpiredTokens(): Promise<number> {
    // Use the optimized cleanup method from tokenStore
    return await tokenStore.cleanupExpiredTokens();
  }
}
