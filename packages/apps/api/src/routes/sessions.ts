import { FastifyPluginAsync } from 'fastify';
import { SessionService } from '../services/session.service.js';
import { prisma } from '../config/database.js';
import { z } from 'zod';
import { validateAndSanitize } from '../middleware/validation.js';
import type { Session } from '@postolio/database';
import { getClientIp } from '../utils/request-info.js';

// Request schemas
const updateDeviceNameSchema = z.object({
  deviceName: z.string().min(1).max(100),
});

type UpdateDeviceNameInput = z.infer<typeof updateDeviceNameSchema>;

const sessionsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get all active sessions for current user
  fastify.get('/sessions', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user!.id;

      const sessions = await SessionService.getUserSessions(userId);

      // Get current session ID from refresh token cookie
      const refreshToken = request.cookies.refresh_token;
      let currentSessionId: string | null = null;

      if (refreshToken) {
        const currentSession = await SessionService.findSessionByToken(refreshToken);
        currentSessionId = currentSession?.id || null;
      }

      // Fallback: when refresh cookie is path-scoped to /api/auth/refresh, it won't be
      // present on this endpoint. Try to infer current session by IP/User-Agent.
      if (!currentSessionId && sessions.length > 0) {
        const ua = request.headers['user-agent'];
        const ip = getClientIp(request);
        const match = sessions
          .filter(
            (s: Session) => (ua ? s.userAgent === ua : true) && (ip ? s.ipAddress === ip : true)
          )
          .sort(
            (a: Session, b: Session) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime()
          )[0];
        if (match) {
          currentSessionId = match.id;
        }
      }

      // Format sessions for frontend
      const formattedSessions = sessions.map((session: Session) => ({
        id: session.id,
        deviceName: session.deviceName || 'Unknown Device',
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
            deviceName: session.deviceName || 'Unknown Device',
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
        const refreshToken = request.cookies.refresh_token;
        let currentSessionId: string | undefined;

        if (refreshToken) {
          const currentSession = await SessionService.findSessionByToken(refreshToken);
          currentSessionId = currentSession?.id;
        }

        // Revoke all sessions except current
        await SessionService.revokeAllUserSessions(userId, currentSessionId);

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
        const sessions = await SessionService.getUserSessions(userId);

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
                device: mostRecentSession.deviceName || 'Unknown Device',
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

        const loginHistory = sessions.map((session: Session) => ({
          timestamp: session.createdAt,
          device: session.deviceName || 'Unknown Device',
          location: session.location,
          ipAddress: session.ipAddress,
          status: session.revokedAt ? 'revoked' : 'active',
          revokedReason: session.revokedReason,
        }));

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
