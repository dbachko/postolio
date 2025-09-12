import './dotenv-init.js';
import { validateEnvironment } from './config/validation.js';
import fastify, { FastifyInstance, FastifyPluginAsync } from 'fastify';
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
import authRoutes from './routes/auth.js';
import csrfRoutes from './routes/csrf.js';
import googleOAuthRoutes from './routes/google-oauth.js';
import facebookOAuthRoutes from './routes/facebook-oauth.js';
import magicLinkRoutes from './routes/magic-link.js';
import emailVerificationRoutes from './routes/email-verification.js';
import passwordResetRoutes from './routes/password-reset.js';
import twoFactorRoutes from './routes/two-factor.js';
import monitoringRoutes from './routes/monitoring.js';
import instagramOAuthRoutes from './routes/instagram-oauth.js';
import brandsRoutes from './routes/brands.js';
import contentRoutes from './routes/content.js';
import instagramRoutes from './routes/instagram.js';
import analyticsRoutes from './routes/analytics.js';
import instagramAnalyticsRoutes from './routes/instagram-analytics.js';
import engagementRoutes from './routes/engagement.js';
import growthRoutes from './routes/growth.js';
import aiRoutes from './routes/ai.js';
import autopilotRoutes from './routes/autopilot.js';
import campaignRoutes from './routes/campaign.js';
import campaignAnalyticsRoutes from './routes/campaign-analytics.js';
import rollingContentRoutes from './routes/rolling-content.js';
import legalRoutes from './routes/legal.js';
import userRoutes from './routes/user.js';
import dataDeletionRoutes from './routes/data-deletion.js';
import { complianceRoutes } from './routes/compliance.js';
import postDetailRoutes from './routes/post-detail.js';
import configRoutes from './routes/config.js';
import backgroundJobsRoutes from './routes/background-jobs.js';
import { ensureDatabaseSchema } from './config/database-setup.js';
import { getRetentionManager } from './services/retention-manager.js';
import Redis from 'ioredis';
import { getRedisUrl } from './utils/redis-url.js';
import { StatusBroadcaster } from './services/status-broadcaster.js';
import { schedulerAdapter } from './services/scheduler-adapter.js';
import { applyRateLimiting } from './middleware/rate-limit.js';
import { getRedisClient } from './services/redis.js';
import { backgroundJobs } from './services/background-jobs.js';

export function buildFastify(): FastifyInstance {
  // HTTPS configuration for local development
  let httpsOptions = {};

  // Only use HTTPS in development if not in CI
  if (process.env.NODE_ENV === 'development' && !process.env.CI) {
    try {
      // Look for local SSL certificates
      const certPath =
        process.env.SSL_CERT_PATH || path.join(process.cwd(), 'certs', 'localhost.crt');
      const keyPath =
        process.env.SSL_KEY_PATH || path.join(process.cwd(), 'certs', 'localhost.key');

      if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        httpsOptions = {
          https: {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath),
          },
        };
      }
    } catch {
      console.log('No SSL certificates found, running on HTTP');
    }
  }

  const app = fastify({
    logger: {
      level: 'info',
    },
    bodyLimit: 10 * 1024 * 1024, // 10MB limit - industry standard for social media management tools
    ...httpsOptions,
  });

  // Register plugins
  // CORS configuration for same-origin setup
  const corsOrigins = [
    // Local development origins
    'http://ai.localhost:5173',
    'https://ai.localhost:5173',
    'https://ai.localhost',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    // Production same-domain origin (postolio.example)
    'https://postolio.example',
  ];

  // Add CloudFront domain for backward compatibility
  if (process.env.CORS_ORIGIN) {
    corsOrigins.push(`https://${process.env.CORS_ORIGIN}`);
  }

  app.register(cors, {
    origin: corsOrigins,
    credentials: true,
  });
  app.register(cookie, {
    secret:
      process.env.COOKIE_SECRET || process.env.JWT_SECRET || 'default-secret-change-in-production',
    parseOptions: {},
  });
  // Security headers with helmet
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Required for React development
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: [
          "'self'",
          'https://api.openai.com',
          'https://graph.facebook.com',
          'https://www.googleapis.com',
        ],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
  });
  app.register(monitoringPlugin as FastifyPluginAsync);
  app.register(authPlugin as FastifyPluginAsync);

  // Register CSRF protection with secure cookie configuration
  app.register(csrfProtection, {
    cookieOpts: {
      signed: true,
      httpOnly: true, // Secure: Frontend gets token from API, not cookie
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    },
    cookieKey: '_csrf',
  });

  // Auto-protect all state-changing routes with CSRF
  app.register(csrfAutoProtect as FastifyPluginAsync);

  app.register(websocketPlugin as FastifyPluginAsync);

  // Apply rate limiting middleware
  const rawRedis = getRedisClient();
  if (rawRedis) {
    // Lightweight adapter to satisfy RedisLikeClient expected by rate limiter
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
  } else {
    console.warn('Rate limiting disabled - Redis not available');
  }

  // Register routes WITH /api prefix - CloudFront forwards full paths to backend
  app.register(monitoringRoutes, { prefix: '/api/monitoring' });
  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(csrfRoutes, { prefix: '/api' });
  app.register(googleOAuthRoutes, { prefix: '/api/auth' });
  app.register(facebookOAuthRoutes, { prefix: '/api/auth' });
  app.register(magicLinkRoutes, { prefix: '/api/auth' });
  app.register(emailVerificationRoutes, { prefix: '/api/auth' });
  app.register(passwordResetRoutes, { prefix: '/api/auth' });
  app.register(twoFactorRoutes, { prefix: '/api/auth' });
  app.register(userRoutes); // User routes include their own /api prefix
  app.register(instagramOAuthRoutes, { prefix: '/api/auth/instagram' });
  app.register(brandsRoutes, { prefix: '/api/brands' });
  app.register(contentRoutes, { prefix: '/api/content' });
  app.register(instagramRoutes, { prefix: '/api/instagram' });
  app.register(analyticsRoutes, { prefix: '/api/analytics' });
  app.register(instagramAnalyticsRoutes, {
    prefix: '/api/instagram-analytics',
  });
  app.register(engagementRoutes, { prefix: '/api/engagement' });
  app.register(growthRoutes, { prefix: '/api/growth' });
  app.register(aiRoutes, { prefix: '/api/ai' });
  app.register(autopilotRoutes, { prefix: '/api/autopilot' });
  app.register(campaignRoutes, { prefix: '/api/campaign' });
  app.register(campaignAnalyticsRoutes, { prefix: '/api/' }); // API root level for campaign analytics
  app.register(rollingContentRoutes, { prefix: '/api/rolling-content' });
  app.register(legalRoutes, { prefix: '/api/legal' });
  app.register(dataDeletionRoutes, { prefix: '/api/legal' });
  app.register(complianceRoutes);
  app.register(postDetailRoutes); // Post detail routes don't need prefix, they include /api
  app.register(configRoutes); // Config routes include their own /api prefix
  app.register(backgroundJobsRoutes); // Background job monitoring routes

  // Health check endpoint for both load balancer health checks and API requests
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });
  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  return app;
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildFastify();
  let redis: Redis | null = null;

  // Graceful shutdown handling
  const signals = ['SIGTERM', 'SIGINT'];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      app.log.warn(`Received ${signal}, starting graceful shutdown...`);
      try {
        // Shutdown background job queue
        await backgroundJobs.shutdown();
        app.log.info('Background job queue shut down');

        // Close Redis connection
        if (redis) {
          await redis.quit();
          app.log.info('Redis connection closed');
        }

        // Close server
        await app.close();
        app.log.info('Server closed successfully');
        process.exit(0);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        app.log.error({ message }, 'Error during shutdown:');
        process.exit(1);
      }
    });
  });

  app.listen({ port: 3000, host: '0.0.0.0' }, async (err, address) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    app.log.info(`Server listening at ${address}`);

    // Validate environment configuration at startup
    try {
      validateEnvironment();
    } catch (envError: unknown) {
      const message = envError instanceof Error ? envError.message : 'An unknown error occurred';
      app.log.error({ message }, '❌ Environment validation failed:');
      process.exit(1);
    }

    // Ensure database schema is ready before starting background services
    try {
      app.log.info('🚀 Initializing database schema...');
      await ensureDatabaseSchema();

      // Background services now managed by EventBridge
      // Services are triggered by AWS Lambda/EventBridge, not started here

      // Initialize Redis and StatusBroadcaster for WebSocket real-time updates
      redis = new Redis(getRedisUrl(), {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        reconnectOnError: (err) => {
          const targetError = 'READONLY';
          if (err.message.includes(targetError)) {
            // Only reconnect when the error contains "READONLY"
            return true;
          }
          return false;
        },
      });

      const statusBroadcaster = new StatusBroadcaster(app, redis);
      schedulerAdapter.setBroadcaster(statusBroadcaster);
      app.log.info('✅ WebSocket real-time updates initialized');

      // Initialize retention manager
      const retentionManager = getRetentionManager(app);
      await retentionManager.initialize();

      // Initialize background job queue and schedule recurring jobs
      await backgroundJobs.scheduleRecurringJobs();
      app.log.info('✅ Background job queue initialized with recurring jobs');

      app.log.info('✅ Database initialized and background services started');
    } catch (dbError: unknown) {
      const message = dbError instanceof Error ? dbError.message : 'An unknown error occurred';
      app.log.error({ message }, '❌ Failed to initialize database:');
      app.log.info('⚠️  Server running but background services disabled until database is ready');
    }
  });
}
