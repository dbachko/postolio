import './dotenv-init.js';
import { isProductionEnv } from './utils/env-mode.js';
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
import sessionsRoutes from './routes/sessions.js';
import csrfRoutes from './routes/csrf.js';
import googleOAuthRoutes from './routes/google-oauth.js';
import facebookOAuthRoutes from './routes/facebook-oauth.js';
import magicLinkRoutes from './routes/magic-link.js';
import emailVerificationRoutes from './routes/email-verification.js';
import passwordResetRoutes from './routes/password-reset.js';
import twoFactorRoutes from './routes/two-factor.js';
import monitoringRoutes from './routes/monitoring.js';
import instagramOAuthRoutes from './routes/instagram-oauth.js';
import metaOAuthRoutes from './routes/meta-oauth.js';
import { socialPlatformRoutes } from './routes/social-platform.js';
import brandsRoutes from './routes/brands.js';
import brandsSocialAccountsRoutes from './routes/brands-social-accounts.js';
import contentRoutes from './routes/content/index.js';
import videoRoutes from './routes/video.js';
import analyticsRoutes from './routes/analytics.js';
import autopilotRoutes from './routes/autopilot.js';
import aiInsightsRoutes from './routes/ai-insights.js';
import recommendationsRoutes from './routes/recommendations.js';
import publicationsRoutes from './routes/publications.js';
import brandStyleRoutes from './routes/brand-style.js';
import rollingContentRoutes from './routes/rolling-content.js';
import legalRoutes from './routes/legal.js';
import userRoutes from './routes/user.js';
import dataDeletionRoutes from './routes/data-deletion.js';
import { complianceRoutes } from './routes/compliance.js';
import postDetailRoutes from './routes/post-detail.js';
import configRoutes from './routes/config.js';
import backgroundJobsRoutes from './routes/background-jobs.js';
import themeSuggestionRoutes from './routes/theme-suggestions.js';
import accountRoutes from './routes/account.js';
import brandAnalysisNested from './routes/brand-analysis-nested.js';
import brandsInstagram from './routes/brands-instagram.js';
import notificationsRoutes from './routes/notifications.js';
import onboardingRoutes from './routes/onboarding.js';
import instagramWebhookRoutes from './routes/instagram-webhook.js';
import dmAutomationRoutes from './routes/dm-automation.js';
import savedRepliesRoutes from './routes/saved-replies.js';
import snippetsRoutes from './routes/snippets.js';
import imageProviderRoutes from './routes/image-providers.js';
import publishingQueuesRoutes from './routes/publishing-queues.js';
import recipesRoutes from './routes/recipes.js';
import skillsRoutes from './routes/skills.js';
import runsRoutes from './routes/runs.js';
import { ensureDatabaseSchema } from './config/database-setup.js';
import { getRetentionManager } from './services/retention-manager.js';
import type { Redis } from 'ioredis';
import { StatusBroadcaster } from './services/status-broadcaster.js';
import { schedulerAdapter } from './services/scheduler-adapter.js';
import { applyRateLimiting } from './middleware/rate-limit.js';
import { createRedisClient, getRedisClient } from './services/redis.js';
import { backgroundJobs } from './services/background-jobs.js';
import assetsProxyRoutes from './routes/assets-proxy.js';
import { errorHandler } from './middleware/error-handler.js';
import { initSentry, captureException } from '@postolio/observability';
import {
  ensureCuratedRecipesSeeded,
  getCuratedRecipeCatalogInfo,
} from './services/recipes/seed.js';

export function buildFastify(): FastifyInstance {
  // HTTPS configuration for local development
  let httpsOptions = {};

  // Only use HTTPS in development if not in CI
  if (process.env.NODE_ENV === 'dev' && !process.env.CI) {
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
    trustProxy: true, // Honor X-Forwarded-For for real client IPs behind proxies
    ...httpsOptions,
  });

  // Register plugins
  // CORS allowlist (web → api)
  const corsOrigins = new Set<string>([
    // Local development origins
    'http://ai.localhost:5173',
    'https://ai.localhost:5173',
    'https://ai.localhost',
    'https://localhost:5173',
    'https://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    // Production same-domain origin (postolio.example)
    'https://postolio.example',
  ]);

  const normalizeOrigin = (value: string): string | null => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;

    try {
      return new URL(trimmed).origin;
    } catch {
      // Accept bare hosts/domains (e.g., "postolio.example" or "localhost:5173")
      const host = trimmed.replace(/\/+$/, '');
      const isLocal =
        host === 'localhost' ||
        host.startsWith('localhost:') ||
        host === '127.0.0.1' ||
        host.startsWith('127.0.0.1:') ||
        host === 'ai.localhost' ||
        host.startsWith('ai.localhost:') ||
        host.endsWith('.localhost');
      const scheme = isLocal ? 'http' : 'https';
      return `${scheme}://${host}`;
    }
  };

  const addCorsOrigin = (value: string | undefined) => {
    if (!value) return;
    const origin = normalizeOrigin(value);
    if (origin && origin !== '*') corsOrigins.add(origin);
  };

  // Env-driven origins (recommended)
  addCorsOrigin(process.env.APP_URL);
  addCorsOrigin(process.env.FRONTEND_URL);

  // Comma-separated list of allowed origins (preferred)
  if (process.env.CORS_ORIGINS) {
    for (const raw of process.env.CORS_ORIGINS.split(',')) {
      addCorsOrigin(raw);
    }
  }

  // Backward-compatible single origin (historical)
  addCorsOrigin(process.env.CORS_ORIGIN);

  app.register(cors, {
    origin: Array.from(corsOrigins),
    credentials: true,
  });
  // Validate required secrets on startup
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
        upgradeInsecureRequests: isProductionEnv() ? [] : null,
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
      secure: isProductionEnv(),
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
  app.register(sessionsRoutes, { prefix: '/api/auth' });
  app.register(csrfRoutes, { prefix: '/api' });
  app.register(googleOAuthRoutes, { prefix: '/api/auth' });
  app.register(facebookOAuthRoutes, { prefix: '/api/auth' });
  app.register(magicLinkRoutes, { prefix: '/api/auth' });
  app.register(emailVerificationRoutes, { prefix: '/api/auth' });
  app.register(passwordResetRoutes, { prefix: '/api/auth' });
  app.register(twoFactorRoutes, { prefix: '/api/auth' });
  app.register(userRoutes); // User routes include their own /api prefix
  app.register(instagramOAuthRoutes, { prefix: '/api/auth/instagram' });
  app.register(metaOAuthRoutes, { prefix: '/api/auth/meta' });
  // Generic social platform routes (platform-agnostic)
  app.register(socialPlatformRoutes);
  app.register(brandsRoutes, { prefix: '/api/brands' });
  app.register(brandsSocialAccountsRoutes, { prefix: '/api/brands' });
  app.register(contentRoutes, { prefix: '/api/content' });
  app.register(videoRoutes, { prefix: '/api/video' });
  // All analytics (scheduler + v2) under /api/analytics/*
  app.register(analyticsRoutes, { prefix: '/api' });
  app.register(autopilotRoutes, { prefix: '/api/autopilot' });
  app.register(aiInsightsRoutes, { prefix: '/api/ai-insights' }); // AI-powered insights
  app.register(recommendationsRoutes, { prefix: '/api/recommendations' }); // Smart recommendations
  app.register(rollingContentRoutes, { prefix: '/api/rolling-content' });
  app.register(legalRoutes, { prefix: '/api/legal' });
  app.register(dataDeletionRoutes, { prefix: '/api/legal' });
  app.register(complianceRoutes);
  app.register(postDetailRoutes); // Post detail routes include /api in their own paths
  app.register(assetsProxyRoutes, { prefix: '/api/assets' });
  // Account utility routes
  app.register(onboardingRoutes); // Onboarding routes include their own /api prefix
  app.register(accountRoutes, { prefix: '/api/account' });
  app.register(configRoutes); // Config routes include their own /api prefix
  app.register(backgroundJobsRoutes); // Background job monitoring routes

  // Use /api/brands/:brandId/analysis/* for brand analysis
  app.register(brandAnalysisNested, { prefix: '/api/brands' });
  app.register(brandStyleRoutes, { prefix: '/api/brands' });
  app.register(notificationsRoutes, { prefix: '/api/notifications' });

  // Analytics/Publications endpoints (canonical under /api)
  app.register(publicationsRoutes, { prefix: '/api' });

  // Add brand-nested Instagram wrappers under /api/brands
  app.register(brandsInstagram, { prefix: '/api/brands' });
  app.register(themeSuggestionRoutes, { prefix: '/api/brands' });

  // Instagram webhook for DM automation (no /api prefix - Meta webhooks expect exact path)
  app.register(instagramWebhookRoutes);

  // DM Automation CRUD API
  app.register(dmAutomationRoutes, { prefix: '/api' });

  // Saved Replies API
  app.register(savedRepliesRoutes, { prefix: '/api' });

  // Snippets API
  app.register(snippetsRoutes, { prefix: '/api' });

  // Publishing queues (slot-based scheduling)
  app.register(publishingQueuesRoutes, { prefix: '/api' });

  // Image Providers API
  app.register(imageProviderRoutes, { prefix: '/api/image-providers' });

  // Recipes + Skills + Runs
  app.register(recipesRoutes, { prefix: '/api/recipes' });
  app.register(skillsRoutes, { prefix: '/api/skills' });
  app.register(runsRoutes, { prefix: '/api/runs' });

  const registerHealthRoute = (path: string) => {
    // GET handler - returns JSON status payload
    app.route({
      method: 'GET',
      url: path,
      logLevel: 'silent',
      exposeHeadRoute: false,
      handler: async (_, reply) => {
        const payload = { status: 'ok', timestamp: new Date().toISOString() };
        reply.header('cache-control', 'no-store');
        return payload;
      },
    });

    // HEAD handler - allows lightweight health checks without logging noise
    app.route({
      method: 'HEAD',
      url: path,
      logLevel: 'silent',
      handler: async (_, reply) => {
        reply.header('cache-control', 'no-store');
        reply.code(200);
      },
    });
  };

  // Health check endpoints for both load balancer probes and internal monitoring
  registerHealthRoute('/health');
  registerHealthRoute('/api/health');

  // Global error handler for consistent API error responses
  app.setErrorHandler(errorHandler as any);

  return app;
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initSentry({
    serviceName: 'api',
  });

  const app = buildFastify();
  let redis: Redis | null = null;

  // OBSERVABILITY: Global error handlers for unhandled rejections and exceptions
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    captureException(reason, {
      source: 'unhandledRejection',
    });
    app.log.error(
      {
        error: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        promise: String(promise),
      },
      '🚨 Unhandled Promise Rejection detected'
    );

    // In production, attempt graceful shutdown on unhandled rejection
    if (isProductionEnv()) {
      app.log.fatal('Critical error in production - initiating graceful shutdown');
      process.exit(1);
    }
  });

  process.on('uncaughtException', (error: Error, origin: string) => {
    captureException(error, {
      source: 'uncaughtException',
      origin,
    });
    app.log.error(
      {
        error: error.message,
        stack: error.stack,
        origin,
      },
      '🚨 Uncaught Exception detected'
    );

    // Always exit on uncaught exception - process is in undefined state
    app.log.fatal('Uncaught exception - process must exit');
    process.exit(1);
  });

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

  const start = async (): Promise<void> => {
    try {
      const address = await app.listen({ port: 3000, host: '0.0.0.0' });
      app.log.info(`Server listening at ${address}`);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }

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
      await ensureDatabaseSchema({ generateClient: false });

      const curatedCatalog = getCuratedRecipeCatalogInfo();
      const curatedSync = await ensureCuratedRecipesSeeded();
      app.log.info(
        {
          catalogVersion: curatedCatalog.catalogVersion,
          catalogHash: curatedCatalog.catalogHash.slice(0, 12),
          catalogSize: curatedCatalog.catalogSize,
          skipped: curatedSync.skipped,
          createdTemplates: curatedSync.createdTemplates,
          updatedTemplates: curatedSync.updatedTemplates,
          archivedTemplates: curatedSync.archivedTemplates,
          createdVersions: curatedSync.createdVersions,
          unchangedVersions: curatedSync.unchangedVersions,
        },
        '✅ Curated recipe catalog sync complete'
      );

      // Background services now managed by EventBridge
      // Services are triggered by AWS Lambda/EventBridge, not started here

      // Initialize Redis and StatusBroadcaster for WebSocket real-time updates
      redis = createRedisClient({
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

      // Make broadcaster available to background jobs
      const { setStatusBroadcaster } = await import('./services/broadcast-registry.js');
      setStatusBroadcaster(statusBroadcaster);

      // Initialize notifications broadcaster for user-level notifications
      const { NotificationsBroadcaster } = await import('./services/notifications-broadcaster.js');
      const notificationsBroadcaster = new NotificationsBroadcaster(app, redis);
      const { setNotificationsBroadcaster } = await import('./services/broadcast-registry.js');
      setNotificationsBroadcaster(notificationsBroadcaster);

      // Initialize DM automation service with broadcaster for real-time DM updates
      const { dmAutomation } = await import('./services/dm-automation.js');
      dmAutomation.init(app, redis);

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
  };

  // Start the server using promise-based API to avoid mixed callback/async patterns
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  start();
}
