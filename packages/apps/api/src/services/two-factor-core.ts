import { randomBytes } from 'crypto';

import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

import { getDatabaseClient } from '../config/database.js';
import { AuditLogger, AuditEventType } from './audit-logger.js';
import { EmailService } from './email.js';
import { createRedisClient } from './redis.js';

const prisma = getDatabaseClient();
const redis = createRedisClient();

export const TWO_FACTOR_CODE_EXPIRY = 5 * 60;
const MAX_ATTEMPTS = 3;
const BACKUP_CODE_COUNT = 10;

type SetupMethod = 'totp' | 'email' | 'sms';

type SetupMethodResult = {
  success: boolean;
  qrCode?: string;
  secret?: string;
  message?: string;
};

function isSetupMethod(method: unknown): method is SetupMethod {
  return method === 'totp' || method === 'email' || method === 'sms';
}

async function setupTOTP(userId: string): Promise<SetupMethodResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

  const secret = speakeasy.generateSecret({
    name: `Postolio (${user?.email})`,
    issuer: 'Postolio',
    length: 32,
  });

  const otpauthUrl = speakeasy.otpauthURL({
    secret: secret.base32,
    label: user?.email || 'user',
    issuer: 'Postolio',
    encoding: 'base32',
  });

  const qrCode = await QRCode.toDataURL(otpauthUrl);
  return { success: true, qrCode, secret: secret.base32 };
}

async function setupEmail(userId: string, email: string): Promise<SetupMethodResult> {
  const code = generateNumericCode();
  await redis.setex(`2fa-email-code:${userId}`, TWO_FACTOR_CODE_EXPIRY, code);

  const emailResult = await EmailService.sendTwoFactorCode(email, code);
  if (!emailResult.success) {
    throw new Error('Failed to send verification code');
  }

  return { success: true, message: 'Verification code sent to your email' };
}

async function setupSMS(): Promise<SetupMethodResult> {
  return { success: false, message: 'SMS authentication not yet implemented' };
}

export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let index = 0; index < BACKUP_CODE_COUNT; index += 1) {
    codes.push(randomBytes(5).toString('hex').toUpperCase());
  }
  return codes;
}

export async function hashBackupCode(code: string): Promise<string> {
  const crypto = await import('crypto');
  return crypto.default.createHash('sha256').update(code.toUpperCase()).digest('hex');
}

export function generateNumericCode(): string {
  const bytes = randomBytes(4);
  const code = (bytes.readUInt32BE(0) % 900000) + 100000;
  return code.toString();
}

async function verifySetupCode(userId: string, code: string, method: SetupMethod, secret?: string) {
  if (method === 'totp') {
    if (!secret) {
      return false;
    }

    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code,
      window: 2,
    });
  }

  if (method === 'email') {
    const storedCode = await redis.get(`2fa-email-code:${userId}`);
    return storedCode === code;
  }

  return false;
}

async function incrementSetupAttempts(userId: string): Promise<number> {
  const attemptsKey = `2fa-setup-attempts:${userId}`;
  const attempts = await redis.incr(attemptsKey);
  await redis.expire(attemptsKey, 60 * 5);
  return attempts;
}

async function cleanupSetupKeys(userId: string): Promise<void> {
  await redis.del(`2fa-setup:${userId}`);
  await redis.del(`2fa-setup-attempts:${userId}`);
  await redis.del(`2fa-email-code:${userId}`);
}

export async function setupTwoFactorCore(options: {
  userId: string;
  method: string;
  phoneNumber?: string;
}): Promise<{
  success: boolean;
  qrCode?: string;
  secret?: string;
  backupCodes?: string[];
  message?: string;
}> {
  try {
    const existing = await prisma.user.findUnique({
      where: { id: options.userId },
      select: { twoFactorEnabled: true, email: true },
    });

    if (existing?.twoFactorEnabled) {
      return { success: false, message: 'Two-factor authentication is already enabled' };
    }
    if (!isSetupMethod(options.method)) {
      return { success: false, message: 'Invalid two-factor method' };
    }

    let result: SetupMethodResult = { success: true };
    if (options.method === 'totp') {
      result = await setupTOTP(options.userId);
    } else if (options.method === 'email') {
      if (!existing?.email) {
        return { success: false, message: 'User email not found for email 2FA' };
      }
      result = await setupEmail(options.userId, existing.email);
    } else {
      if (!options.phoneNumber) {
        return { success: false, message: 'Phone number is required for SMS authentication' };
      }
      result = await setupSMS();
    }

    const backupCodes = generateBackupCodes();
    const hashedBackupCodes = await Promise.all(backupCodes.map((code) => hashBackupCode(code)));

    await redis.setex(
      `2fa-setup:${options.userId}`,
      60 * 30,
      JSON.stringify({
        method: options.method,
        secret: result.secret,
        backupCodes: hashedBackupCodes,
        phoneNumber: options.phoneNumber,
      })
    );

    return { ...result, backupCodes };
  } catch (error) {
    console.error('2FA setup error:', error);
    return { success: false, message: 'Failed to setup two-factor authentication' };
  }
}

export async function verifySetupCore(options: {
  userId: string;
  code: string;
  ipAddress?: string;
}): Promise<{ success: boolean; message?: string }> {
  try {
    const setupData = await redis.get(`2fa-setup:${options.userId}`);
    if (!setupData) {
      return { success: false, message: 'Setup session expired. Please start over.' };
    }

    const setup = JSON.parse(setupData) as {
      method: SetupMethod;
      secret?: string;
      backupCodes?: string[];
      phoneNumber?: string;
    };

    const verified = await verifySetupCode(
      options.userId,
      options.code,
      setup.method,
      setup.secret
    );
    if (!verified) {
      const attempts = await incrementSetupAttempts(options.userId);
      if (attempts >= MAX_ATTEMPTS) {
        await redis.del(`2fa-setup:${options.userId}`);
        return { success: false, message: 'Too many failed attempts. Setup cancelled.' };
      }

      return { success: false, message: 'Invalid verification code' };
    }

    await prisma.user.update({
      where: { id: options.userId },
      data: {
        twoFactorEnabled: true,
        twoFactorMethod: setup.method,
        twoFactorSecret: setup.secret,
        twoFactorBackupCodes: setup.backupCodes,
        twoFactorPhoneNumber: setup.phoneNumber,
      },
    });

    await cleanupSetupKeys(options.userId);

    await AuditLogger.log({
      userId: options.userId,
      eventType: AuditEventType.TWO_FACTOR_ENABLED,
      metadata: { method: setup.method, ipAddress: options.ipAddress },
      success: true,
    });

    return { success: true, message: 'Two-factor authentication enabled successfully' };
  } catch (error) {
    console.error('2FA verification error:', error);
    return { success: false, message: 'Failed to verify two-factor authentication' };
  }
}

async function verifyLoginCode(options: {
  userId: string;
  code: string;
  method: string | null;
  secret: string | null;
}): Promise<boolean> {
  if (options.method === 'totp' && options.secret) {
    return speakeasy.totp.verify({
      secret: options.secret,
      encoding: 'base32',
      token: options.code,
      window: 2,
    });
  }

  if (options.method === 'email') {
    const storedCode = await redis.get(`2fa-email-code:${options.userId}`);
    const verified = storedCode === options.code;
    if (verified) {
      await redis.del(`2fa-email-code:${options.userId}`);
    }
    return verified;
  }

  return false;
}

async function consumeBackupCodeIfValid(options: {
  userId: string;
  code: string;
  backupCodes: string[] | null;
}): Promise<boolean> {
  if (!options.backupCodes || options.code.length !== 10) {
    return false;
  }

  const hashedCode = await hashBackupCode(options.code);
  if (!options.backupCodes.includes(hashedCode)) {
    return false;
  }

  await prisma.user.update({
    where: { id: options.userId },
    data: { twoFactorBackupCodes: options.backupCodes.filter((code) => code !== hashedCode) },
  });

  return true;
}

export async function verifyCodeCore(options: {
  userId: string;
  code: string;
  trustDevice?: boolean;
  ipAddress?: string;
}): Promise<{ success: boolean; trustedToken?: string; message?: string }> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: options.userId },
      select: {
        twoFactorEnabled: true,
        twoFactorMethod: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
      },
    });

    if (!user?.twoFactorEnabled) {
      return { success: true, message: 'Two-factor not enabled' };
    }

    const backupCodes = Array.isArray(user.twoFactorBackupCodes)
      ? (user.twoFactorBackupCodes as string[])
      : null;

    let verified = await consumeBackupCodeIfValid({
      userId: options.userId,
      code: options.code,
      backupCodes,
    });

    if (!verified) {
      verified = await verifyLoginCode({
        userId: options.userId,
        code: options.code,
        method: user.twoFactorMethod,
        secret: user.twoFactorSecret,
      });
    }

    if (!verified) {
      await AuditLogger.log({
        userId: options.userId,
        eventType: AuditEventType.TWO_FACTOR_FAILED,
        metadata: { method: user.twoFactorMethod, ipAddress: options.ipAddress },
        success: false,
      });

      return { success: false, message: 'Invalid verification code' };
    }

    let trustedToken: string | undefined;
    if (options.trustDevice) {
      trustedToken = randomBytes(32).toString('hex');
      await redis.setex(`trusted-device:${trustedToken}`, 30 * 24 * 60 * 60, options.userId);
    }

    await AuditLogger.log({
      userId: options.userId,
      eventType: AuditEventType.TWO_FACTOR_VERIFIED,
      metadata: {
        method: user.twoFactorMethod,
        trustDevice: Boolean(options.trustDevice),
        ipAddress: options.ipAddress,
      },
      success: true,
    });

    return {
      success: true,
      ...(trustedToken ? { trustedToken } : {}),
      message: 'Two-factor authentication verified',
    };
  } catch (error) {
    console.error('2FA code verification error:', error);
    return { success: false, message: 'Failed to verify code' };
  }
}
