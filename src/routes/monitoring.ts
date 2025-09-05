import { FastifyPluginAsync } from 'fastify'
import { monitoringService } from '../services/monitoring.js'
import { checkDatabaseHealth, getDatabaseMetrics } from '../config/database.js'
import { serviceClients } from '../services/service-clients.js'
import { isCloudMapConfigured } from '../utils/service-discovery.js'

const monitoringRoutes: FastifyPluginAsync = async function (fastify) {
  // Get system metrics
  fastify.get('/metrics', async function () {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

    const recentMetrics = monitoringService.getMetricsInPeriod(oneHourAgo, now)
    const totalRequests = recentMetrics.length
    const errorCount = recentMetrics.filter((m) => m.statusCode >= 400).length
    const avgResponseTime = monitoringService.getAverageResponseTime()

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
    }
  })

  // Get endpoint-specific metrics
  fastify.get('/metrics/:endpoint', async function (request) {
    const { endpoint } = request.params as { endpoint: string }
    const decodedEndpoint = decodeURIComponent(endpoint)

    const errorRate = monitoringService.getErrorRate(decodedEndpoint)
    const avgResponseTime = monitoringService.getAverageResponseTime(decodedEndpoint)
    const allMetrics = monitoringService.getMetrics()
    const endpointMetrics = allMetrics.filter((m) => m.endpoint === decodedEndpoint)

    return {
      endpoint: decodedEndpoint,
      totalRequests: endpointMetrics.length,
      errorRate: Math.round(errorRate * 100) / 100,
      averageResponseTime: Math.round(avgResponseTime),
      recentRequests: endpointMetrics.slice(-10), // Last 10 requests
    }
  })

  // Get recent errors
  fastify.get('/errors', async function () {
    const errors = monitoringService.getErrors()
    const recent = errors.slice(-50) // Last 50 errors

    return {
      totalErrors: errors.length,
      recentErrors: recent.map((error) => ({
        level: error.level,
        message: error.message,
        endpoint: error.endpoint,
        userId: error.userId,
        timestamp: error.timestamp,
      })),
    }
  })

  // Enhanced health check with all services
  fastify.get('/health', async function () {
    const metrics = monitoringService.getMetrics()
    const errors = monitoringService.getErrors()
    const now = new Date()
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000)

    const recentErrors = errors.filter((e) => e.timestamp >= oneMinuteAgo)
    const isHealthy = recentErrors.length < 10 // Threshold: less than 10 errors per minute

    // Check database health
    const dbHealth = await checkDatabaseHealth()
    
    // Check email queue health
    let emailQueueHealth: any = { status: 'unknown' }
    try {
      const { emailQueue } = await import('../services/email-queue.js')
      const queueStats = await emailQueue.getQueueStats()
      emailQueueHealth = {
        status: 'healthy',
        ...queueStats
      }
    } catch (error) {
      emailQueueHealth = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }

    // Check service discovery health
    let serviceDiscoveryHealth: any = { status: 'unknown' }
    try {
      const serviceHealth = await serviceClients.healthCheck()
      serviceDiscoveryHealth = {
        status: serviceHealth.overall,
        services: {
          tokenService: serviceHealth.tokenService,
          schedulerService: serviceHealth.schedulerService,
        }
      }
    } catch (error) {
      serviceDiscoveryHealth = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Service discovery unavailable'
      }
    }

    return {
      status: isHealthy && dbHealth.status === 'healthy' && serviceDiscoveryHealth.status !== 'unhealthy' ? 'healthy' : 'degraded',
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
        serviceDiscovery: serviceDiscoveryHealth,
      },
      system: {
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
      }
    }
  })

  // Database-specific metrics
  fastify.get('/metrics/database', async function () {
    const health = await checkDatabaseHealth()
    const metrics = await getDatabaseMetrics()
    
    return {
      timestamp: new Date().toISOString(),
      health,
      metrics,
    }
  })

  // Email queue metrics
  fastify.get('/metrics/email-queue', async function () {
    try {
      const { emailQueue } = await import('../services/email-queue.js')
      const stats = await emailQueue.getQueueStats()
      const failedJobs = await emailQueue.getFailedJobs(5)
      
      return {
        timestamp: new Date().toISOString(),
        stats,
        recentFailures: failedJobs.map(job => ({
          id: job.id,
          type: job.data.type,
          to: job.data.to,
          error: job.failedReason,
          attemptsMade: job.attemptsMade,
          processedOn: job.processedOn,
        }))
      }
    } catch (error) {
      return {
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 'unavailable'
      }
    }
  })

  // Circuit breaker status
  fastify.get('/metrics/circuit-breakers', async function () {
    try {
      // Import but don't use directly - just checking it's available
      await import('../services/email.js')
      
      // Get circuit breaker stats if available
      return {
        timestamp: new Date().toISOString(),
        circuitBreakers: {
          email: {
            status: 'monitored',
            note: 'Circuit breaker status available in email service logs'
          }
        }
      }
    } catch (error) {
      return {
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Service discovery health check
  fastify.get('/health/service-discovery', async function () {
    try {
      const serviceHealth = await serviceClients.healthCheck()
      
      return {
        timestamp: new Date().toISOString(),
        overall: serviceHealth.overall,
        services: serviceHealth,
        environment: {
          cloudMapConfigured: isCloudMapConfigured(),
          cloudMapNamespaceId: process.env.CLOUDMAP_NAMESPACE_ID || 'not configured',
          cloudMapNamespaceName: process.env.CLOUDMAP_NAMESPACE_NAME || 'not configured',
        },
        fallbackUrls: {
          tokenService: process.env.TOKEN_SERVICE_URL || 'not configured',
          contentScheduler: process.env.CONTENT_SCHEDULER_URL || process.env.SCHEDULER_API_URL || 'not configured',
        }
      }
    } catch (error) {
      return {
        timestamp: new Date().toISOString(),
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        environment: {
          serviceDiscoveryEnabled: process.env.SERVICE_DISCOVERY_ENABLED === 'true',
          cloudMapNamespaceId: process.env.CLOUDMAP_NAMESPACE_ID || 'not configured',
          cloudMapNamespaceName: process.env.CLOUDMAP_NAMESPACE_NAME || 'not configured',
        }
      }
    }
  })

  // Refresh service discovery
  fastify.post('/service-discovery/refresh', async function () {
    try {
      await serviceClients.refreshServiceDiscovery()
      return {
        timestamp: new Date().toISOString(),
        status: 'success',
        message: 'Service discovery refreshed successfully'
      }
    } catch (error) {
      return {
        timestamp: new Date().toISOString(),
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })
}

export default monitoringRoutes
