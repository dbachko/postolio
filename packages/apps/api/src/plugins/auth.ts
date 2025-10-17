import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
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

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Ensure JWT_SECRET is set - required in all environments
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error(
      'JWT_SECRET environment variable is required. ' +
        'Generate a secure secret using: openssl rand -hex 32'
    );
  }

  // Validate JWT_SECRET strength
  if (jwtSecret.length < 32) {
    throw new Error(
      'JWT_SECRET must be at least 32 characters long. ' +
        'Generate a secure secret using: openssl rand -hex 32'
    );
  }

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

  // Main authentication decorator
  fastify.decorate(
    'authenticate',
    async function (this: typeof fastify, request: FastifyRequest, reply: FastifyReply) {
      try {
        // Priority: HttpOnly cookie > Bearer token
        const cookieToken = request.cookies?.auth_token;
        const authHeader = request.headers.authorization;

        if (cookieToken) {
          // Verify cookie token
          request.user = await fastify.jwt.verify(cookieToken);
        } else if (authHeader && authHeader.startsWith('Bearer ')) {
          // Verify bearer token
          const token = authHeader.slice(7);
          request.user = await fastify.jwt.verify(token);
        } else {
          throw new Error('No authentication token provided');
        }

        // Validate required claims
        if (!request.user || !request.user.id || !request.user.email) {
          throw new Error('Invalid token payload: missing required fields');
        }

        // If a session id claim is present, ensure the session is active and not revoked
        if (request.user.sid) {
          const { SessionService } = await import('../services/session.service.js');
          const session = await SessionService.getSessionById(request.user.sid, request.user.id);
          if (!session) {
            return reply.code(401).send({
              error: 'Session revoked',
              code: 'SESSION_REVOKED',
            });
          }
        }
      } catch (err) {
        // Handle specific JWT errors
        const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
        if (errorMessage.includes('expired')) {
          return reply.code(401).send({
            error: 'Token expired',
            code: 'TOKEN_EXPIRED',
          });
        }
        if (errorMessage.includes('invalid') || errorMessage.includes('malformed')) {
          return reply.code(401).send({
            error: 'Invalid token',
            code: 'INVALID_TOKEN',
          });
        }

        // Generic authentication error
        return reply.code(401).send({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
    }
  );

  // Optional authentication decorator (doesn't fail if no token)
  fastify.decorate(
    'authenticateOptional',
    async function (this: typeof fastify, request: FastifyRequest) {
      try {
        const cookieToken = request.cookies?.auth_token;
        const authHeader = request.headers.authorization;

        if (cookieToken) {
          request.user = await fastify.jwt.verify(cookieToken);
        } else if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.slice(7);
          request.user = await fastify.jwt.verify(token);
        }

        // Validate if user exists
        if (request.user && (!request.user.id || !request.user.email)) {
          // Invalid payload, don't set user
          return;
        }
      } catch {
        // Silently fail for optional auth - don't set user
        return;
      }
    }
  );
};

// Export as a fastify plugin to ensure proper encapsulation
export default fp(authPlugin, {
  name: 'auth',
  dependencies: ['@fastify/cookie'],
});
