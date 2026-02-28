import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import axios from 'axios';
import { isProductionEnv } from '../utils/env-mode.js';
import { RefreshTokenService } from '../services/refresh-token.js';
import { getClientIp, getUserAgent, parseDeviceName } from '../utils/request-info.js';
import { ensureDeviceId } from '../utils/device-id.js';
import { revokeSameDeviceSessions } from '../utils/session-dedup.js';
import { AuditLogger, AuditEventType } from '../services/audit-logger.js';

const prisma = getDatabaseClient();

// Centralize Facebook Graph API version for OAuth flows
const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
const fbGraph = (path: string) => `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

// Facebook App configuration
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
const FACEBOOK_REDIRECT_URI =
  process.env.FACEBOOK_OAUTH_REDIRECT_URI || 'http://localhost:3000/api/auth/facebook/callback';

interface FacebookTokenBody {
  code: string; // The authorization code from Facebook
  redirectUri?: string;
}

interface FacebookUserInfo {
  id: string;
  email?: string;
  name: string;
  picture?: {
    data: {
      url: string;
    };
  };
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

async function exchangeCodeForAccessToken(code: string, redirectUri: string) {
  const tokenResponse = await axios.get(fbGraph('oauth/access_token'), {
    params: {
      client_id: FACEBOOK_APP_ID,
      client_secret: FACEBOOK_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    },
  });
  return tokenResponse.data?.access_token as string | undefined;
}

async function fetchFacebookUser(accessToken: string, fields: string) {
  const userResponse = await axios.get(fbGraph('me'), {
    params: {
      fields,
      access_token: accessToken,
    },
  });
  return userResponse.data as FacebookUserInfo;
}

async function findOrCreateFacebookUser(fbUserInfo: FacebookUserInfo) {
  const email = fbUserInfo.email || `${fbUserInfo.id}@facebook.local`;
  let user = await prisma.user.findFirst({
    where: { OR: [{ email }, { facebookId: fbUserInfo.id }] },
    select: {
      id: true,
      email: true,
      name: true,
      facebookId: true,
      subscriptionTier: true,
      emailVerified: true,
    },
  });
  let isNewUser = false;

  if (user && !user.facebookId) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        facebookId: fbUserInfo.id,
        profilePicture: fbUserInfo.picture?.data?.url || null,
        ...(fbUserInfo.email && { emailVerified: true }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        facebookId: true,
        subscriptionTier: true,
        emailVerified: true,
      },
    });
  } else if (!user) {
    const secureRandomPassword = randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(secureRandomPassword, 10);
    user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: fbUserInfo.name,
        facebookId: fbUserInfo.id,
        profilePicture: fbUserInfo.picture?.data?.url || null,
        emailVerified: !!fbUserInfo.email,
        subscriptionTier: 'free',
      },
      select: {
        id: true,
        email: true,
        name: true,
        facebookId: true,
        subscriptionTier: true,
        emailVerified: true,
      },
    });
    isNewUser = true;
  }

  return { user, isNewUser };
}

async function issueSessionCookies(params: {
  fastify: any;
  request: any;
  reply: any;
  userId: string;
}) {
  const stableFingerprint = ensureDeviceId(params.request, params.reply);
  if (stableFingerprint) {
    await revokeSameDeviceSessions(params.userId, stableFingerprint, params.request);
  }
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

function sendFacebookAuthError(reply: FastifyReply, error: unknown, fallbackMessage: string) {
  if (axios.isAxiosError(error)) {
    const fbError = error.response?.data?.error;
    if (fbError) {
      return reply
        .code(400)
        .send({ error: fallbackMessage, details: fbError.message || 'Unknown Facebook error' });
    }
  }
  return reply.code(500).send({
    error: fallbackMessage,
    details: error instanceof Error ? error.message : 'Unknown error',
  });
}

function createFacebookCallbackHandler(fastify: any) {
  return async (request: any, reply: any) => {
    try {
      const { code, redirectUri = FACEBOOK_REDIRECT_URI } = request.body as FacebookTokenBody;
      if (!code) {
        return reply.code(400).send({ error: 'No authorization code provided' });
      }
      const accessToken = await exchangeCodeForAccessToken(code, redirectUri);
      if (!accessToken) {
        return reply.code(401).send({ error: 'Failed to get access token from Facebook' });
      }

      const fbUserInfo = await fetchFacebookUser(accessToken, 'id,email,name,picture');
      const { user, isNewUser } = await findOrCreateFacebookUser(fbUserInfo);
      await issueSessionCookies({ fastify, request, reply, userId: user.id });
      await AuditLogger.logAuth(AuditEventType.OAUTH_LOGIN, user.id, user.email, request);
      return reply.send({ user, isNewUser, message: 'Signed in with Facebook' });
    } catch (error: unknown) {
      return sendFacebookAuthError(reply, error, 'Authentication failed');
    }
  };
}

function createFacebookLinkHandler() {
  return async (request: any, reply: any) => {
    if (!ensureAuth(request, reply)) {
      return;
    }
    try {
      const { code, redirectUri = FACEBOOK_REDIRECT_URI } = request.body as FacebookTokenBody;
      const accessToken = await exchangeCodeForAccessToken(code, redirectUri);
      const fbUserInfo = await fetchFacebookUser(String(accessToken || ''), 'id,picture');
      const existingFacebookUser = await prisma.user.findFirst({
        where: { facebookId: fbUserInfo.id, NOT: { id: request.user.id } },
      });
      if (existingFacebookUser) {
        return reply
          .code(409)
          .send({ error: 'This Facebook account is already linked to another user' });
      }
      const updatedUser = await prisma.user.update({
        where: { id: request.user.id },
        data: {
          facebookId: fbUserInfo.id,
          profilePicture: fbUserInfo.picture?.data?.url || null,
        },
        select: {
          id: true,
          email: true,
          name: true,
          facebookId: true,
          profilePicture: true,
        },
      });
      return reply.send({ user: updatedUser, message: 'Facebook account linked successfully' });
    } catch (error: unknown) {
      return sendFacebookAuthError(reply, error, 'Failed to link Facebook account');
    }
  };
}

function createFacebookUnlinkHandler() {
  return async (request: any, reply: any) => {
    if (!ensureAuth(request, reply)) {
      return;
    }
    try {
      const user = await prisma.user.findUnique({
        where: { id: request.user.id },
        select: { facebookId: true },
      });
      if (!user?.facebookId) {
        return reply.code(400).send({ error: 'No Facebook account linked' });
      }
      const updatedUser = await prisma.user.update({
        where: { id: request.user.id },
        data: { facebookId: null },
        select: { id: true, email: true, name: true, facebookId: true },
      });
      return reply.send({ user: updatedUser, message: 'Facebook account unlinked successfully' });
    } catch (error: unknown) {
      return reply.code(500).send({
        error: 'Failed to unlink Facebook account',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}

async function facebookLoginUrlHandler(_request: FastifyRequest, reply: FastifyReply) {
  const params = new URLSearchParams({
    client_id: FACEBOOK_APP_ID,
    redirect_uri: FACEBOOK_REDIRECT_URI,
    scope: 'email,public_profile',
    response_type: 'code',
    auth_type: 'rerequest',
    display: 'popup',
  });
  return reply.send({ url: `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}` });
}

const facebookOAuthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: FacebookTokenBody }>(
    '/facebook/callback',
    createFacebookCallbackHandler(fastify)
  );
  fastify.post<{ Body: FacebookTokenBody }>(
    '/facebook/link',
    { preHandler: fastify.authenticate },
    createFacebookLinkHandler()
  );
  fastify.delete(
    '/facebook/unlink',
    { preHandler: fastify.authenticate },
    createFacebookUnlinkHandler()
  );
  fastify.get('/facebook/login-url', facebookLoginUrlHandler);
};

export default facebookOAuthRoutes;
