import crypto from 'node:crypto';
import dotenv from 'dotenv';
import fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import type { FastifyJWT } from '@fastify/jwt';
import { prismaAssets } from '@postolio/database-assets';
import assetsRoutes from './routes/assets.js';
import foldersRoutes from './routes/folders.js';
import campaignAssetsRoutes from './routes/campaign-assets.js';
import healthRoutes from './routes/health.js';
import { logger as sharedLogger } from '@postolio/logger';

// Load environment variables
dotenv.config();

const PORT = parseInt(process.env.ASSETS_API_PORT || '3002', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';
const serviceTokenFromEnv =
  process.env.ASSETS_SERVICE_TOKEN || process.env.SERVICE_API_TOKEN || process.env.SERVICE_TOKEN;
if (!serviceTokenFromEnv) {
  throw new Error(
    'ASSETS_SERVICE_TOKEN (or SERVICE_API_TOKEN / SERVICE_TOKEN) must be provided for internal authentication'
  );
}
const SERVICE_API_TOKEN = serviceTokenFromEnv;

export function buildFastify() {
  const fastifyLogger = sharedLogger.child({
    service: 'assets-api',
    environment: NODE_ENV,
  });

  const server = fastify({
    loggerInstance: fastifyLogger.toPino(),
    requestIdLogLabel: 'reqId',
    disableRequestLogging: false,
    requestIdHeader: 'x-request-id',
  });

  // Security headers
  server.register(helmet, {
    contentSecurityPolicy: false, // Allow Module Federation
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  // CORS - Allow main app to call assets API
  server.register(cors, {
    origin: (origin, cb) => {
      const envOrigins = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const allowedOrigins = [
        'https://ai.localhost:5173',
        'http://ai.localhost:5173',
        'https://ai.localhost',
        'https://localhost:5173',
        'http://localhost:5173',
        'https://127.0.0.1:5173',
        'http://127.0.0.1:5173',
        'http://localhost:5173',
        'https://postolio.example',
        ...envOrigins,
      ];

      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) {
        cb(null, true);
        return;
      }

      if (allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
  });

  // Cookie parsing
  server.register(cookie, {
    secret: JWT_SECRET,
  });

  // JWT authentication
  server.register(jwt, {
    secret: JWT_SECRET,
    verify: {
      algorithms: ['HS256'],
      clockTolerance: 30,
    },
    cookie: {
      // Align cookie name with main API so the browser sends the same auth cookie
      cookieName: 'auth_token',
      signed: false,
    },
  });

  // Authentication decorator
  server.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      const cookieToken = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies
        ?.auth_token;
      const header = request.headers['authorization'];
      const authHeader = Array.isArray(header) ? header[0] : header;
      type JwtUserPayload = FastifyJWT['user'];
      const verifyToken = (token: string) => server.jwt.verify<JwtUserPayload>(token);
      let decoded: JwtUserPayload | undefined;

      if (cookieToken) {
        decoded = await verifyToken(cookieToken);
      } else if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        decoded = await verifyToken(token);
      }

      if (!decoded) {
        throw new Error('No authentication token provided');
      }

      const normalizedUserId = decoded.userId || decoded.id;
      if (!normalizedUserId) {
        throw new Error('Invalid authentication payload: missing user id');
      }

      const rest = { ...decoded };
      delete rest.id;
      delete rest.userId;

      request.user = {
        ...rest,
        userId: normalizedUserId,
      };
    } catch (error) {
      request.log.warn({ err: error }, 'Authentication failed');
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  server.decorate(
    'authenticateService',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const headerValue =
        request.headers['x-postolio-service-token'] ||
        request.headers['x-service-token'] ||
        request.headers['x-internal-token'];
      const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      if (!token) {
        request.log.warn('Service authentication failed');
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }
      const provided = Buffer.from(token as string);
      const expected = Buffer.from(SERVICE_API_TOKEN);
      if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        request.log.warn('Service authentication failed');
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }
  );

  // Register routes
  server.register(healthRoutes);
  server.register(assetsRoutes, { prefix: '/assets-api/v1' });
  server.register(foldersRoutes, { prefix: '/assets-api/v1' });
  server.register(campaignAssetsRoutes, { prefix: '/assets-api/v1' });

  // Graceful shutdown
  const closeGracefully = async (signal: string) => {
    server.log.info(`Received ${signal}, closing server gracefully...`);
    await server.close();
    await prismaAssets.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => closeGracefully('SIGINT'));
  process.on('SIGTERM', () => closeGracefully('SIGTERM'));

  return server;
}

async function start() {
  const server = buildFastify();

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
    server.log.info(`🚀 Assets API server listening on port ${PORT}`);
    server.log.info(`Environment: ${NODE_ENV}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
