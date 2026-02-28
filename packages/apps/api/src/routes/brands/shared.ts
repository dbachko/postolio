import type { FastifyReply, FastifyRequest } from 'fastify';

import { getDatabaseClient } from '../../config/database.js';
import { isInboxEnabledForUser } from '../../utils/feature-flags.js';

export const prisma: ReturnType<typeof getDatabaseClient> = getDatabaseClient();

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

export function parseQueryList(value: string | string[] | undefined | null): string[] {
  if (!value) {
    return [];
  }
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return parts.map((entry) => String(entry || '').trim()).filter(Boolean);
}

export function parseBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, safe));
}
