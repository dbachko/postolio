import type { FastifyInstance } from 'fastify';

import { prisma } from '../../config/database.js';
import { DELETION_RECOVERY_DELAY_MS } from '../../services/deletion-config.js';
import { deletionQueueService } from '../../services/deletion-queue.js';
import { EmailService } from '../../services/email.js';
import {
  DELETION_REASONS,
  type DeletionSurvey,
  isDeletionReason,
  logRouteError,
} from './shared.js';

function formatDeletionReason(payload: unknown): string | null {
  const body = payload as DeletionSurvey;
  if (!isDeletionReason(body.reason)) {
    return null;
  }

  const reasonLabel = DELETION_REASONS[body.reason];
  const feedback =
    typeof body.feedback === 'string' && body.feedback.trim().length > 0
      ? body.feedback.trim()
      : null;
  return feedback ? `${reasonLabel}: ${feedback}` : reasonLabel;
}

function getDeletionSchedule(): { deletedAt: Date; scheduledDeletion: Date } {
  const now = Date.now();
  return {
    deletedAt: new Date(now),
    scheduledDeletion: new Date(now + DELETION_RECOVERY_DELAY_MS),
  };
}

export function registerAccountDeleteRoute(fastify: FastifyInstance): void {
  fastify.delete('/account', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { deletedAt, scheduledDeletion } = getDeletionSchedule();
      const deletionReason = formatDeletionReason(request.body);

      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          deletedAt,
          deletionReason,
          scheduledDeletion,
        },
      });

      await deletionQueueService.scheduleDeletion(
        {
          userId,
          scheduledDeletionDate: scheduledDeletion,
          email: user.email,
        },
        Math.max(0, scheduledDeletion.getTime() - Date.now())
      );

      await EmailService.sendDeletionConfirmation(user.email, scheduledDeletion);

      return reply.send({
        success: true,
        message: 'Account scheduled for deletion',
        recoveryDeadline: scheduledDeletion.toISOString(),
      });
    } catch (error: unknown) {
      logRouteError(fastify.log, error, 'Account deletion error:');
      return reply.code(500).send({ error: 'Failed to delete account' });
    }
  });
}
