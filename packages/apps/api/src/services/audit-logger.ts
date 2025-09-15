import { getDatabaseClient } from '../config/database.js';
import { FastifyRequest } from 'fastify';
import { Prisma } from '@postolio/database';

const prisma = getDatabaseClient();

export enum AuditEventType {
  // Authentication events
  USER_REGISTER = 'USER_REGISTER',
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  USER_LOGIN_FAILED = 'USER_LOGIN_FAILED',

  // OAuth events
  OAUTH_LOGIN = 'OAUTH_LOGIN',
  OAUTH_LINK = 'OAUTH_LINK',
  OAUTH_UNLINK = 'OAUTH_UNLINK',

  // Magic link events
  MAGIC_LINK_SENT = 'MAGIC_LINK_SENT',
  MAGIC_LINK_VERIFIED = 'MAGIC_LINK_VERIFIED',
  MAGIC_LINK_FAILED = 'MAGIC_LINK_FAILED',

  // Email verification
  EMAIL_VERIFICATION_SENT = 'EMAIL_VERIFICATION_SENT',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',

  // Password events
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED = 'PASSWORD_RESET_COMPLETED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',

  // Security events
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED = 'ACCOUNT_UNLOCKED',
  TWO_FACTOR_ENABLED = 'TWO_FACTOR_ENABLED',
  TWO_FACTOR_DISABLED = 'TWO_FACTOR_DISABLED',
  TWO_FACTOR_VERIFIED = 'TWO_FACTOR_VERIFIED',
  TWO_FACTOR_FAILED = 'TWO_FACTOR_FAILED',

  // Session events
  SESSION_CREATED = 'SESSION_CREATED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_INVALIDATED = 'SESSION_INVALIDATED',

  // Refresh token events
  REFRESH_TOKEN_GENERATED = 'REFRESH_TOKEN_GENERATED',
  REFRESH_TOKEN_ROTATED = 'REFRESH_TOKEN_ROTATED',
  REFRESH_TOKEN_INVALIDATED = 'REFRESH_TOKEN_INVALIDATED',
  REFRESH_TOKEN_FAMILY_INVALIDATED = 'REFRESH_TOKEN_FAMILY_INVALIDATED',
  REFRESH_TOKEN_REUSE_DETECTED = 'REFRESH_TOKEN_REUSE_DETECTED',
  ALL_REFRESH_TOKENS_INVALIDATED = 'ALL_REFRESH_TOKENS_INVALIDATED',

  // System events
  SYSTEM_CLEANUP = 'SYSTEM_CLEANUP',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  SYSTEM_MIGRATION = 'SYSTEM_MIGRATION',
  SYSTEM_INTEGRITY_CHECK = 'SYSTEM_INTEGRITY_CHECK',
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  email: string | null;
  eventType: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Prisma.JsonValue;
  success: boolean;
  errorMessage: string | null;
  createdAt: Date;
}

export class AuditLogger {
  /**
   * Log an audit event
   */
  static async log(params: {
    userId?: string;
    email?: string;
    eventType: AuditEventType;
    request?: FastifyRequest;
    metadata?: Record<string, unknown>;
    success?: boolean;
    errorMessage?: string;
  }): Promise<void> {
    try {
      const {
        userId,
        email,
        eventType,
        request,
        metadata = {},
        success = true,
        errorMessage,
      } = params;

      // Extract request information if available
      const ipAddress = request ? this.getClientIp(request) : undefined;
      const userAgent = request?.headers['user-agent'] || undefined;

      // Create audit log entry
      await prisma.auditLog.create({
        data: {
          userId: userId || null,
          email: email || null,
          eventType,
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
          metadata: (metadata ? JSON.parse(JSON.stringify(metadata)) : {}) as Prisma.InputJsonValue,
          success,
          errorMessage: errorMessage || null,
        },
      });

      // Also log to console for monitoring
      console.log(`[AUDIT] ${eventType}`, {
        userId,
        email,
        ipAddress,
        success,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Don't let audit logging failures break the application
      console.error('Failed to write audit log:', error);
    }
  }

  /**
   * Log a successful authentication event
   */
  static async logAuth(
    eventType: AuditEventType,
    userId: string,
    email: string,
    request: FastifyRequest,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      userId,
      email,
      eventType,
      request,
      metadata: metadata || {},
      success: true,
    });
  }

  /**
   * Log a failed authentication attempt
   */
  static async logAuthFailure(
    eventType: AuditEventType,
    email: string,
    request: FastifyRequest,
    errorMessage: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      email,
      eventType,
      request,
      metadata: metadata || {},
      success: false,
      errorMessage,
    });
  }

  /**
   * Get client IP address from request
   */
  private static getClientIp(request: FastifyRequest): string {
    // Check for forwarded IP (when behind proxy/load balancer)
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
      return forwarded.split(',')[0]?.trim() || 'unknown';
    } else if (forwarded && Array.isArray(forwarded) && forwarded[0]) {
      return forwarded[0].split(',')[0]?.trim() || 'unknown';
    }

    // Check for real IP header (CloudFront, Nginx)
    const realIp = request.headers['x-real-ip'];
    if (realIp && typeof realIp === 'string') {
      return realIp;
    }

    // Fallback to socket IP
    return request.ip || 'unknown';
  }

  /**
   * Query audit logs
   */
  static async query(params: {
    userId?: string;
    email?: string;
    eventType?: AuditEventType;
    startDate?: Date;
    endDate?: Date;
    success?: boolean;
    limit?: number;
  }): Promise<AuditLogEntry[]> {
    const { userId, email, eventType, startDate, endDate, success, limit = 100 } = params;

    const where: Prisma.AuditLogWhereInput = {};

    if (userId) where.userId = userId;
    if (email) where.email = email;
    if (eventType) where.eventType = eventType;
    if (success !== undefined) where.success = success;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Prisma.DateTimeFilter).gte = startDate;
      if (endDate) (where.createdAt as Prisma.DateTimeFilter).lte = endDate;
    }

    return prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get failed login attempts for an email
   */
  static async getFailedLoginAttempts(email: string, sinceMinutes: number = 60): Promise<number> {
    const since = new Date(Date.now() - sinceMinutes * 60 * 1000);

    const count = await prisma.auditLog.count({
      where: {
        email,
        eventType: AuditEventType.USER_LOGIN_FAILED,
        success: false,
        createdAt: { gte: since },
      },
    });

    return count;
  }

  /**
   * Check if account should be locked and lock it if necessary
   */
  static async checkAccountLockout(
    email: string,
    maxAttempts: number = 5,
    windowMinutes: number = 15
  ): Promise<boolean> {
    // First check if account is already locked
    const isAlreadyLocked = await this.isAccountLocked(email);
    if (isAlreadyLocked) {
      return true;
    }

    const attempts = await this.getFailedLoginAttempts(email, windowMinutes);

    if (attempts >= maxAttempts) {
      // Lock the account by updating the user record
      const lockUntil = new Date(Date.now() + 30 * 60 * 1000); // Lock for 30 minutes

      try {
        await prisma.user.updateMany({
          where: { email },
          data: {
            accountLockedUntil: lockUntil,
            failedLoginAttempts: attempts,
          },
        });

        // Log account lockout
        await this.log({
          email,
          eventType: AuditEventType.ACCOUNT_LOCKED,
          metadata: {
            failedAttempts: attempts,
            windowMinutes,
            lockedUntil: lockUntil.toISOString(),
          },
          success: true,
        });

        return true;
      } catch (error) {
        console.error('Failed to lock account:', error);
        return false;
      }
    }

    return false;
  }

  /**
   * Check if account is currently locked
   */
  static async isAccountLocked(email: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { accountLockedUntil: true },
    });

    if (!user?.accountLockedUntil) {
      return false;
    }

    // Check if lock has expired
    const now = new Date();
    if (user.accountLockedUntil <= now) {
      // Unlock the account automatically
      await this.unlockAccount(email);
      return false;
    }

    return true;
  }

  /**
   * Manually unlock an account
   */
  static async unlockAccount(email: string): Promise<void> {
    try {
      await prisma.user.updateMany({
        where: { email },
        data: {
          accountLockedUntil: null,
          failedLoginAttempts: 0,
        },
      });

      await this.log({
        email,
        eventType: AuditEventType.ACCOUNT_UNLOCKED,
        metadata: { unlockedAt: new Date().toISOString() },
        success: true,
      });
    } catch (error) {
      console.error('Failed to unlock account:', error);
    }
  }

  /**
   * Reset failed login attempts (called on successful login)
   */
  static async resetFailedLoginAttempts(email: string): Promise<void> {
    try {
      await prisma.user.updateMany({
        where: { email },
        data: {
          failedLoginAttempts: 0,
          accountLockedUntil: null,
        },
      });
    } catch (error) {
      console.error('Failed to reset failed login attempts:', error);
    }
  }

  /**
   * Clean up old audit logs
   */
  static async cleanup(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

    const result = await prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    console.log(`[AUDIT] Cleaned up ${result.count} old audit log entries`);
    return result.count;
  }

  /**
   * Get security summary for a user
   */
  static async getSecuritySummary(userId: string): Promise<{
    recentLogins: AuditLogEntry[];
    failedAttempts: AuditLogEntry[];
    securityEvents: AuditLogEntry[];
  }> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [recentLogins, failedAttempts, securityEvents] = await Promise.all([
      // Recent successful logins
      prisma.auditLog.findMany({
        where: {
          userId,
          eventType: {
            in: [AuditEventType.USER_LOGIN, AuditEventType.OAUTH_LOGIN],
          },
          success: true,
          createdAt: { gte: thirtyDaysAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),

      // Failed login attempts
      prisma.auditLog.findMany({
        where: {
          userId,
          eventType: AuditEventType.USER_LOGIN_FAILED,
          success: false,
          createdAt: { gte: thirtyDaysAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),

      // Security-related events
      prisma.auditLog.findMany({
        where: {
          userId,
          eventType: {
            in: [
              AuditEventType.PASSWORD_CHANGED,
              AuditEventType.TWO_FACTOR_ENABLED,
              AuditEventType.TWO_FACTOR_DISABLED,
              AuditEventType.ACCOUNT_LOCKED,
              AuditEventType.ACCOUNT_UNLOCKED,
            ],
          },
          createdAt: { gte: thirtyDaysAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    return { recentLogins, failedAttempts, securityEvents };
  }
}
