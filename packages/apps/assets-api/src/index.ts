import crypto from 'node:crypto';
import dotenv from 'dotenv';
import fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt, { type FastifyJWT } from '@fastify/jwt';
import { prismaAssets, prismaAssetsPool } from '@postolio/database-assets';
import assetsRoutes from './routes/assets.js';
import taxonomyRoutes from './routes/taxonomy.js';
import healthRoutes from './routes/health.js';
import { logger as sharedLogger } from '@postolio/logger';

dotenv.config();

const PORT = parseInt(process.env.ASSETS_API_PORT || '3002', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';
const SERVICE_API_TOKEN = resolveServiceToken();

export function buildFastify(): FastifyInstance {
  const server = createServer();
  registerSecurityPlugins(server);
  registerAuthDecorators(server);
  registerRoutePlugins(server);
  registerShutdownHooks(server);
  return server;
}

function resolveServiceToken(): string {
  const token =
    process.env.ASSETS_SERVICE_TOKEN || process.env.SERVICE_API_TOKEN || process.env.SERVICE_TOKEN;
  if (!token) {
    throw new Error(
      'ASSETS_SERVICE_TOKEN (or SERVICE_API_TOKEN / SERVICE_TOKEN) must be provided for internal authentication'
    );
  }

  return token;
}

function createServer(): FastifyInstance {
  const fastifyLogger = sharedLogger.child({
    service: 'assets-api',
    environment: NODE_ENV,
  });

  const loggerInstance: FastifyBaseLogger = fastifyLogger.toPino();
  return fastify({
    loggerInstance,
    requestIdLogLabel: 'reqId',
    disableRequestLogging: false,
    requestIdHeader: 'x-request-id',
  });
}

function registerSecurityPlugins(server: FastifyInstance): void {
  server.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  server.register(cors, {
    origin: createCorsOriginChecker(),
    credentials: true,
  });

  server.register(cookie, { secret: JWT_SECRET });

  server.register(jwt, {
    secret: JWT_SECRET,
    verify: {
      algorithms: ['HS256'],
      clockTolerance: 30,
    },
    cookie: {
      cookieName: 'auth_token',
      signed: false,
    },
  });
}

function createCorsOriginChecker(): (
  origin: string | undefined,
  cb: (err: Error | null, allow: boolean) => void
) => void {
  const envOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
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

  return (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, true);
      return;
    }

    console.warn('[CORS] Rejected origin:', origin, 'Allowed:', allowedOrigins);
    cb(new Error('Not allowed by CORS'), false);
  };
}

function registerAuthDecorators(server: FastifyInstance): void {
  server.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    return authenticateRequest(server, request, reply);
  });

  server.decorate(
    'authenticateService',
    async function (request: FastifyRequest, reply: FastifyReply) {
      return authenticateServiceRequest(request, reply);
    }
  );
}

async function authenticateRequest(
  server: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const decoded = await decodeJwtUser(server, request);
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
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

async function decodeJwtUser(
  server: FastifyInstance,
  request: FastifyRequest
): Promise<FastifyJWT['user'] | undefined> {
  const cookieToken = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies
    ?.auth_token;
  const header = request.headers.authorization;
  const authHeader = Array.isArray(header) ? header[0] : header;
  const verifyToken = (token: string) => server.jwt.verify<FastifyJWT['user']>(token);

  if (cookieToken) {
    return verifyToken(cookieToken);
  }

  if (authHeader?.startsWith('Bearer ')) {
    return verifyToken(authHeader.slice(7));
  }

  return undefined;
}

function authenticateServiceRequest(request: FastifyRequest, reply: FastifyReply): void {
  const token = getServiceTokenFromHeaders(request.headers);
  if (!token) {
    request.log.warn('Service authentication failed');
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const provided = Buffer.from(token);
  const expected = Buffer.from(SERVICE_API_TOKEN);
  const isValidToken =
    provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

  if (!isValidToken) {
    request.log.warn('Service authentication failed');
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

function getServiceTokenFromHeaders(headers: FastifyRequest['headers']): string | null {
  const value =
    headers['x-postolio-service-token'] ||
    headers['x-service-token'] ||
    headers['x-internal-token'];
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] : value;
}

function registerRoutePlugins(server: FastifyInstance): void {
  server.register(healthRoutes);
  server.register(assetsRoutes, { prefix: '/assets-api/v1' });
  server.register(taxonomyRoutes, { prefix: '/assets-api/v1' });
}

function registerShutdownHooks(server: FastifyInstance): void {
  const closeGracefully = async (signal: string) => {
    server.log.info(`Received ${signal}, closing server gracefully...`);
    await server.close();
    await prismaAssets.$disconnect();
    await prismaAssetsPool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void closeGracefully('SIGINT');
  });

  process.on('SIGTERM', () => {
    void closeGracefully('SIGTERM');
  });
}

async function start(): Promise<void> {
  const server = buildFastify();

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
    server.log.info(`Assets API server listening on port ${PORT}`);
    server.log.info(`Environment: ${NODE_ENV}`);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void start();
}
