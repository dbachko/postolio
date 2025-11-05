import dotenv from 'dotenv';
import fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { prismaAssets } from '@postolio/database-assets';
import assetsRoutes from './routes/assets.js';
import foldersRoutes from './routes/folders.js';
import campaignAssetsRoutes from './routes/campaign-assets.js';
import healthRoutes from './routes/health.js';
// Load environment variables
dotenv.config();
const PORT = parseInt(process.env.PORT || '3002', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';
export function buildFastify() {
  const server = fastify({
    logger: {
      level: NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        NODE_ENV !== 'production'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
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
    cookie: {
      cookieName: 'token',
      signed: false,
    },
  });
  // Authentication decorator
  server.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify({ onlyCookie: true });
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });
  // Register routes
  server.register(healthRoutes);
  server.register(assetsRoutes, { prefix: '/assets-api/v1' });
  server.register(foldersRoutes, { prefix: '/assets-api/v1' });
  server.register(campaignAssetsRoutes, { prefix: '/assets-api/v1' });
  // Graceful shutdown
  const closeGracefully = async (signal) => {
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
/* eslint-env node */
import process from 'node:process';
