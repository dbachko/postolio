import { prisma } from '../config/database.js';
import { addDays, addSeconds, isAfter } from 'date-fns';
import crypto from 'crypto';
import type { Session } from '@postolio/database';

export interface SessionMetadata {
  deviceFingerprint?: string;
  deviceName?: string;
  ipAddress?: string;
  userAgent?: string;
  location?: {
    city?: string;
    country?: string;
    region?: string;
  };
}

export interface CreateSessionOptions {
  userId: string;
  refreshToken: string;
  metadata?: SessionMetadata;
  refreshTokenExpiry: number;
  trusted?: boolean;
}

export class SessionService {
  private static readonly ABSOLUTE_TIMEOUT_DAYS = 90;
  private static readonly SLIDING_TIMEOUT_DAYS = 30;
  private static readonly TRUSTED_DEVICE_DAYS = 90;

  static async createSession(options: CreateSessionOptions): Promise<Session> {
    const { userId, refreshToken, metadata = {}, refreshTokenExpiry, trusted = false } = options;

    const refreshTokenHash = this.hashToken(refreshToken);

    const now = new Date();
    const absoluteExpiry = addDays(now, this.ABSOLUTE_TIMEOUT_DAYS);
    const refreshTokenExpires = addSeconds(now, refreshTokenExpiry);
    const expiresAt = isAfter(refreshTokenExpires, absoluteExpiry)
      ? absoluteExpiry
      : refreshTokenExpires;

    const session = await prisma.session.create({
      data: {
        userId,
        refreshTokenHash,
        deviceFingerprint: metadata.deviceFingerprint,
        deviceName: metadata.deviceName,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        location: metadata.location || undefined,
        trusted,
        trustedUntil: trusted ? addDays(now, this.TRUSTED_DEVICE_DAYS) : null,
        expiresAt,
        lastActivityAt: now,
      },
    });

    return session;
  }

  static async updateLastActivity(sessionId: string): Promise<Session> {
    const now = new Date();
    const slidingExpiry = addDays(now, this.SLIDING_TIMEOUT_DAYS);

    const session = await prisma.session.update({
      where: { id: sessionId },
      data: {
        lastActivityAt: now,
        expiresAt: slidingExpiry,
      },
    });

    return session;
  }

  static async updateRefreshTokenHash(
    sessionId: string,
    newRefreshToken: string
  ): Promise<Session> {
    const newHash = this.hashToken(newRefreshToken);

    return prisma.session.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash: newHash,
      },
    });
  }

  static async findSessionByToken(refreshToken: string): Promise<Session | null> {
    const hash = this.hashToken(refreshToken);

    const session = await prisma.session.findFirst({
      where: {
        refreshTokenHash: hash,
        revokedAt: null,
      },
    });

    if (!session) {
      return null;
    }

    if (isAfter(new Date(), session.expiresAt)) {
      await this.revokeSession(session.id, 'expired');
      return null;
    }

    return session;
  }

  static async revokeSession(sessionId: string, reason: string) {
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });
  }

  static async revokeAllUserSessions(userId: string, exceptSessionId?: string) {
    await prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId && { NOT: { id: exceptSessionId } }),
      },
      data: {
        revokedAt: new Date(),
        revokedReason: 'user_requested',
      },
    });
  }

  static async getUserSessions(userId: string): Promise<Session[]> {
    return prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: {
        lastActivityAt: 'desc',
      },
    });
  }

  static async getUserSessionsByRefreshTokenHashes(
    userId: string,
    refreshTokenHashes: string[]
  ): Promise<Session[]> {
    if (refreshTokenHashes.length === 0) return [];

    return prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gte: new Date() },
        refreshTokenHash: { in: refreshTokenHashes },
      },
      orderBy: {
        lastActivityAt: 'desc',
      },
    });
  }

  static async getSessionById(sessionId: string, userId: string): Promise<Session | null> {
    return prisma.session.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
      },
    });
  }

  static async updateDeviceName(
    sessionId: string,
    userId: string,
    deviceName: string
  ): Promise<Session> {
    // First verify ownership
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== userId) {
      throw new Error('Session not found or unauthorized');
    }

    // Then update using unique id selector
    return prisma.session.update({
      where: {
        id: sessionId,
      },
      data: {
        deviceName,
      },
    });
  }

  static async cleanupExpiredSessions() {
    const result = await prisma.session.updateMany({
      where: {
        expiresAt: { lt: new Date() },
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revokedReason: 'expired',
      },
    });

    return result.count;
  }

  static async deleteOldSessions(daysToKeep: number = 180) {
    const cutoffDate = addDays(new Date(), -daysToKeep);

    const result = await prisma.session.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        revokedAt: { not: null },
      },
    });

    return result.count;
  }

  private static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  static async checkSlidingTimeout(sessionId: string): Promise<boolean> {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return false;
    }

    const now = new Date();
    const inactivityPeriod = now.getTime() - session.lastActivityAt.getTime();
    const slidingTimeoutMs = this.SLIDING_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

    if (inactivityPeriod > slidingTimeoutMs) {
      await this.revokeSession(sessionId, 'sliding_timeout');
      return false;
    }

    return true;
  }

  static async checkAbsoluteTimeout(sessionId: string): Promise<boolean> {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return false;
    }

    if (isAfter(new Date(), session.expiresAt)) {
      await this.revokeSession(sessionId, 'absolute_timeout');
      return false;
    }

    return true;
  }
}
