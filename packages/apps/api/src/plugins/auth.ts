import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import fp from 'fastify-plugin';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      id: string;
      email: string;
      sid?: string; // session id claim (added to access tokens)
      iat?: number; // issued at (for potential future invalidation checks)
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateOptional: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function assertJwtSecret(): string {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error(
      'JWT_SECRET environment variable is required. ' +
        'Generate a secure secret using: openssl rand -hex 32'
    );
  }
  if (jwtSecret.length < 32) {
    throw new Error(
      'JWT_SECRET must be at least 32 characters long. ' +
        'Generate a secure secret using: openssl rand -hex 32'
    );
  }
  return jwtSecret;
}

function selectAuthToken(request: FastifyRequest): string {
  const cookieToken = request.cookies?.auth_token;
  const authHeader = request.headers.authorization;
  if (cookieToken) {
    return cookieToken;
  }
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  throw new Error('No authentication token provided');
}

async function ensureSessionActiveIfPresent(request: FastifyRequest): Promise<boolean> {
  if (!request.user?.sid || !request.user?.id) {
    return true;
  }
  const { SessionService } = await import('../services/session.service.js');
  const session = await SessionService.getSessionById(request.user.sid, request.user.id);
  return Boolean(session);
}

function sendAuthError(reply: FastifyReply, error: unknown): FastifyReply {
  const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
  if (errorMessage.includes('expired')) {
    return reply.code(401).send({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
  }
  if (errorMessage.includes('invalid') || errorMessage.includes('malformed')) {
    return reply.code(401).send({ error: 'Invalid token', code: 'INVALID_TOKEN' });
  }
  return reply.code(401).send({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
}

function registerAuthenticateDecorator(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.decorate(
    'authenticate',
    async function (this: typeof fastify, request: FastifyRequest, reply: FastifyReply) {
      try {
        request.user = await fastify.jwt.verify(selectAuthToken(request));
        if (!request.user?.id || !request.user.email) {
          throw new Error('Invalid token payload: missing required fields');
        }

        const hasActiveSession = await ensureSessionActiveIfPresent(request);
        if (!hasActiveSession) {
          return reply.code(401).send({ error: 'Session revoked', code: 'SESSION_REVOKED' });
        }
      } catch (err) {
        return sendAuthError(reply, err);
      }
    }
  );
}

function registerAuthenticateOptionalDecorator(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.decorate(
    'authenticateOptional',
    async function (this: typeof fastify, request: FastifyRequest) {
      try {
        const bearer = request.headers.authorization;
        const token =
          request.cookies?.auth_token ||
          (bearer?.startsWith('Bearer ') ? bearer.slice(7) : undefined);
        if (!token) {
          return;
        }
        request.user = await fastify.jwt.verify(token);
        if (request.user && (!request.user.id || !request.user.email)) {
          return;
        }
      } catch {
        return;
      }
    }
  );
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const jwtSecret = assertJwtSecret();

  // Register JWT plugin with strict configuration
  await fastify.register(jwt, {
    secret: jwtSecret,
    sign: {
      algorithm: 'HS256',
      expiresIn: process.env.JWT_EXPIRES_IN || '1h', // Configurable expiry, default 1 hour
    },
    verify: {
      algorithms: ['HS256'], // Only accept HS256 algorithm
      clockTolerance: 30, // Allow 30 seconds of clock skew
    },
    cookie: {
      cookieName: 'auth_token',
      signed: false, // The JWT itself is signed
    },
  });

  registerAuthenticateDecorator(fastify);
  registerAuthenticateOptionalDecorator(fastify);
};

// Export as a fastify plugin to ensure proper encapsulation
export default fp(authPlugin, {
  name: 'auth',
  dependencies: ['@fastify/cookie'],
});
