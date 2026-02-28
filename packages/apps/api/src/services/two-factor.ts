import { Prisma } from '@postolio/database';

import { getDatabaseClient } from '../config/database.js';
import { AuditLogger, AuditEventType } from './audit-logger.js';
import { EmailService } from './email.js';
import { createRedisClient } from './redis.js';
import {
  TWO_FACTOR_CODE_EXPIRY,
  generateBackupCodes,
  generateNumericCode,
  hashBackupCode,
  setupTwoFactorCore,
  verifyCodeCore,
  verifySetupCore,
} from './two-factor-core.js';

const prisma = getDatabaseClient();
const redis = createRedisClient();

export enum TwoFactorMethod {
  TOTP = 'totp',
  EMAIL = 'email',
  SMS = 'sms',
}

export class TwoFactorService {
  static async setupTwoFactor(
    userId: string,
    method: TwoFactorMethod,
    phoneNumber?: string
  ): Promise<{
    success: boolean;
    qrCode?: string;
    secret?: string;
    backupCodes?: string[];
    message?: string;
  }> {
    return setupTwoFactorCore({ userId, method, phoneNumber });
  }

  static async verifySetup(
    userId: string,
    code: string,
    ipAddress?: string
  ): Promise<{ success: boolean; message?: string }> {
    return verifySetupCore({ userId, code, ipAddress });
  }

  static async verifyCode(
    userId: string,
    code: string,
    trustDevice = false,
    ipAddress?: string
  ): Promise<{ success: boolean; trustedToken?: string; message?: string }> {
    return verifyCodeCore({ userId, code, trustDevice, ipAddress });
  }

  static async sendEmailCode(userId: string): Promise<{ success: boolean; message?: string }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          twoFactorMethod: true,
          twoFactorEnabled: true,
        },
      });

      if (!user?.twoFactorEnabled || user.twoFactorMethod !== TwoFactorMethod.EMAIL) {
        return {
          success: false,
          message: 'Email two-factor not enabled',
        };
      }

      const rateLimitKey = `2fa-email-rate:${userId}`;
      const attempts = await redis.incr(rateLimitKey);

      if (attempts === 1) {
        await redis.expire(rateLimitKey, 60 * 60);
      }

      if (attempts > 5) {
        return {
          success: false,
          message: 'Too many code requests. Please try again later.',
        };
      }

      const code = generateNumericCode();
      await redis.setex(`2fa-email-code:${userId}`, TWO_FACTOR_CODE_EXPIRY, code);

      const emailResult = await EmailService.sendTwoFactorCode(user.email, code);
      return {
        success: emailResult.success,
        message: emailResult.success
          ? 'Verification code sent to your email'
          : 'Failed to send verification code',
      };
    } catch (error) {
      console.error('Send email code error:', error);
      return {
        success: false,
        message: 'Failed to send verification code',
      };
    }
  }

  static async disableTwoFactor(
    userId: string,
    password: string,
    ipAddress?: string
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const bcrypt = await import('bcryptjs');
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { password: true, email: true },
      });

      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      const validPassword = await bcrypt.default.compare(password, user.password);
      if (!validPassword) {
        await AuditLogger.log({
          userId,
          email: user.email,
          eventType: AuditEventType.TWO_FACTOR_DISABLED,
          metadata: { reason: 'Invalid password', ipAddress },
          success: false,
        });

        return {
          success: false,
          message: 'Invalid password',
        };
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: false,
          twoFactorMethod: null,
          twoFactorSecret: null,
          twoFactorBackupCodes: Prisma.JsonNull,
          twoFactorPhoneNumber: null,
        },
      });

      await AuditLogger.log({
        userId,
        email: user.email,
        eventType: AuditEventType.TWO_FACTOR_DISABLED,
        metadata: { ipAddress },
        success: true,
      });

      return {
        success: true,
        message: 'Two-factor authentication disabled',
      };
    } catch (error) {
      console.error('Disable 2FA error:', error);
      return {
        success: false,
        message: 'Failed to disable two-factor authentication',
      };
    }
  }

  static async isTrustedDevice(token: string): Promise<string | null> {
    if (!token) {
      return null;
    }

    return redis.get(`trusted-device:${token}`);
  }

  static async regenerateBackupCodes(
    userId: string,
    password: string
  ): Promise<{
    success: boolean;
    backupCodes?: string[];
    message?: string;
  }> {
    try {
      const bcrypt = await import('bcryptjs');
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          password: true,
          twoFactorEnabled: true,
        },
      });

      if (!user?.twoFactorEnabled) {
        return {
          success: false,
          message: 'Two-factor authentication not enabled',
        };
      }

      const validPassword = await bcrypt.default.compare(password, user.password);
      if (!validPassword) {
        return {
          success: false,
          message: 'Invalid password',
        };
      }

      const backupCodes = generateBackupCodes();
      const hashedBackupCodes = await Promise.all(
        backupCodes.map((backupCode) => hashBackupCode(backupCode))
      );

      await prisma.user.update({
        where: { id: userId },
        data: { twoFactorBackupCodes: hashedBackupCodes },
      });

      return {
        success: true,
        backupCodes,
        message: 'Backup codes regenerated successfully',
      };
    } catch (error) {
      console.error('Regenerate backup codes error:', error);
      return {
        success: false,
        message: 'Failed to regenerate backup codes',
      };
    }
  }
}
