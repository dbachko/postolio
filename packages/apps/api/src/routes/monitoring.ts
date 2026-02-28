import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { checkDatabaseHealth, getDatabaseMetrics } from '../config/database.js';
import { monitoringService } from '../services/monitoring.js';

function registerMetricsRoute(fastify: FastifyInstance): void {
  fastify.get('/metrics', async function () {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const recentMetrics = monitoringService.getMetricsInPeriod(oneHourAgo, now);
    const totalRequests = recentMetrics.length;
    const errorCount = recentMetrics.filter((metric) => metric.statusCode >= 400).length;
    const avgResponseTime = monitoringService.getAverageResponseTime();

    return {
      timestamp: now.toISOString(),
      period: '1h',
      metrics: {
        totalRequests,
        errorCount,
        errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
        averageResponseTime: Math.round(avgResponseTime),
        uptime: process.uptime(),
      },
    };
  });
}

function registerEndpointMetricsRoute(fastify: FastifyInstance): void {
  fastify.get('/metrics/:endpoint', async function (request) {
    const { endpoint } = request.params as { endpoint: string };
    const decodedEndpoint = decodeURIComponent(endpoint);

    const errorRate = monitoringService.getErrorRate(decodedEndpoint);
    const avgResponseTime = monitoringService.getAverageResponseTime(decodedEndpoint);
    const endpointMetrics = monitoringService
      .getMetrics()
      .filter((metric) => metric.endpoint === decodedEndpoint);

    return {
      endpoint: decodedEndpoint,
      totalRequests: endpointMetrics.length,
      errorRate: Math.round(errorRate * 100) / 100,
      averageResponseTime: Math.round(avgResponseTime),
      recentRequests: endpointMetrics.slice(-10),
    };
  });
}

function registerErrorsRoute(fastify: FastifyInstance): void {
  fastify.get('/errors', async function () {
    const errors = monitoringService.getErrors();
    const recent = errors.slice(-50);

    return {
      totalErrors: errors.length,
      recentErrors: recent.map((error) => ({
        level: error.level,
        message: error.message,
        endpoint: error.endpoint,
        userId: error.userId,
        timestamp: error.timestamp,
      })),
    };
  });
}

async function getEmailQueueHealth() {
  type EmailQueueHealth = {
    status: 'unknown' | 'healthy' | 'unhealthy';
    error?: string;
    waiting?: number;
    active?: number;
    completed?: number;
    failed?: number;
    delayed?: number;
    paused?: boolean;
  };

  try {
    const { emailQueue } = await import('../services/email-queue.js');
    const queueStats = await emailQueue.getQueueStats();
    return { status: 'healthy', ...queueStats } as EmailQueueHealth;
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    } as EmailQueueHealth;
  }
}

function registerHealthRoute(fastify: FastifyInstance): void {
  fastify.get('/health', async function () {
    const metrics = monitoringService.getMetrics();
    const errors = monitoringService.getErrors();
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

    const recentErrors = errors.filter((error) => error.timestamp >= oneMinuteAgo);
    const isHealthy = recentErrors.length < 10;

    const dbHealth = await checkDatabaseHealth();
    const emailQueueHealth = await getEmailQueueHealth();

    return {
      status: isHealthy && dbHealth.status === 'healthy' ? 'healthy' : 'degraded',
      timestamp: now.toISOString(),
      uptime: process.uptime(),
      services: {
        api: {
          status: isHealthy ? 'healthy' : 'degraded',
          totalRequests: metrics.length,
          recentErrors: recentErrors.length,
        },
        database: dbHealth,
        emailQueue: emailQueueHealth,
      },
      system: {
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
      },
    };
  });
}

function registerDatabaseMetricsRoute(fastify: FastifyInstance): void {
  fastify.get('/metrics/database', async function () {
    const health = await checkDatabaseHealth();
    const metrics = await getDatabaseMetrics();

    return {
      timestamp: new Date().toISOString(),
      health,
      metrics,
    };
  });
}

function registerEmailQueueMetricsRoute(fastify: FastifyInstance): void {
  fastify.get('/metrics/email-queue', async function () {
    try {
      const { emailQueue } = await import('../services/email-queue.js');
      const stats = await emailQueue.getQueueStats();
      const failedJobs = await emailQueue.getFailedJobs(5);

      return {
        timestamp: new Date().toISOString(),
        stats,
        recentFailures: failedJobs.map((job) => ({
          id: job.id,
          type: job.data.type,
          to: job.data.to,
          error: job.failedReason,
          attemptsMade: job.attemptsMade,
          processedOn: job.processedOn,
        })),
      };
    } catch (error) {
      return {
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 'unavailable',
      };
    }
  });
}

function registerCircuitBreakerMetricsRoute(fastify: FastifyInstance): void {
  fastify.get('/metrics/circuit-breakers', async function () {
    try {
      await import('../services/email.js');

      return {
        timestamp: new Date().toISOString(),
        circuitBreakers: {
          email: {
            status: 'monitored',
            note: 'Circuit breaker status available in email service logs',
          },
        },
      };
    } catch (error) {
      return {
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}

const monitoringRoutes: FastifyPluginAsync = async function (fastify) {
  registerMetricsRoute(fastify);
  registerEndpointMetricsRoute(fastify);
  registerErrorsRoute(fastify);
  registerHealthRoute(fastify);
  registerDatabaseMetricsRoute(fastify);
  registerEmailQueueMetricsRoute(fastify);
  registerCircuitBreakerMetricsRoute(fastify);
};

export default monitoringRoutes;
