import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
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

type GetActiveSessionsFn = (userId: string) => Promise<Session[]>;

function formatDeviceName(session: Session): string {
  return session.deviceName || parseDeviceName(session.userAgent) || 'Unknown Device';
}

async function resolveCurrentSessionId(request: FastifyRequest): Promise<string | null> {
  let currentSessionId: string | null = request.user?.sid || null;
  if (currentSessionId) {
    return currentSessionId;
  }

  const refreshToken = request.cookies.refresh_token;
  if (!refreshToken) {
    return null;
  }
  const currentSession = await SessionService.findSessionByToken(refreshToken);
  currentSessionId = currentSession?.id || null;
  return currentSessionId;
}

async function resolveCurrentSessionScope(
  request: FastifyRequest,
  userId: string
): Promise<{ currentSessionId?: string; currentSessionHash?: string }> {
  const currentSessionId: string | undefined = request.user?.sid;
  let currentSessionHash: string | undefined;

  if (currentSessionId) {
    const current = await SessionService.getSessionById(currentSessionId, userId);
    currentSessionHash = current?.refreshTokenHash ?? undefined;
    return { currentSessionId, currentSessionHash };
  }

  const refreshToken = request.cookies.refresh_token;
  if (!refreshToken) {
    return {};
  }
  const currentSession = await SessionService.findSessionByToken(refreshToken);
  return {
    currentSessionId: currentSession?.id,
    currentSessionHash: currentSession?.refreshTokenHash ?? undefined,
  };
}

function createActiveSessionsLoader(fastify: FastifyInstance): GetActiveSessionsFn {
  return async (userId: string): Promise<Session[]> => {
    try {
      const tokens = await RefreshTokenService.getUserTokens(userId);
      const hashes = Array.from(new Set(tokens.map((t) => hashToken(t.token))));
      if (hashes.length === 0) {
        return await SessionService.getUserSessions(userId);
      }
      return await SessionService.getUserSessionsByRefreshTokenHashes(userId, hashes);
    } catch (error) {
      fastify.log.debug(
        { err: error },
        'Failed to load refresh tokens for session filtering; falling back to DB sessions'
      );
      return await SessionService.getUserSessions(userId);
    }
  };
}

function registerListSessionsRoute(
  fastify: FastifyInstance,
  getActiveSessions: GetActiveSessionsFn
) {
  fastify.get('/sessions', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const sessions = await getActiveSessions(userId);
      const currentSessionId = await resolveCurrentSessionId(request);
      const formattedSessions = sessions.map((session: Session) => ({
        id: session.id,
        deviceName: formatDeviceName(session),
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
      return reply.send({ sessions: formattedSessions, total: formattedSessions.length });
    } catch (error: unknown) {
      fastify.log.error(error, 'Error getting user sessions');
      return reply.code(500).send({ error: 'Failed to get sessions' });
    }
  });
}

function registerGetSessionRoute(fastify: FastifyInstance) {
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
            deviceName: formatDeviceName(session),
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
}

function registerRevokeSessionRoute(fastify: FastifyInstance) {
  fastify.post<{ Params: { id: string } }>(
    '/sessions/:id/revoke',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id } = request.params;
        const session = await SessionService.getSessionById(id, userId);
        if (!session) {
          return reply.code(404).send({ error: 'Session not found' });
        }
        const currentSessionId = await resolveCurrentSessionId(request);
        if (currentSessionId === id) {
          return reply
            .code(400)
            .send({ error: 'Cannot revoke current session. Use logout instead.' });
        }
        await SessionService.revokeSession(id, 'user_requested');
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
}

function registerRevokeAllRoute(fastify: FastifyInstance) {
  fastify.post(
    '/sessions/revoke-all',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { currentSessionId, currentSessionHash } = await resolveCurrentSessionScope(
          request,
          userId
        );
        await SessionService.revokeAllUserSessions(userId, currentSessionId);
        await RefreshTokenService.invalidateAllUserTokensExceptHash(userId, currentSessionHash);
        return reply.send({ success: true, message: 'All other sessions revoked successfully' });
      } catch (error: unknown) {
        fastify.log.error(error, 'Error revoking all sessions');
        return reply.code(500).send({ error: 'Failed to revoke sessions' });
      }
    }
  );
}

function registerUpdateDeviceNameRoute(fastify: FastifyInstance) {
  fastify.patch<{ Params: { id: string }; Body: UpdateDeviceNameInput }>(
    '/sessions/:id/device-name',
    { preHandler: [fastify.authenticate, validateAndSanitize(updateDeviceNameSchema)] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id } = request.params;
        const { deviceName } = request.body;
        const session = await SessionService.getSessionById(id, userId);
        if (!session) {
          return reply.code(404).send({ error: 'Session not found' });
        }
        const updatedSession = await SessionService.updateDeviceName(id, userId, deviceName);
        return reply.send({
          success: true,
          message: 'Device name updated successfully',
          session: { id: updatedSession.id, deviceName: updatedSession.deviceName },
        });
      } catch (error: unknown) {
        fastify.log.error(error, 'Error updating device name');
        return reply.code(500).send({ error: 'Failed to update device name' });
      }
    }
  );
}

async function buildSecuritySummary(userId: string, getActiveSessions: GetActiveSessionsFn) {
  const sessions = await getActiveSessions(userId);
  const mostRecentSession = sessions.sort(
    (a: Session, b: Session) => b.createdAt.getTime() - a.createdAt.getTime()
  )[0];

  const [passwordEvent, userForFallback, registerEvent, passwordLoginEvent] = await Promise.all([
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

  const passwordAuthEnabled = Boolean(passwordEvent || registerEvent || passwordLoginEvent);
  const lastPasswordChange = passwordAuthEnabled
    ? (passwordEvent?.createdAt || userForFallback?.createdAt || new Date()).toISOString()
    : null;

  const oauthProviders: string[] = [];
  if (userForFallback?.googleId) {
    oauthProviders.push('google');
  }
  if (userForFallback?.facebookId) {
    oauthProviders.push('facebook');
  }

  return {
    activeSessions: sessions.length,
    passwordAuthEnabled,
    lastPasswordChange,
    recentLogins: sessions.length,
    suspiciousActivity: 0,
    lastLogin: mostRecentSession
      ? {
          timestamp: mostRecentSession.createdAt,
          location: mostRecentSession.location,
          device: formatDeviceName(mostRecentSession),
        }
      : null,
    oauthProviders,
  };
}

function registerSecuritySummaryRoute(
  fastify: FastifyInstance,
  getActiveSessions: GetActiveSessionsFn
) {
  fastify.get(
    '/security/summary',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        return reply.send(await buildSecuritySummary(userId, getActiveSessions));
      } catch (error: unknown) {
        fastify.log.error(error, 'Error getting security summary');
        return reply.code(500).send({ error: 'Failed to get security summary' });
      }
    }
  );
}

async function loadActiveRefreshTokenHashes(userId: string, fastify: FastifyInstance) {
  try {
    const tokens = await RefreshTokenService.getUserTokens(userId);
    return {
      tokensLoaded: true,
      activeRefreshTokenHashes: new Set(tokens.map((t) => hashToken(t.token))),
    };
  } catch (error) {
    fastify.log.debug(
      { err: error },
      'Failed to load refresh tokens for login history status; falling back to DB status'
    );
    return { tokensLoaded: false, activeRefreshTokenHashes: new Set<string>() };
  }
}

function registerLoginHistoryRoute(fastify: FastifyInstance) {
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
        const { tokensLoaded, activeRefreshTokenHashes } = await loadActiveRefreshTokenHashes(
          userId,
          fastify
        );
        const now = new Date();
        const loginHistory = sessions.map((session: Session) => {
          const tokenPresent = tokensLoaded
            ? activeRefreshTokenHashes.has(session.refreshTokenHash)
            : true;
          const isActive = !session.revokedAt && session.expiresAt >= now && tokenPresent;
          let revokedReason: string | null = null;
          if (session.revokedAt) {
            revokedReason = session.revokedReason;
          } else if (!isActive) {
            revokedReason = 'expired';
          }
          return {
            timestamp: session.createdAt,
            device: formatDeviceName(session),
            location: session.location,
            ipAddress: session.ipAddress,
            status: isActive ? 'active' : 'revoked',
            revokedReason,
          };
        });
        return reply.send({ history: loginHistory, total: loginHistory.length });
      } catch (error: unknown) {
        fastify.log.error(error, 'Error getting login history');
        return reply.code(500).send({ error: 'Failed to get login history' });
      }
    }
  );
}

function registerSessionRoutes(fastify: FastifyInstance, getActiveSessions: GetActiveSessionsFn) {
  registerListSessionsRoute(fastify, getActiveSessions);
  registerGetSessionRoute(fastify);
  registerRevokeSessionRoute(fastify);
  registerRevokeAllRoute(fastify);
  registerUpdateDeviceNameRoute(fastify);
}

function registerSecurityRoutes(fastify: FastifyInstance, getActiveSessions: GetActiveSessionsFn) {
  registerSecuritySummaryRoute(fastify, getActiveSessions);
  registerLoginHistoryRoute(fastify);
}

const sessionsRoutes: FastifyPluginAsync = async (fastify) => {
  const getActiveSessions = createActiveSessionsLoader(fastify);
  registerSessionRoutes(fastify, getActiveSessions);
  registerSecurityRoutes(fastify, getActiveSessions);
};

export default sessionsRoutes;
