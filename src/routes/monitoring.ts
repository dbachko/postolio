import { FastifyPluginAsync } from 'fastify'
import { monitoringService } from '../services/monitoring.js'

const monitoringRoutes: FastifyPluginAsync = async function (fastify) {
  
  // Get system metrics
  fastify.get('/metrics', async function (request, reply) {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    
    const recentMetrics = monitoringService.getMetricsInPeriod(oneHourAgo, now)
    const totalRequests = recentMetrics.length
    const errorCount = recentMetrics.filter(m => m.statusCode >= 400).length
    const avgResponseTime = monitoringService.getAverageResponseTime()
    
    return {
      timestamp: now.toISOString(),
      period: '1h',
      metrics: {
        totalRequests,
        errorCount,
        errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
        averageResponseTime: Math.round(avgResponseTime),
        uptime: process.uptime()
      }
    }
  })
  
  // Get endpoint-specific metrics
  fastify.get('/metrics/:endpoint', async function (request, reply) {
    const { endpoint } = request.params as { endpoint: string }
    const decodedEndpoint = decodeURIComponent(endpoint)
    
    const errorRate = monitoringService.getErrorRate(decodedEndpoint)
    const avgResponseTime = monitoringService.getAverageResponseTime(decodedEndpoint)
    const allMetrics = monitoringService.getMetrics()
    const endpointMetrics = allMetrics.filter(m => m.endpoint === decodedEndpoint)
    
    return {
      endpoint: decodedEndpoint,
      totalRequests: endpointMetrics.length,
      errorRate: Math.round(errorRate * 100) / 100,
      averageResponseTime: Math.round(avgResponseTime),
      recentRequests: endpointMetrics.slice(-10) // Last 10 requests
    }
  })
  
  // Get recent errors
  fastify.get('/errors', async function (request, reply) {
    const errors = monitoringService.getErrors()
    const recent = errors.slice(-50) // Last 50 errors
    
    return {
      totalErrors: errors.length,
      recentErrors: recent.map(error => ({
        level: error.level,
        message: error.message,
        endpoint: error.endpoint,
        userId: error.userId,
        timestamp: error.timestamp
      }))
    }
  })
  
  // Health check with metrics
  fastify.get('/health', async function (request, reply) {
    const metrics = monitoringService.getMetrics()
    const errors = monitoringService.getErrors()
    const now = new Date()
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000)
    
    const recentErrors = errors.filter(e => e.timestamp >= oneMinuteAgo)
    const isHealthy = recentErrors.length < 10 // Threshold: less than 10 errors per minute
    
    return {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: now.toISOString(),
      uptime: process.uptime(),
      totalRequests: metrics.length,
      recentErrors: recentErrors.length,
      memoryUsage: process.memoryUsage()
    }
  })
}

export default monitoringRoutes