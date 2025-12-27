import { randomBytes, createHash } from 'crypto';
import { getDatabaseClient } from '../config/database.js';
import { AuditLogger, AuditEventType } from './audit-logger.js';
import { RedisTokenStore } from './redis-token-store.js';
import { SessionService, SessionMetadata } from './session.service.js';
import { FastifyInstance } from 'fastify';

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
    // Get old token data
    const oldTokenParsed = await tokenStore.getToken(oldToken);

    if (!oldTokenParsed) {
      // Token doesn't exist or expired
      return null;
    }

    // Check token expiry
    if (new Date(oldTokenParsed.expiresAt) < new Date()) {
      await tokenStore.deleteToken(oldToken);
      return null;
    }

    // Check token family
    const family = await tokenStore.getFamily(oldTokenParsed.family);

    if (!family) {
      // Family expired or doesn't exist - potential security issue
      await this.invalidateTokenFamily(oldTokenParsed.family, oldTokenParsed.userId);
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

    const currentGeneration = Number((family as any).currentGeneration);
    if (!Number.isFinite(currentGeneration) || currentGeneration < 1) {
      // Corrupt or unexpected family data - treat as security issue
      await this.invalidateTokenFamily(oldTokenParsed.family, oldTokenParsed.userId);
      await AuditLogger.log({
        userId: oldTokenParsed.userId,
        eventType: AuditEventType.REFRESH_TOKEN_REUSE_DETECTED,
        metadata: {
          family: oldTokenParsed.family,
          expectedGeneration: (family as any).currentGeneration,
          actualGeneration: oldTokenParsed.generation,
          ipAddress,
          userAgent,
          reason: 'invalid_family_generation',
        },
        success: false,
      });
      return null;
    }

    // Check for token reuse (generation mismatch)
    if (oldTokenParsed.generation !== currentGeneration) {
      // Handle common false-positive: concurrent refresh requests racing each other.
      // If the provided token is immediately previous and the family rotated very recently,
      // return the current token instead of invalidating the whole family.
      const lastRotatedAtRaw = (family as any).lastRotatedAt;
      const lastRotatedAtMs =
        typeof lastRotatedAtRaw === 'string' || typeof lastRotatedAtRaw === 'number'
          ? new Date(lastRotatedAtRaw as any).getTime()
          : 0;
      const withinGrace =
        Number.isFinite(lastRotatedAtMs) && Date.now() - lastRotatedAtMs <= this.ROTATION_GRACE_MS;
      const isPreviousGeneration = oldTokenParsed.generation === currentGeneration - 1;
      const sameUserAgent =
        !oldTokenParsed.userAgent || !userAgent ? true : oldTokenParsed.userAgent === userAgent;

      if (withinGrace && isPreviousGeneration && sameUserAgent) {
        // Best-effort: fetch the current token for this family and return it
        for (let attempt = 0; attempt < 3; attempt++) {
          const familyTokens = await tokenStore.getFamilyTokens(oldTokenParsed.family);
          const current = familyTokens.find((t) => t.generation === currentGeneration);
          if (current) {
            // Ensure the DB session points at the current token (idempotent safety for timing races)
            const session =
              (await SessionService.findSessionByToken(current.token)) ||
              (await SessionService.findSessionByToken(oldToken));
            if (session) {
              await SessionService.updateLastActivity(session.id);
              await SessionService.updateRefreshTokenHash(session.id, current.token);
            }

            const user = await prisma.user.findUnique({
              where: { id: oldTokenParsed.userId },
              select: { id: true, email: true },
            });
            if (!user) throw new Error('User not found');

            const accessToken = fastify.jwt.sign({
              id: user.id,
              email: user.email,
              sid: session?.id,
            });

            await AuditLogger.log({
              userId: oldTokenParsed.userId,
              eventType: AuditEventType.REFRESH_TOKEN_ROTATED,
              metadata: {
                reason: 'concurrent_refresh_grace',
                family: oldTokenParsed.family,
                expectedGeneration: currentGeneration,
                actualGeneration: oldTokenParsed.generation,
                ipAddress,
                userAgent,
                sessionId: session?.id,
              },
              success: true,
            });

            return {
              refreshToken: current.token,
              accessToken,
              family: oldTokenParsed.family,
            };
          }
          // Wait a moment for the other in-flight rotation to persist the new token
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      // Token reuse detected - invalidate entire family
      await this.invalidateTokenFamily(oldTokenParsed.family, oldTokenParsed.userId);
      await AuditLogger.log({
        userId: oldTokenParsed.userId,
        eventType: AuditEventType.REFRESH_TOKEN_REUSE_DETECTED,
        metadata: {
          family: oldTokenParsed.family,
          expectedGeneration: currentGeneration,
          actualGeneration: oldTokenParsed.generation,
          ipAddress,
          userAgent,
        },
        success: false,
      });
      return null;
    }

    // Validate that the old token maps to an active session; if not, treat as invalid
    let session = null;
    try {
      session = await SessionService.findSessionByToken(oldToken);
    } catch {
      // In dev, if Prisma client for sessions isn't initialized yet, fail gracefully
      // Returning null will cause the refresh route to respond 401 instead of 500
      return null;
    }
    if (!session) {
      // Ensure any lingering old token is removed and stop rotation
      await tokenStore.deleteToken(oldToken);
      return null;
    }

    // Check max generations (maintenance: reset family without creating a new DB session)
    if (oldTokenParsed.generation >= this.MAX_GENERATIONS) {
      const newToken = randomBytes(this.TOKEN_LENGTH).toString('hex');
      const newFamily = randomBytes(16).toString('hex');

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + this.TOKEN_EXPIRY_DAYS);

      const newTokenData: RefreshToken = {
        token: newToken,
        userId: oldTokenParsed.userId,
        family: newFamily,
        generation: 1,
        expiresAt,
        createdAt: new Date(),
        ipAddress,
        userAgent,
      };

      await tokenStore.storeToken(newTokenData, this.TOKEN_EXPIRY_DAYS * 24 * 60 * 60);
      await tokenStore.storeFamily(
        newFamily,
        {
          userId: oldTokenParsed.userId,
          currentGeneration: 1,
          createdAt: new Date(),
        },
        this.FAMILY_EXPIRY_DAYS * 24 * 60 * 60
      );

      // Keep the same session; just point it at the new token and refresh activity timestamps.
      await SessionService.updateLastActivity(session.id);
      await SessionService.updateRefreshTokenHash(session.id, newToken);

      // Retire the old family tokens/data (this is NOT a reuse event).
      await tokenStore.deleteFamilyTokens(oldTokenParsed.family);

      const user = await prisma.user.findUnique({
        where: { id: oldTokenParsed.userId },
        select: { id: true, email: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const accessToken = fastify.jwt.sign(
        { id: user.id, email: user.email, sid: session.id }
        // Token expiry is configured in auth plugin (default 1h)
      );

      await AuditLogger.log({
        userId: oldTokenParsed.userId,
        eventType: AuditEventType.REFRESH_TOKEN_ROTATED,
        metadata: {
          reason: 'max_generations',
          oldFamily: oldTokenParsed.family,
          oldGeneration: oldTokenParsed.generation,
          newFamily,
          newGeneration: 1,
          ipAddress,
          userAgent,
          sessionId: session.id,
        },
        success: true,
      });

      return {
        refreshToken: newToken,
        accessToken,
        family: newFamily,
      };
    }

    // Generate new token in same family
    const newToken = randomBytes(this.TOKEN_LENGTH).toString('hex');
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

    // Store new token with efficient Set tracking
    await tokenStore.storeToken(newTokenData, this.TOKEN_EXPIRY_DAYS * 24 * 60 * 60);

    // Update family generation
    await tokenStore.storeFamily(
      oldTokenParsed.family,
      {
        ...family,
        currentGeneration: newGeneration,
        lastRotatedAt: new Date(),
      },
      this.FAMILY_EXPIRY_DAYS * 24 * 60 * 60
    );

    // Update session last activity and refresh token hash
    await SessionService.updateLastActivity(session.id);
    // Update the stored refreshTokenHash to the new token's hash
    await SessionService.updateRefreshTokenHash(session.id, newToken);

    // Retire old token briefly to tolerate concurrent refresh calls without triggering reuse invalidation.
    // This keeps the old token addressable for a short grace window but removes it from tracking sets.
    await tokenStore.retireToken(oldToken, Math.ceil(this.ROTATION_GRACE_MS / 1000), {
      supersededBy: newToken,
      supersededAt: new Date().toISOString(),
    });

    // Generate new access token (include session id if available)
    const user = await prisma.user.findUnique({
      where: { id: oldTokenParsed.userId },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const accessToken = fastify.jwt.sign(
      { id: user.id, email: user.email, sid: session?.id }
      // Token expiry is configured in auth plugin (default 1h)
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
        sessionId: session?.id,
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
