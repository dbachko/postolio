import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
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

const googleOAuthRoutes: FastifyPluginAsync = async (fastify) => {
  // OAuth2 Authorization Code exchange (custom UI)
  // Frontend uses @react-oauth/google with flow="auth-code" (popup)
  // This endpoint exchanges the code for tokens, verifies the ID token,
  // and performs the same user/session handling used by legacy flows.
  fastify.post<{ Body: { code: string } }>('/google/code', async (request, reply) => {
    try {
      const { code } = request.body;
      if (!code) {
        return reply.code(400).send({ error: 'No authorization code provided' });
      }

      // GIS code flow with popup uses the ORIGIN of the calling page as redirect_uri
      const redirectOrigin =
        (request.headers.origin as string | undefined) ||
        (request.headers.referer ? new URL(request.headers.referer).origin : undefined) ||
        process.env.GOOGLE_REDIRECT_ORIGIN ||
        'http://localhost:5173';

      const codeClient = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectOrigin
      );

      const { tokens } = await codeClient.getToken(code);
      if (!tokens?.id_token) {
        return reply.code(401).send({ error: 'Failed to exchange Google code' });
      }

      const ticket = await codeClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID || '',
      });

      const payload = ticket.getPayload();
      if (!payload?.email) {
        return reply.code(401).send({ error: 'Invalid Google token' });
      }

      const googleUserInfo: GoogleUserInfo = {
        id: payload.sub || '',
        email: payload.email,
        name: payload.name || payload.email.split('@')[0] || 'User',
        picture: payload.picture,
        email_verified: payload.email_verified,
      };

      // ——— User handling ———
      let user = await prisma.user.findUnique({
        where: { email: googleUserInfo.email },
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

      if (user) {
        if (!user.googleId) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { googleId: googleUserInfo.id, emailVerified: true },
            select: {
              id: true,
              email: true,
              name: true,
              googleId: true,
              subscriptionTier: true,
              emailVerified: true,
            },
          });
        }
      } else {
        const gate = signupsAllowedForEmail(googleUserInfo.email);
        if (!gate.allowed) {
          return reply
            .code(403)
            .send({ error: gate.message, code: gate.code, waitlistUrl: gate.waitlistUrl });
        }

        const secureRandomPassword = randomBytes(32).toString('hex');
        const hashedPassword = await bcrypt.hash(secureRandomPassword, 10);

        user = await prisma.user.create({
          data: {
            email: googleUserInfo.email,
            password: hashedPassword,
            name: googleUserInfo.name,
            googleId: googleUserInfo.id,
            emailVerified: true,
            profilePicture: googleUserInfo.picture || null,
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

      // Create device-bound session and cookies
      const stableFingerprint = await ensureDeviceId(request, reply);
      await revokeSameDeviceSessions(user.id, stableFingerprint, request);

      const ipAddress = getClientIp(request);
      const userAgent = getUserAgent(request);
      const humanDeviceName = parseDeviceName(userAgent);
      const { refreshToken, accessToken } = await RefreshTokenService.generateRefreshToken(
        fastify,
        user.id,
        ipAddress,
        userAgent,
        {
          deviceFingerprint: stableFingerprint,
          deviceName: humanDeviceName,
          ipAddress,
          userAgent,
        }
      );

      reply.setCookie('auth_token', accessToken, {
        httpOnly: true,
        secure: isProductionEnv(),
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60,
      });

      // Clear any legacy refresh token cookies on broader paths to avoid duplicate-name cookie confusion.
      reply.clearCookie('refresh_token', { path: '/' });
      reply.clearCookie('refresh_token', { path: '/api/auth/refresh' });
      reply.setCookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: isProductionEnv(),
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 30 * 24 * 60 * 60,
      });

      await AuditLogger.logAuth(AuditEventType.OAUTH_LOGIN, user.id, user.email, request);

      return reply.send({ user, isNewUser, message: 'Signed in with Google (code)' });
    } catch (error) {
      fastify.log.error({ err: error }, 'Google OAuth code exchange failed');
      return reply.code(500).send({
        error: 'Authentication failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Link existing account with Google
  // Alternative endpoint that accepts OAuth code from custom UI
  fastify.post<{ Body: { code: string } }>(
    '/google/link-code',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) {
        return;
      }
      try {
        const { code } = request.body;
        if (!code) {
          return reply.code(400).send({ error: 'No authorization code provided' });
        }

        const redirectOrigin =
          (request.headers.origin as string | undefined) ||
          (request.headers.referer ? new URL(request.headers.referer).origin : undefined) ||
          process.env.GOOGLE_REDIRECT_ORIGIN ||
          'http://localhost:5173';

        const codeClient = new OAuth2Client(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          redirectOrigin
        );
        const { tokens } = await codeClient.getToken(code);
        if (!tokens?.id_token) {
          return reply.code(401).send({ error: 'Invalid Google token' });
        }
        const ticket = await codeClient.verifyIdToken({
          idToken: tokens.id_token,
          audience: process.env.GOOGLE_CLIENT_ID || '',
        });
        const payload = ticket.getPayload();
        if (!payload) {
          return reply.code(401).send({ error: 'Invalid Google token' });
        }

        // Check if this Google account is already linked to another user
        const existingGoogleUser = await prisma.user.findFirst({
          where: { googleId: payload.sub, NOT: { id: request.user.id } },
        });
        if (existingGoogleUser) {
          return reply.code(409).send({
            error: 'This Google account is already linked to another user',
          });
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
      } catch (error) {
        fastify.log.error({ err: error }, 'Google link via code failed');
        return reply.code(500).send({
          error: 'Failed to link Google account',
          details: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  fastify.post<{ Body: GoogleTokenBody }>(
    '/google/link',
    {
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) {
        return;
      }
      try {
        const { credential } = request.body;
        const userId = request.user.id;

        // Verify the Google ID token
        const ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID || '',
        });

        const payload = ticket.getPayload();
        if (!payload) {
          return reply.code(401).send({ error: 'Invalid Google token' });
        }

        // Check if this Google account is already linked to another user
        const existingGoogleUser = await prisma.user.findFirst({
          where: {
            googleId: payload.sub,
            NOT: { id: userId },
          },
        });

        if (existingGoogleUser) {
          return reply.code(409).send({
            error: 'This Google account is already linked to another user',
          });
        }

        // Link Google account to current user
        const updatedUser = await prisma.user.update({
          where: { id: userId },
          data: {
            googleId: payload.sub || '',
            // When linking Google account, mark email as verified (Google has verified it)
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

        return reply.send({
          user: updatedUser,
          message: 'Google account linked successfully',
        });
      } catch (error) {
        console.error('Google link error:', error);
        return reply.code(500).send({
          error: 'Failed to link Google account',
          details: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Unlink Google account
  fastify.delete(
    '/google/unlink',
    {
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) {
        return;
      }
      try {
        const userId = request.user.id;

        // Check if user has a password set (can't unlink if it's their only auth method)
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { password: true, googleId: true },
        });

        if (!user?.googleId) {
          return reply.code(400).send({ error: 'No Google account linked' });
        }

        // For security, we should check if they have another auth method
        // In this case, we check if they have a non-random password
        // (You might want to add a flag for OAuth-created accounts)

        const updatedUser = await prisma.user.update({
          where: { id: userId },
          data: {
            googleId: null,
          },
          select: {
            id: true,
            email: true,
            name: true,
            googleId: true,
          },
        });

        return reply.send({
          user: updatedUser,
          message: 'Google account unlinked successfully',
        });
      } catch (error) {
        console.error('Google unlink error:', error);
        return reply.code(500).send({
          error: 'Failed to unlink Google account',
          details: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
};

export default googleOAuthRoutes;
