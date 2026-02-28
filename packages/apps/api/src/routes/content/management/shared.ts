import type { FastifyReply, FastifyRequest } from 'fastify';

import { getDatabaseClient } from '../../../config/database.js';

export const prisma: ReturnType<typeof getDatabaseClient> = getDatabaseClient();

export type AuthenticatedRequest = FastifyRequest & {
  user?: {
    id?: string;
    email?: string | null;
  };
};

export type DestinationAccount = {
  id: string;
  platform: string;
  metadata: unknown;
};

export function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return Boolean((metadata as { disconnected?: boolean }).disconnected);
}

export function sendMultiDestinationDisabled(reply: FastifyReply) {
  return reply.code(403).send({
    error: 'feature_disabled',
    code: 'MULTI_DESTINATION_DISABLED',
    message: 'Multiple destinations are not enabled for this account',
  });
}
