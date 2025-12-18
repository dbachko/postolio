import { FastifyPluginAsync } from 'fastify';
import { SessionService } from '../services/session.service.js';
import { RefreshTokenService } from '../services/refresh-token.js';
import { prisma } from '../config/database.js';
import { z } from 'zod';
import { validateAndSanitize } from '../middleware/validation.js';
import type { Session } from '@postolio/database';
import { parseDeviceName } from '../utils/request-info.js';
import { createHash } from 'crypto';

// Request schemas
const updateDeviceNameSchema = z.object({
  deviceName: z.string().min(1).max(100),
});

type UpdateDeviceNameInput = z.infer<typeof updateDeviceNameSchema>;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const sessionsRoutes: FastifyPluginAsync = async (fastify) => {
  const getActiveSessions = async (userId: string): Promise<Session[]> => {
    try {
      const tokens = await RefreshTokenService.getUserTokens(userId);
      const hashes = Array.from(new Set(tokens.map((t) => hashToken(t.token))));
      if (hashes.length === 0) return await SessionService.getUserSessions(userId);
      return await SessionService.getUserSessionsByRefreshTokenHashes(userId, hashes);
    } catch (error) {
      fastify.log.debug(
        { err: error },
        'Failed to load refresh tokens for session filtering; falling back to DB sessions'
      );
      return await SessionService.getUserSessions(userId);
    }
  };

  // Get all active sessions for current user
  fastify.get('/sessions', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user!.id;

      const sessions = await getActiveSessions(userId);

      // Primary: session id claim from the access token
      let currentSessionId: string | null = request.user?.sid || null;

      // Fallback: try refresh token cookie (may be path-scoped and absent here)
      if (!currentSessionId) {
        const refreshToken = request.cookies.refresh_token;
        if (refreshToken) {
          const currentSession = await SessionService.findSessionByToken(refreshToken);
          currentSessionId = currentSession?.id || null;
        }
      }

      // Format sessions for frontend
      const formattedSessions = sessions.map((session: Session) => ({
        id: session.id,
        deviceName: session.deviceName || parseDeviceName(session.userAgent) || 'Unknown Device',
        deviceFingerprint: session.deviceFingerprint,
        ipAddress: session.ipAddress,
        location: session.location,
        userAgent: session.userAgent,
        lastActivityAt: session.lastActivityAt,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        isCurrent: session.id === currentSessionId,
        trusted: session.trusted,
        trustedUntil: session.trustedUntil,
      }));

      return reply.send({
        sessions: formattedSessions,
        total: formattedSessions.length,
      });
    } catch (error: unknown) {
      fastify.log.error(error, 'Error getting user sessions');
      return reply.code(500).send({ error: 'Failed to get sessions' });
    }
  });

  // Get specific session by ID
  fastify.get<{ Params: { id: string } }>(
    '/sessions/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id } = request.params;

        const session = await SessionService.getSessionById(id, userId);

        if (!session) {
          return reply.code(404).send({ error: 'Session not found' });
        }

        return reply.send({
          session: {
            id: session.id,
            deviceName:
              session.deviceName || parseDeviceName(session.userAgent) || 'Unknown Device',
            deviceFingerprint: session.deviceFingerprint,
            ipAddress: session.ipAddress,
            location: session.location,
            userAgent: session.userAgent,
            lastActivityAt: session.lastActivityAt,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            trusted: session.trusted,
            trustedUntil: session.trustedUntil,
          },
        });
      } catch (error: unknown) {
        fastify.log.error(error, 'Error getting session');
        return reply.code(500).send({ error: 'Failed to get session' });
      }
    }
  );

  // Revoke specific session
  fastify.post<{ Params: { id: string } }>(
    '/sessions/:id/revoke',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id } = request.params;

        // Verify session belongs to user
        const session = await SessionService.getSessionById(id, userId);

        if (!session) {
          return reply.code(404).send({ error: 'Session not found' });
        }

        // Check if this is the current session
        if (request.user?.sid === id) {
          return reply
            .code(400)
            .send({ error: 'Cannot revoke current session. Use logout instead.' });
        }
        // Fallback to refresh cookie when an older token is missing sid
        const refreshToken = request.cookies.refresh_token;
        if (refreshToken) {
          const currentSession = await SessionService.findSessionByToken(refreshToken);
          if (currentSession?.id === id) {
            return reply
              .code(400)
              .send({ error: 'Cannot revoke current session. Use logout instead.' });
          }
        }

        // Revoke the session
        await SessionService.revokeSession(id, 'user_requested');

        // Invalidate the associated refresh token so it can't be used to rotate
        if (session.refreshTokenHash) {
          await RefreshTokenService.invalidateSessionTokenByHash(userId, session.refreshTokenHash);
        }

        return reply.send({
          success: true,
          message: 'Session revoked successfully',
          sessionId: id,
        });
      } catch (error: unknown) {
        fastify.log.error(error, 'Error revoking session');
        return reply.code(500).send({ error: 'Failed to revoke session' });
      }
    }
  );

  // Revoke all other sessions (keep current one)
  fastify.post(
    '/sessions/revoke-all',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        // Get current session ID
        let currentSessionId: string | undefined = request.user?.sid;
        let currentSessionHash: string | undefined;

        if (currentSessionId) {
          const current = await SessionService.getSessionById(currentSessionId, userId);
          currentSessionHash = current?.refreshTokenHash ?? undefined;
        } else {
          // Fallback to refresh cookie if an older token is missing sid
          const refreshToken = request.cookies.refresh_token;
          if (refreshToken) {
            const currentSession = await SessionService.findSessionByToken(refreshToken);
            currentSessionId = currentSession?.id;
            currentSessionHash = currentSession?.refreshTokenHash ?? undefined;
          }
        }

        // Revoke all sessions except current
        await SessionService.revokeAllUserSessions(userId, currentSessionId);

        // Invalidate all refresh tokens except possibly current one
        await RefreshTokenService.invalidateAllUserTokensExceptHash(userId, currentSessionHash);

        return reply.send({
          success: true,
          message: 'All other sessions revoked successfully',
        });
      } catch (error: unknown) {
        fastify.log.error(error, 'Error revoking all sessions');
        return reply.code(500).send({ error: 'Failed to revoke sessions' });
      }
    }
  );

  // Update device name for a session
  fastify.patch<{ Params: { id: string }; Body: UpdateDeviceNameInput }>(
    '/sessions/:id/device-name',
    { preHandler: [fastify.authenticate, validateAndSanitize(updateDeviceNameSchema)] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id } = request.params;
        const { deviceName } = request.body;

        // Verify session belongs to user
        const session = await SessionService.getSessionById(id, userId);

        if (!session) {
          return reply.code(404).send({ error: 'Session not found' });
        }

        // Update device name
        const updatedSession = await SessionService.updateDeviceName(id, userId, deviceName);

        return reply.send({
          success: true,
          message: 'Device name updated successfully',
          session: {
            id: updatedSession.id,
            deviceName: updatedSession.deviceName,
          },
        });
      } catch (error: unknown) {
        fastify.log.error(error, 'Error updating device name');
        return reply.code(500).send({ error: 'Failed to update device name' });
      }
    }
  );

  // Get security summary
  fastify.get(
    '/security/summary',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        // Get active sessions
        const sessions = await getActiveSessions(userId);

        // Find most recent login
        const mostRecentSession = sessions.sort(
          (a: Session, b: Session) => b.createdAt.getTime() - a.createdAt.getTime()
        )[0];

        // Determine last password change and whether local password auth is enabled
        const [passwordEvent, userForFallback, registerEvent, passwordLoginEvent] =
          await Promise.all([
            prisma.auditLog.findFirst({
              where: {
                userId,
                success: true,
                eventType: { in: ['PASSWORD_CHANGED', 'PASSWORD_RESET_COMPLETED'] },
              },
              orderBy: { createdAt: 'desc' },
            }),
            prisma.user.findUnique({
              where: { id: userId },
              select: { createdAt: true, googleId: true, facebookId: true },
            }),
            prisma.auditLog.findFirst({
              where: { userId, eventType: 'USER_REGISTER', success: true },
              orderBy: { createdAt: 'asc' },
            }),
            prisma.auditLog.findFirst({
              where: { userId, eventType: 'USER_LOGIN', success: true },
              orderBy: { createdAt: 'desc' },
            }),
          ]);

        // Heuristic: local password auth considered enabled if user ever registered with password,
        // logged in with password, or changed/reset their password
        const passwordAuthEnabled = Boolean(passwordEvent || registerEvent || passwordLoginEvent);

        const lastPasswordChange = passwordAuthEnabled
          ? (passwordEvent?.createdAt || userForFallback?.createdAt || new Date()).toISOString()
          : null;

        const oauthProviders: string[] = [];
        if (userForFallback?.googleId) oauthProviders.push('google');
        if (userForFallback?.facebookId) oauthProviders.push('facebook');

        return reply.send({
          activeSessions: sessions.length,
          passwordAuthEnabled,
          lastPasswordChange,
          recentLogins: sessions.length,
          suspiciousActivity: 0, // Placeholder for future detection
          lastLogin: mostRecentSession
            ? {
                timestamp: mostRecentSession.createdAt,
                location: mostRecentSession.location,
                device:
                  mostRecentSession.deviceName ||
                  parseDeviceName(mostRecentSession.userAgent) ||
                  'Unknown Device',
              }
            : null,
          oauthProviders,
        });
      } catch (error: unknown) {
        fastify.log.error(error, 'Error getting security summary');
        return reply.code(500).send({ error: 'Failed to get security summary' });
      }
    }
  );

  // Get login history (last 10 sessions, including revoked)
  fastify.get(
    '/security/login-history',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const sessions = await prisma.session.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });

        let tokensLoaded = false;
        let activeRefreshTokenHashes = new Set<string>();
        try {
          const tokens = await RefreshTokenService.getUserTokens(userId);
          tokensLoaded = true;
          activeRefreshTokenHashes = new Set(tokens.map((t) => hashToken(t.token)));
        } catch (error) {
          fastify.log.debug(
            { err: error },
            'Failed to load refresh tokens for login history status; falling back to DB status'
          );
        }

        const now = new Date();
        const loginHistory = sessions.map((session: Session) => {
          const tokenPresent = tokensLoaded
            ? activeRefreshTokenHashes.has(session.refreshTokenHash)
            : true;
          const isActive = !session.revokedAt && session.expiresAt >= now && tokenPresent;

          return {
            timestamp: session.createdAt,
            device: session.deviceName || parseDeviceName(session.userAgent) || 'Unknown Device',
            location: session.location,
            ipAddress: session.ipAddress,
            status: isActive ? 'active' : 'revoked',
            revokedReason: session.revokedAt ? session.revokedReason : isActive ? null : 'expired',
          };
        });

        return reply.send({
          history: loginHistory,
          total: loginHistory.length,
        });
      } catch (error: unknown) {
        fastify.log.error(error, 'Error getting login history');
        return reply.code(500).send({ error: 'Failed to get login history' });
      }
    }
  );
};

export default sessionsRoutes;
