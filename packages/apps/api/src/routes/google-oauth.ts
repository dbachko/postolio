import type { FastifyPluginAsync, FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { isProductionEnv } from '../utils/env-mode.js';
import { getDatabaseClient } from '../config/database.js';
import { getClientIp, getUserAgent, parseDeviceName } from '../utils/request-info.js';
import { ensureDeviceId } from '../utils/device-id.js';
import { revokeSameDeviceSessions } from '../utils/session-dedup.js';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { RefreshTokenService } from '../services/refresh-token.js';
import { signupsAllowedForEmail } from '../utils/access-control.js';
import { AuditLogger, AuditEventType } from '../services/audit-logger.js';

const prisma = getDatabaseClient();

// Initialize Google OAuth2 client
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
);

interface GoogleTokenBody {
  credential: string; // The JWT token from Google
}

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture: string | undefined;
  email_verified: boolean | undefined;
}

function ensureAuth(
  request: FastifyRequest,
  reply: FastifyReply
): request is FastifyRequest & { user: { id: string; email?: string } } {
  if (!request.user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function resolveRedirectOrigin(request: FastifyRequest) {
  if (typeof request.headers.origin === 'string') {
    return request.headers.origin;
  }
  if (typeof request.headers.referer === 'string') {
    return new URL(request.headers.referer).origin;
  }
  return process.env.GOOGLE_REDIRECT_ORIGIN || 'http://localhost:5173';
}

function createGoogleCodeClient(redirectOrigin: string) {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectOrigin
  );
}

async function verifyGoogleCodePayload(request: FastifyRequest, code: string) {
  const codeClient = createGoogleCodeClient(resolveRedirectOrigin(request));
  const { tokens } = await codeClient.getToken(code);
  if (!tokens?.id_token) {
    return null;
  }
  const ticket = await codeClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID || '',
  });
  return ticket.getPayload();
}

async function issueAuthCookiesForUser(params: {
  fastify: FastifyInstance;
  request: FastifyRequest;
  reply: FastifyReply;
  userId: string;
}) {
  const stableFingerprint = await ensureDeviceId(params.request, params.reply);
  await revokeSameDeviceSessions(params.userId, stableFingerprint, params.request);

  const ipAddress = getClientIp(params.request);
  const userAgent = getUserAgent(params.request);
  const humanDeviceName = parseDeviceName(userAgent);
  const { refreshToken, accessToken } = await RefreshTokenService.generateRefreshToken(
    params.fastify,
    params.userId,
    ipAddress,
    userAgent,
    {
      deviceFingerprint: stableFingerprint,
      deviceName: humanDeviceName,
      ipAddress,
      userAgent,
    }
  );

  params.reply.setCookie('auth_token', accessToken, {
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60,
  });
  params.reply.clearCookie('refresh_token', { path: '/' });
  params.reply.clearCookie('refresh_token', { path: '/api/auth/refresh' });
  params.reply.setCookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60,
  });
}

async function findOrCreateGoogleUser(info: GoogleUserInfo, reply: FastifyReply) {
  let user = await prisma.user.findUnique({
    where: { email: info.email },
    select: {
      id: true,
      email: true,
      name: true,
      googleId: true,
      subscriptionTier: true,
      emailVerified: true,
    },
  });
  let isNewUser = false;

  if (user && !user.googleId) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { googleId: info.id, emailVerified: true },
      select: {
        id: true,
        email: true,
        name: true,
        googleId: true,
        subscriptionTier: true,
        emailVerified: true,
      },
    });
  } else if (!user) {
    const gate = signupsAllowedForEmail(info.email);
    if (!gate.allowed) {
      reply.code(403).send({ error: gate.message, code: gate.code, waitlistUrl: gate.waitlistUrl });
      return null;
    }

    const secureRandomPassword = randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(secureRandomPassword, 10);
    user = await prisma.user.create({
      data: {
        email: info.email,
        password: hashedPassword,
        name: info.name,
        googleId: info.id,
        emailVerified: true,
        profilePicture: info.picture || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        googleId: true,
        subscriptionTier: true,
        emailVerified: true,
      },
    });
    isNewUser = true;
  }

  return { user, isNewUser };
}

function createGoogleCodeSignInHandler(fastify: FastifyInstance) {
  return async (request: any, reply: any) => {
    try {
      const { code } = request.body as { code?: string };
      if (!code) {
        return reply.code(400).send({ error: 'No authorization code provided' });
      }
      const payload = await verifyGoogleCodePayload(request, code);
      if (!payload?.email) {
        return reply.code(401).send({ error: 'Invalid Google token' });
      }

      const userInfo: GoogleUserInfo = {
        id: payload.sub || '',
        email: payload.email,
        name: payload.name || payload.email.split('@')[0] || 'User',
        picture: payload.picture,
        email_verified: payload.email_verified,
      };
      const created = await findOrCreateGoogleUser(userInfo, reply);
      if (!created) {
        return;
      }

      await issueAuthCookiesForUser({
        fastify,
        request,
        reply,
        userId: created.user.id,
      });
      await AuditLogger.logAuth(
        AuditEventType.OAUTH_LOGIN,
        created.user.id,
        created.user.email,
        request
      );
      return reply.send({
        user: created.user,
        isNewUser: created.isNewUser,
        message: 'Signed in with Google (code)',
      });
    } catch (error: unknown) {
      fastify.log.error({ err: error }, 'Google OAuth code exchange failed');
      return reply.code(500).send({
        error: 'Authentication failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}

function createGoogleLinkCodeHandler(fastify: FastifyInstance) {
  return async (request: any, reply: any) => {
    if (!ensureAuth(request, reply)) {
      return;
    }
    try {
      const { code } = request.body as { code?: string };
      if (!code) {
        return reply.code(400).send({ error: 'No authorization code provided' });
      }
      const payload = await verifyGoogleCodePayload(request, code);
      if (!payload) {
        return reply.code(401).send({ error: 'Invalid Google token' });
      }

      const existingGoogleUser = await prisma.user.findFirst({
        where: { googleId: payload.sub, NOT: { id: request.user.id } },
      });
      if (existingGoogleUser) {
        return reply
          .code(409)
          .send({ error: 'This Google account is already linked to another user' });
      }

      const updatedUser = await prisma.user.update({
        where: { id: request.user.id },
        data: {
          googleId: payload.sub || '',
          emailVerified: true,
          profilePicture: payload.picture || null,
        },
        select: {
          id: true,
          email: true,
          name: true,
          googleId: true,
          emailVerified: true,
          profilePicture: true,
        },
      });
      return reply.send({ user: updatedUser, message: 'Google account linked successfully' });
    } catch (error: unknown) {
      fastify.log.error({ err: error }, 'Google link via code failed');
      return reply.code(500).send({
        error: 'Failed to link Google account',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}

function createGoogleLinkHandler() {
  return async (request: any, reply: any) => {
    if (!ensureAuth(request, reply)) {
      return;
    }
    try {
      const { credential } = request.body as GoogleTokenBody;
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID || '',
      });
      const payload = ticket.getPayload();
      if (!payload) {
        return reply.code(401).send({ error: 'Invalid Google token' });
      }

      const existingGoogleUser = await prisma.user.findFirst({
        where: { googleId: payload.sub, NOT: { id: request.user.id } },
      });
      if (existingGoogleUser) {
        return reply
          .code(409)
          .send({ error: 'This Google account is already linked to another user' });
      }

      const updatedUser = await prisma.user.update({
        where: { id: request.user.id },
        data: {
          googleId: payload.sub || '',
          emailVerified: true,
          profilePicture: payload.picture || null,
        },
        select: {
          id: true,
          email: true,
          name: true,
          googleId: true,
          emailVerified: true,
          profilePicture: true,
        },
      });
      return reply.send({ user: updatedUser, message: 'Google account linked successfully' });
    } catch (error: unknown) {
      return reply.code(500).send({
        error: 'Failed to link Google account',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}

function createGoogleUnlinkHandler() {
  return async (request: any, reply: any) => {
    if (!ensureAuth(request, reply)) {
      return;
    }
    try {
      const user = await prisma.user.findUnique({
        where: { id: request.user.id },
        select: { googleId: true },
      });
      if (!user?.googleId) {
        return reply.code(400).send({ error: 'No Google account linked' });
      }

      const updatedUser = await prisma.user.update({
        where: { id: request.user.id },
        data: { googleId: null },
        select: { id: true, email: true, name: true, googleId: true },
      });
      return reply.send({ user: updatedUser, message: 'Google account unlinked successfully' });
    } catch (error: unknown) {
      return reply.code(500).send({
        error: 'Failed to unlink Google account',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}

function registerGoogleCodeRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: { code: string } }>('/google/code', createGoogleCodeSignInHandler(fastify));
}

function registerGoogleLinkCodeRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: { code: string } }>(
    '/google/link-code',
    { preHandler: fastify.authenticate },
    createGoogleLinkCodeHandler(fastify)
  );
}

function registerGoogleLinkRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: GoogleTokenBody }>(
    '/google/link',
    { preHandler: fastify.authenticate },
    createGoogleLinkHandler()
  );
}

function registerGoogleUnlinkRoute(fastify: FastifyInstance) {
  fastify.delete(
    '/google/unlink',
    { preHandler: fastify.authenticate },
    createGoogleUnlinkHandler()
  );
}

const googleOAuthRoutes: FastifyPluginAsync = async (fastify) => {
  registerGoogleCodeRoute(fastify);
  registerGoogleLinkCodeRoute(fastify);
  registerGoogleLinkRoute(fastify);
  registerGoogleUnlinkRoute(fastify);
};

export default googleOAuthRoutes;
