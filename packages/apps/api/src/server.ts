import './dotenv-init.js';
import { isProductionEnv } from './utils/env-mode.js';
import { createTrustProxy } from './utils/request-info.js';
import fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fs from 'fs';
import path from 'path';
import authPlugin from './plugins/auth.js';
import csrfProtection from '@fastify/csrf-protection';
import csrfAutoProtect from './plugins/csrf-auto-protect.js';
import monitoringPlugin from './plugins/monitoring.js';
import websocketPlugin from './plugins/websocket.js';
import { applyRateLimiting } from './middleware/rate-limit.js';
import { getRedisClient } from './services/redis.js';
import { registerApiRoutes } from './server/register-routes.js';
import { errorHandler } from './middleware/error-handler.js';
import { startServer } from './server/startup.js';

function loadHttpsOptions() {
  if (process.env.NODE_ENV !== 'dev' || process.env.CI) {
    return {};
  }

  try {
    const certPath =
      process.env.SSL_CERT_PATH || path.join(process.cwd(), 'certs', 'localhost.crt');
    const keyPath = process.env.SSL_KEY_PATH || path.join(process.cwd(), 'certs', 'localhost.key');

    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      return {};
    }

    return {
      https: {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      },
    };
  } catch {
    console.log('No SSL certificates found, running on HTTP');
    return {};
  }
}

function normalizeOrigin(value: string): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    const host = trimmed.replace(/\/+$/, '');
    const isLocal =
      host === 'localhost' ||
      host.startsWith('localhost:') ||
      host === '127.0.0.1' ||
      host.startsWith('127.0.0.1:') ||
      host === 'ai.localhost' ||
      host.startsWith('ai.localhost:') ||
      host.endsWith('.localhost');

    return `${isLocal ? 'http' : 'https'}://${host}`;
  }
}

function buildCorsOrigins() {
  const corsOrigins = new Set<string>([
    'http://ai.localhost:5173',
    'https://ai.localhost:5173',
    'https://ai.localhost',
    'https://localhost:5173',
    'https://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://postolio.example',
  ]);

  const addOrigin = (value: string | undefined) => {
    if (!value) {
      return;
    }
    const origin = normalizeOrigin(value);
    if (origin && origin !== '*') {
      corsOrigins.add(origin);
    }
  };

  addOrigin(process.env.APP_URL);
  addOrigin(process.env.FRONTEND_URL);
  addOrigin(process.env.CORS_ORIGIN);

  if (process.env.CORS_ORIGINS) {
    for (const raw of process.env.CORS_ORIGINS.split(',')) {
      addOrigin(raw);
    }
  }

  return Array.from(corsOrigins);
}

function registerCorePlugins(app: FastifyInstance) {
  app.register(cors, {
    origin: buildCorsOrigins(),
    credentials: true,
  });

  const cookieSecret = process.env.COOKIE_SECRET || process.env.JWT_SECRET;
  if (!cookieSecret) {
    throw new Error(
      'COOKIE_SECRET or JWT_SECRET environment variable is required for secure cookie signing. ' +
        'Please set one of these variables in your environment configuration.'
    );
  }

  app.register(cookie, {
    secret: cookieSecret,
    parseOptions: {},
  });

  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: [
          "'self'",
          'https://api.openai.com',
          'https://graph.facebook.com',
          'https://www.googleapis.com',
        ],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: isProductionEnv() ? [] : null,
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
  });

  app.register(monitoringPlugin as FastifyPluginAsync);
  app.register(authPlugin as FastifyPluginAsync);

  app.register(csrfProtection, {
    cookieOpts: {
      signed: true,
      httpOnly: true,
      secure: isProductionEnv(),
      sameSite: 'strict',
      path: '/',
    },
    cookieKey: '_csrf',
  });

  app.register(csrfAutoProtect as FastifyPluginAsync);
  app.register(websocketPlugin as FastifyPluginAsync);
}

function configureRateLimiting(app: FastifyInstance) {
  const rawRedis = getRedisClient();
  if (!rawRedis) {
    console.warn('Rate limiting disabled - Redis not available');
    return;
  }

  const redisAdapter = {
    multi() {
      const chain = rawRedis.multi();
      return {
        incr(key: string) {
          chain.incr(key);
          return this;
        },
        expire(key: string, seconds: number) {
          chain.expire(key, seconds);
          return this;
        },
        exec() {
          return chain.exec().then((res) => res || []);
        },
      };
    },
  };

  applyRateLimiting(app, redisAdapter);
  console.log('Rate limiting enabled with Redis backend');
}

function registerHealthRoutes(app: FastifyInstance, routePath: string) {
  app.route({
    method: 'GET',
    url: routePath,
    logLevel: 'silent',
    exposeHeadRoute: false,
    handler: async (_, reply) => {
      reply.header('cache-control', 'no-store');
      return { status: 'ok', timestamp: new Date().toISOString() };
    },
  });

  app.route({
    method: 'HEAD',
    url: routePath,
    logLevel: 'silent',
    handler: async (_, reply) => {
      reply.header('cache-control', 'no-store');
      reply.code(200);
    },
  });
}

export function buildFastify(): FastifyInstance {
  const app = fastify({
    logger: { level: 'info' },
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: createTrustProxy(),
    ...loadHttpsOptions(),
  });

  registerCorePlugins(app);
  configureRateLimiting(app);
  registerApiRoutes(app);
  registerHealthRoutes(app, '/health');
  registerHealthRoutes(app, '/api/health');
  app.setErrorHandler(errorHandler as any);

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void startServer(buildFastify);
}
