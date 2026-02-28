import type { FastifyReply, FastifyRequest } from 'fastify';
import { isInboxEnabledForUser } from '../../utils/feature-flags.js';

export type AuthenticatedRequest = FastifyRequest & {
  user?: {
    id?: string;
    email?: string | null;
  };
};

export async function requireInboxFeature(request: AuthenticatedRequest, reply: FastifyReply) {
  const userId = request.user?.id ?? null;
  const email = request.user?.email ?? null;
  if (!isInboxEnabledForUser({ userId, email })) {
    return reply.code(403).send({
      error: 'feature_disabled',
      code: 'INBOX_DISABLED',
      message: 'Inbox is not enabled for this account',
    });
  }
}
