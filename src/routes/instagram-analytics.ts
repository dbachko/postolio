import { FastifyPluginAsync } from 'fastify'
import { instagramService } from '../services/instagram.js'
import { PrismaClient } from '@prisma/client'
import { verifyJWT } from '../services/jwt.js'

const prisma = new PrismaClient()

interface AnalyticsParams {
  brandId: string
}

// Helper function to verify authentication
function authenticateRequest(request: any, reply: any) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Authorization header required' })
    return null
  }

  const token = authHeader.substring(7)
  try {
    return verifyJWT(token)
  } catch (error) {
    reply.status(401).send({ error: 'Invalid token' })
    return null
  }
}

const instagramAnalyticsRoutes: FastifyPluginAsync = async function (fastify) {
  /**
   * GET /api/instagram-analytics/overview/:brandId
   * Get account-level analytics overview
   */
  fastify.get<{
    Params: AnalyticsParams
    Querystring: { timeRange?: '7d' | '30d' | '90d' }
  }>('/overview/:brandId', async (request, reply) => {
    const user = authenticateRequest(request, reply)
    if (!user) return

    const { brandId } = request.params
    const { timeRange = '7d' } = request.query
    const userId = user.id

    try {
      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found or unauthorized' })
      }

      // Check if Instagram is configured
      if (!instagramService.isConfigured(brand)) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
        })
      }

      const overview = await instagramService.getAccountInsights(brand, timeRange)
      return reply.send(overview)
    } catch (error) {
      console.error('Instagram analytics overview error:', error)

      if (error instanceof Error && error.message.includes('Rate limit exceeded')) {
        return reply.status(429).send({
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600, // 1 hour in seconds
        })
      }

      if (error instanceof Error && error.message.includes('Instagram not configured')) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
        })
      }

      return reply.status(500).send({
        error: 'Failed to fetch Instagram analytics overview',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  /**
   * GET /api/instagram-analytics/posts/:brandId
   * Get recent posts performance data
   */
  fastify.get<{
    Params: AnalyticsParams
    Querystring: { limit?: number }
  }>('/posts/:brandId', async (request, reply) => {
    const user = authenticateRequest(request, reply)
    if (!user) return

    const { brandId } = request.params
    const { limit = 10 } = request.query
    const userId = user.id

    try {
      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found or unauthorized' })
      }

      // Check if Instagram is configured
      if (!instagramService.isConfigured(brand)) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
        })
      }

      const performance = await instagramService.getRecentPostsPerformance(brand, Math.min(limit, 25))
      return reply.send(performance)
    } catch (error) {
      console.error('Instagram posts performance error:', error)

      if (error instanceof Error && error.message.includes('Rate limit exceeded')) {
        return reply.status(429).send({
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600,
        })
      }

      if (error instanceof Error && error.message.includes('Instagram not configured')) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
        })
      }

      return reply.status(500).send({
        error: 'Failed to fetch Instagram posts performance',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  /**
   * POST /api/instagram-analytics/refresh/:brandId
   * Force refresh analytics data (bypass cache)
   */
  fastify.post<{
    Params: AnalyticsParams
  }>('/refresh/:brandId', async (request, reply) => {
    const user = authenticateRequest(request, reply)
    if (!user) return

    const { brandId } = request.params
    const userId = user.id

    try {
      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found or unauthorized' })
      }

      // Check if Instagram is configured
      if (!instagramService.isConfigured(brand)) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
        })
      }

      const refreshResult = await instagramService.refreshAnalyticsData(brand)

      if (!refreshResult.success) {
        return reply.status(429).send({
          error: refreshResult.message,
          nextRefreshAllowed: refreshResult.nextRefreshAllowed,
          success: false,
        })
      }

      return reply.send(refreshResult)
    } catch (error) {
      console.error('Instagram analytics refresh error:', error)

      if (error instanceof Error && error.message.includes('Instagram not configured')) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
        })
      }

      return reply.status(500).send({
        error: 'Failed to refresh Instagram analytics data',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  /**
   * GET /api/instagram-analytics/status/:brandId
   * Get cache status and rate limit information
   */
  fastify.get<{
    Params: AnalyticsParams
  }>('/status/:brandId', async (request, reply) => {
    const user = authenticateRequest(request, reply)
    if (!user) return

    const { brandId } = request.params
    const userId = user.id

    try {
      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found or unauthorized' })
      }

      // Check if Instagram is configured
      if (!instagramService.isConfigured(brand)) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
          lastUpdated: null,
          cacheAge: 0,
          rateLimitRemaining: 200,
        })
      }

      const status = await instagramService.getAnalyticsCacheStatus(brand)
      return reply.send({
        ...status,
        configured: true,
      })
    } catch (error) {
      console.error('Instagram analytics status error:', error)

      if (error instanceof Error && error.message.includes('Instagram not configured')) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
          lastUpdated: null,
          cacheAge: 0,
          rateLimitRemaining: 200,
        })
      }

      return reply.status(500).send({
        error: 'Failed to get Instagram analytics status',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })
}

export default instagramAnalyticsRoutes
