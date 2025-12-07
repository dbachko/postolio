import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { EmailService } from './email.js';
import { deletionQueueService } from './deletion-queue.js';
import { DELETION_RECOVERY_DELAY_MS } from './deletion-config.js';
import { createRedisClient } from './redis.js';

type DeletionSource = 'user' | 'meta' | 'legal';

type DeletionReasonId =
  | 'not_using'
  | 'too_expensive'
  | 'missing_features'
  | 'privacy_concerns'
  | 'switching_service'
  | 'other';

interface DeletionVerificationData {
  userId: string;
  email: string;
  source: DeletionSource;
  reason?: DeletionReasonId;
  createdAt: number;
}

interface SendVerificationParams {
  email: string;
  source: DeletionSource;
  reason?: DeletionReasonId;
}

interface ServiceResult {
  success: boolean;
  message?: string;
  error?: string;
  recoveryDeadline?: string;
}

const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export class DataDeletionRequestService {
  private static redis = createRedisClient();

  static async sendVerification(params: SendVerificationParams): Promise<ServiceResult> {
    const { email, source, reason } = params;

    try {
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return {
          success: false,
          error: 'No account found with this email address',
        };
      }

      const token = crypto.randomBytes(32).toString('hex');
      const key = `data-deletion:verify:${token}`;

      const payload: DeletionVerificationData = {
        userId: user.id,
        email: user.email,
        source,
        reason,
        createdAt: Date.now(),
      };

      await this.redis.setex(key, TOKEN_TTL_SECONDS, JSON.stringify(payload));

      const emailResult = await EmailService.sendDataDeletionVerificationEmail(user.email, token);

      if (!emailResult.success) {
        await this.redis.del(key);
        return {
          success: false,
          error:
            emailResult.error ||
            'Failed to send verification email. Please contact privacy@postolio.example.',
        };
      }

      return {
        success: true,
        message: 'Verification email sent. Please check your inbox.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        success: false,
        error: message,
      };
    }
  }

  static async verifyToken(token: string): Promise<ServiceResult> {
    try {
      const key = `data-deletion:verify:${token}`;
      const raw = await this.redis.get(key);

      if (!raw) {
        return {
          success: false,
          error: 'Invalid or expired deletion verification link',
        };
      }

      const data = JSON.parse(raw) as DeletionVerificationData;

      await this.redis.del(key);

      const user = await prisma.user.findUnique({
        where: { id: data.userId },
      });

      if (!user) {
        return {
          success: false,
          error: 'Account not found',
        };
      }

      const now = Date.now();
      const deletedAt = new Date(now);
      const scheduledDeletion = new Date(now + DELETION_RECOVERY_DELAY_MS);

      const reasonDescription = data.reason
        ? `Public data deletion request (${data.source})`
        : 'Public data deletion request';

      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          deletedAt,
          deletionReason: reasonDescription,
          scheduledDeletion,
        },
      });

      await deletionQueueService.scheduleDeletion(
        {
          userId: updatedUser.id,
          scheduledDeletionDate: scheduledDeletion,
          email: updatedUser.email,
        },
        Math.max(0, scheduledDeletion.getTime() - Date.now())
      );

      await EmailService.sendDeletionConfirmationImmediate(updatedUser.email, scheduledDeletion);

      return {
        success: true,
        message: 'Account scheduled for deletion',
        recoveryDeadline: scheduledDeletion.toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      return {
        success: false,
        error: message,
      };
    }
  }
}
