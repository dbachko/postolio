import { FastifyPluginAsync } from 'fastify'
import { monitoringService } from '../services/monitoring.js'

// Simple monitoring middleware functions
export function trackRequest(request: any) {
  request.startTime = Date.now()
}

export function logResponse(request: any, reply: any) {
  const responseTime = Date.now() - (request.startTime || Date.now())

  // Extract user ID from JWT if available
  let userId: string | undefined
  try {
    if (request.user?.id) {
      userId = request.user.id
    }
  } catch {
    // Ignore JWT parsing errors for monitoring
  }

  monitoringService.trackApiCall({
    endpoint: request.url,
    method: request.method,
    statusCode: reply.statusCode,
    responseTime,
    ...(userId ? { userId } : {}),
  })

  // Log errors automatically
  if (reply.statusCode >= 400) {
    monitoringService.logError({
      level: reply.statusCode >= 500 ? 'error' : 'warn',
      message: `HTTP ${reply.statusCode} ${request.method} ${request.url}`,
      ...(userId ? { userId } : {}),
      endpoint: request.url,
    })
  }
}

const monitoringPlugin: FastifyPluginAsync = async function (fastify) {
  // Decorate fastify instance with monitoring functions for manual use
  fastify.decorate('trackRequest', trackRequest)
  fastify.decorate('logResponse', logResponse)

  // Add global hooks for automatic monitoring
  fastify.addHook('onRequest', async (request) => {
    trackRequest(request)
  })

  fastify.addHook('onResponse', async (request, reply) => {
    logResponse(request, reply)
  })
}

// Extend FastifyRequest interface to include startTime
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number
  }
}

export default monitoringPlugin
