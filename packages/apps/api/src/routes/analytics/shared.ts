import type { FastifyReply, FastifyRequest } from 'fastify';

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export type AuthenticatedRequest = FastifyRequest & { user: AuthenticatedUser };

export function ensureAuth(
  request: FastifyRequest,
  reply: FastifyReply
): request is AuthenticatedRequest {
  if (!request.user?.id) {
    reply.code(401).send({ error: 'Authentication required' });
    return false;
  }
  return true;
}
