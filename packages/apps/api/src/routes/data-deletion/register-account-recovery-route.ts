import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';

import { prisma } from '../../config/database.js';
import { logRouteError } from './shared.js';

type RecoveryRequestBody = {
  email?: string;
  password?: string;
};

function hasRecoveryCredentials(
  body: RecoveryRequestBody
): body is { email: string; password: string } {
  return typeof body.email === 'string' && typeof body.password === 'string';
}

export function registerAccountRecoveryRoute(fastify: FastifyInstance): void {
  fastify.post('/account-recovery', async (request, reply) => {
    const body = (request.body ?? {}) as RecoveryRequestBody;
    if (!hasRecoveryCredentials(body)) {
      return reply.code(400).send({ error: 'Email and password are required' });
    }

    try {
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (!user?.deletedAt) {
        return reply.code(404).send({ error: 'No deleted account found' });
      }

      const now = new Date();
      if (user.scheduledDeletion && now > user.scheduledDeletion) {
        return reply.code(410).send({
          error: 'Recovery period has expired. Account has been permanently deleted.',
        });
      }

      const passwordHash = user.password;
      const isPasswordValid =
        typeof passwordHash === 'string' && (await bcrypt.compare(body.password, passwordHash));
      if (!isPasswordValid) {
        return reply.code(401).send({ error: 'Invalid password' });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { deletedAt: null, deletionReason: null, scheduledDeletion: null },
      });

      return reply.send({ success: true, message: 'Account successfully recovered' });
    } catch (error: unknown) {
      logRouteError(fastify.log, error, 'Account recovery error:');
      return reply.code(500).send({ error: 'Failed to recover account' });
    }
  });
}
