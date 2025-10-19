import type { FastifyRequest } from 'fastify';
import { prisma } from '../config/database.js';
import { RefreshTokenService } from '../services/refresh-token.js';
import { SessionService } from '../services/session.service.js';

/**
 * Revoke any active sessions for the given user/device fingerprint
 * and invalidate corresponding refresh tokens.
 */
export async function revokeSameDeviceSessions(
  userId: string,
  deviceFingerprint: string,
  request: FastifyRequest
): Promise<void> {
  const existingSessions = await prisma.session.findMany({
    where: {
      userId,
      deviceFingerprint,
      revokedAt: null,
      expiresAt: { gte: new Date() },
    },
    select: { id: true, refreshTokenHash: true },
  });

  for (const s of existingSessions) {
    try {
      await RefreshTokenService.invalidateSessionTokenByHash(userId, s.refreshTokenHash);
    } catch (err) {
      request.log.debug({ err, sessionId: s.id }, 'Token invalidation by hash failed');
    }
    try {
      await SessionService.revokeSession(s.id, 'relogin_same_device');
    } catch (err) {
      request.log.debug({ err, sessionId: s.id }, 'Session revoke failed');
    }
  }
}
