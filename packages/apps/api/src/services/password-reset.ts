import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { getDatabaseClient } from '../config/database.js';
import { EmailService } from './email.js';
import { AuditLogger, AuditEventType } from './audit-logger.js';
import { RefreshTokenService } from './refresh-token.js';
import { createRedisClient } from './redis.js';

const prisma = getDatabaseClient();
const redis = createRedisClient();

function logInfo(message: string): void {
  process.stdout.write(`${message}\n`);
}

interface PasswordResetData {
  userId: string;
  email: string;
  createdAt: number;
}

export class PasswordResetService {
  private static readonly TOKEN_EXPIRY = 60 * 60; // 1 hour in seconds
  private static readonly RATE_LIMIT_WINDOW = 60 * 60; // 1 hour in seconds
  private static readonly MAX_ATTEMPTS = 3; // Max reset attempts per hour

  /**
   * Request a password reset
   */
  static async requestReset(
    email: string,
    ipAddress?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Normalize email
      email = email.toLowerCase().trim();

      // Check rate limiting
      const rateLimitKey = `password-reset-rate:${email}`;
      const attempts = await redis.incr(rateLimitKey);

      if (attempts === 1) {
        await redis.expire(rateLimitKey, this.RATE_LIMIT_WINDOW);
      }

      if (attempts > this.MAX_ATTEMPTS) {
        return {
          success: false,
          message: 'Too many password reset attempts. Please try again later.',
        };
      }

      // Find user
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, name: true },
      });

      // Always return success for security (don't reveal if email exists)
      if (!user) {
        logInfo(`Password reset requested for non-existent email: ${email}`);
        return {
          success: true,
          message: 'If an account exists with this email, a password reset link has been sent.',
        };
      }

      // Check if there's an existing valid token
      const existingTokenKey = `password-reset-by-user:${user.id}`;
      const existingToken = await redis.get(existingTokenKey);

      if (existingToken) {
        // Token already exists and is still valid
        logInfo(`Password reset token already exists for user: ${user.id}`);
        return {
          success: true,
          message: 'A password reset link has already been sent. Please check your email.',
        };
      }

      // Generate new token
      const token = nanoid(32);
      const resetKey = `password-reset:${token}`;
      const userKey = `password-reset-by-user:${user.id}`;

      // Store token data
      const resetData: PasswordResetData = {
        userId: user.id,
        email: user.email,
        createdAt: Date.now(),
      };

      // Store both token->data and userId->token mappings
      await Promise.all([
        redis.setex(resetKey, this.TOKEN_EXPIRY, JSON.stringify(resetData)),
        redis.setex(userKey, this.TOKEN_EXPIRY, token),
      ]);

      // Send reset email
      const emailResult = await EmailService.sendPasswordResetEmail(user.email, token);

      if (!emailResult.success) {
        // Clean up tokens if email fails
        await Promise.all([redis.del(resetKey), redis.del(userKey)]);
        throw new Error(emailResult.error || 'Failed to send email');
      }

      // Log password reset request
      await AuditLogger.log({
        userId: user.id,
        email: user.email,
        eventType: AuditEventType.PASSWORD_RESET_REQUESTED,
        metadata: { ipAddress },
        success: true,
      });

      return {
        success: true,
        message: 'Password reset link sent! Check your email to continue.',
      };
    } catch (error) {
      console.error('Password reset request error:', error);
      return {
        success: false,
        message: 'Failed to process password reset request. Please try again.',
      };
    }
  }

  /**
   * Verify reset token and update password
   */
  static async resetPassword(
    token: string,
    newPassword: string,
    ipAddress?: string
  ): Promise<{
    success: boolean;
    message: string;
    userId?: string;
  }> {
    try {
      const resetKey = `password-reset:${token}`;
      const data = await redis.get(resetKey);

      if (!data) {
        return {
          success: false,
          message: 'Invalid or expired password reset link',
        };
      }

      const resetData: PasswordResetData = JSON.parse(data);

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update user password
      await prisma.user.update({
        where: { id: resetData.userId },
        data: {
          password: hashedPassword,
          // Optionally invalidate all existing sessions
          // sessionVersion: { increment: 1 }
        },
      });

      // Invalidate all refresh tokens (logout from all devices)
      await RefreshTokenService.invalidateAllUserTokens(resetData.userId);

      // Delete all reset tokens for this user
      const userKey = `password-reset-by-user:${resetData.userId}`;
      await Promise.all([redis.del(resetKey), redis.del(userKey)]);

      // Clear rate limit after successful reset
      const rateLimitKey = `password-reset-rate:${resetData.email}`;
      await redis.del(rateLimitKey);

      // Log successful password reset
      await AuditLogger.log({
        userId: resetData.userId,
        email: resetData.email,
        eventType: AuditEventType.PASSWORD_RESET_COMPLETED,
        metadata: { ipAddress },
        success: true,
      });

      return {
        success: true,
        message: 'Password has been reset successfully!',
        userId: resetData.userId,
      };
    } catch (error) {
      console.error('Password reset error:', error);

      // Log failed password reset attempt
      await AuditLogger.log({
        eventType: AuditEventType.PASSWORD_RESET_COMPLETED,
        metadata: { token: `${token.substring(0, 8)}...`, ipAddress },
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        message: 'Failed to reset password. Please try again.',
      };
    }
  }

  /**
   * Validate reset token without using it
   */
  static async validateToken(token: string): Promise<{
    valid: boolean;
    email?: string;
  }> {
    try {
      const resetKey = `password-reset:${token}`;
      const data = await redis.get(resetKey);

      if (!data) {
        return { valid: false };
      }

      const resetData: PasswordResetData = JSON.parse(data);
      return {
        valid: true,
        email: resetData.email,
      };
    } catch (error) {
      console.error('Token validation error:', error);
      return { valid: false };
    }
  }

  /**
   * Cancel password reset request
   */
  static async cancelReset(userId: string): Promise<void> {
    try {
      const userKey = `password-reset-by-user:${userId}`;
      const token = await redis.get(userKey);

      if (token) {
        const resetKey = `password-reset:${token}`;
        await Promise.all([redis.del(resetKey), redis.del(userKey)]);
      }
    } catch (error) {
      console.error('Cancel reset error:', error);
    }
  }

  /**
   * Check if email service is configured
   */
  static isConfigured(): boolean {
    return EmailService.isConfigured();
  }
}
