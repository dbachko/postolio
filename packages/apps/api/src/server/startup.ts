import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { isProductionEnv } from '../utils/env-mode.js';
import { validateEnvironment } from '../config/validation.js';
import { ensureDatabaseSchema } from '../config/database-setup.js';
import { getRetentionManager } from '../services/retention-manager.js';
import { StatusBroadcaster } from '../services/status-broadcaster.js';
import { schedulerAdapter } from '../services/scheduler-adapter.js';
import { createRedisClient } from '../services/redis.js';
import { backgroundJobs } from '../services/background-jobs.js';
import { initSentry, captureException } from '@postolio/observability';
import {
  ensureCuratedRecipesSeeded,
  getCuratedRecipeCatalogInfo,
} from '../services/recipes/seed.js';

function registerGlobalErrorHandlers(app: FastifyInstance) {
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    captureException(reason, { source: 'unhandledRejection' });
    app.log.error(
      {
        error: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        promise: String(promise),
      },
      '🚨 Unhandled Promise Rejection detected'
    );

    if (isProductionEnv()) {
      app.log.fatal('Critical error in production - initiating graceful shutdown');
      process.exit(1);
    }
  });

  process.on('uncaughtException', (error: Error, origin: string) => {
    captureException(error, { source: 'uncaughtException', origin });
    app.log.error(
      { error: error.message, stack: error.stack, origin },
      '🚨 Uncaught Exception detected'
    );
    app.log.fatal('Uncaught exception - process must exit');
    process.exit(1);
  });
}

function registerGracefulShutdown(app: FastifyInstance, getRedis: () => Redis | null) {
  const signals = ['SIGTERM', 'SIGINT'];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      app.log.warn(`Received ${signal}, starting graceful shutdown...`);
      try {
        await backgroundJobs.shutdown();
        app.log.info('Background job queue shut down');

        const redis = getRedis();
        if (redis) {
          await redis.quit();
          app.log.info('Redis connection closed');
        }

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
}

async function initializeRuntimeServices(app: FastifyInstance): Promise<Redis> {
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

  const redis = createRedisClient({
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    reconnectOnError: (err) => err.message.includes('READONLY'),
  });

  const statusBroadcaster = new StatusBroadcaster(app, redis);
  schedulerAdapter.setBroadcaster(statusBroadcaster);

  const { setStatusBroadcaster, setNotificationsBroadcaster } =
    await import('../services/broadcast-registry.js');
  setStatusBroadcaster(statusBroadcaster);

  const { NotificationsBroadcaster } = await import('../services/notifications-broadcaster.js');
  const notificationsBroadcaster = new NotificationsBroadcaster(app, redis);
  setNotificationsBroadcaster(notificationsBroadcaster);

  const { dmAutomation } = await import('../services/dm-automation.js');
  dmAutomation.init(app, redis);

  app.log.info('✅ WebSocket real-time updates initialized');

  const retentionManager = getRetentionManager(app);
  await retentionManager.initialize();

  await backgroundJobs.scheduleRecurringJobs();
  app.log.info('✅ Background job queue initialized with recurring jobs');
  app.log.info('✅ Database initialized and background services started');
  return redis;
}

async function startListening(app: FastifyInstance): Promise<void> {
  try {
    const address = await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
    app.log.info(`Server listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

export async function startServer(buildFastify: () => FastifyInstance): Promise<void> {
  initSentry({ serviceName: 'api' });

  const app = buildFastify();
  let redis: Redis | null = null;

  registerGlobalErrorHandlers(app);
  registerGracefulShutdown(app, () => redis);

  await startListening(app);

  try {
    validateEnvironment();
  } catch (envError: unknown) {
    const message = envError instanceof Error ? envError.message : 'An unknown error occurred';
    app.log.error({ message }, '❌ Environment validation failed:');
    process.exit(1);
  }

  try {
    redis = await initializeRuntimeServices(app);
  } catch (dbError: unknown) {
    const message = dbError instanceof Error ? dbError.message : 'An unknown error occurred';
    app.log.error({ message }, '❌ Failed to initialize database:');
    app.log.info('⚠️  Server running but background services disabled until database is ready');
  }
}
