import { FastifyPluginAsync } from 'fastify'

import { verifyJWT } from '../services/jwt.js'
import { analyticsService } from '../services/analytics.js'
import { schedulerService } from '../services/scheduler.js'

import { getDatabaseClient } from '../config/database.js'

const prisma = getDatabaseClient()

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

const analytics: FastifyPluginAsync = async function (fastify) {
  // Get analytics report for a brand
  fastify.get('/report/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const { days = 30 } = request.query as { days?: number }
      const userId = user.id

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId
        }
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      const report = await analyticsService.generateAnalyticsReport(brandId, days)
      
      reply.send({ report })
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to generate analytics report',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Get optimal posting times for a brand
  fastify.get('/optimal-times/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const userId = user.id

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId
        }
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      const optimalTimes = await analyticsService.analyzeOptimalTimes(brandId)
      
      reply.send({ 
        optimalTimes: optimalTimes.map(time => ({
          ...time,
          dayName: analyticsService.getDayName(time.dayOfWeek),
          timeFormatted: analyticsService.formatHour(time.hour)
        }))
      })
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to analyze optimal times',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Get scheduling recommendation for new content
  fastify.get('/schedule-recommendation/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const { timezone = 'UTC' } = request.query as { timezone?: string }
      const userId = user.id

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId
        }
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      const recommendation = await analyticsService.getSchedulingRecommendation(brandId, timezone)
      
      reply.send({ recommendation })
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to get scheduling recommendation',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Schedule content for posting
  fastify.post('/schedule', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { contentId, scheduledTime } = request.body as {
        contentId: string
        scheduledTime?: string
      }

      if (!contentId) {
        return reply.status(400).send({ error: 'contentId is required' })
      }

      const userId = user.id

      // Verify content ownership
      const content = await prisma.content.findFirst({
        where: {
          id: contentId,
          brand: {
            userId: userId
          }
        }
      })

      if (!content) {
        return reply.status(404).send({ error: 'Content not found' })
      }

      if (content.status !== 'draft') {
        return reply.status(400).send({ error: 'Content must be in draft status before scheduling' })
      }

      const customTime = scheduledTime ? new Date(scheduledTime) : undefined
      const result = await schedulerService.scheduleContent(contentId, customTime)
      
      if (result.success) {
        reply.send({ 
          success: true,
          scheduledPost: result.scheduledPost
        })
      } else {
        reply.status(400).send({ 
          success: false,
          error: result.error
        })
      }
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to schedule content',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Get scheduled posts for a brand
  fastify.get('/scheduled/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const userId = user.id

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId
        }
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      const scheduledPosts = await schedulerService.getScheduledPosts(brandId)
      
      reply.send({ scheduledPosts })
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to get scheduled posts',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Cancel a scheduled post
  fastify.delete('/scheduled/:contentId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { contentId } = request.params as { contentId: string }
      const userId = user.id

      // Verify content ownership
      const content = await prisma.content.findFirst({
        where: {
          id: contentId,
          brand: {
            userId: userId
          }
        }
      })

      if (!content) {
        return reply.status(404).send({ error: 'Content not found' })
      }

      const success = await schedulerService.cancelScheduledPost(contentId)
      
      if (success) {
        reply.send({ success: true })
      } else {
        reply.status(500).send({ success: false, error: 'Failed to cancel scheduled post' })
      }
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to cancel scheduled post',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Reschedule a post
  fastify.put('/reschedule', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { contentId, newTime } = request.body as {
        contentId: string
        newTime: string
      }

      if (!contentId || !newTime) {
        return reply.status(400).send({ error: 'contentId and newTime are required' })
      }

      const userId = user.id

      // Verify content ownership
      const content = await prisma.content.findFirst({
        where: {
          id: contentId,
          brand: {
            userId: userId
          }
        }
      })

      if (!content) {
        return reply.status(404).send({ error: 'Content not found' })
      }

      const result = await schedulerService.reschedulePost(contentId, new Date(newTime))
      
      if (result.success) {
        reply.send({ success: true })
      } else {
        reply.status(400).send({ 
          success: false,
          error: result.error
        })
      }
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to reschedule post',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Bulk schedule multiple content items
  fastify.post('/bulk-schedule', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { contentIds, startTime } = request.body as {
        contentIds: string[]
        startTime?: string
      }

      if (!contentIds || !Array.isArray(contentIds) || contentIds.length === 0) {
        return reply.status(400).send({ error: 'contentIds array is required' })
      }

      const userId = user.id

      // Verify all content ownership
      const contents = await prisma.content.findMany({
        where: {
          id: { in: contentIds },
          brand: {
            userId: userId
          }
        }
      })

      if (contents.length !== contentIds.length) {
        return reply.status(404).send({ error: 'Some content items not found' })
      }

      const customStartTime = startTime ? new Date(startTime) : undefined
      const results = await schedulerService.bulkSchedule(contentIds, customStartTime)
      
      reply.send({ 
        success: true,
        results
      })
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to bulk schedule content',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Get scheduling statistics for a brand
  fastify.get('/stats/:brandId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const userId = user.id

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId
        }
      })

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found' })
      }

      const stats = await schedulerService.getSchedulingStats(brandId)
      
      reply.send({ stats })
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to get scheduling statistics',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Collect metrics for a specific post
  fastify.post('/collect-metrics/:contentId', async function (request, reply) {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { contentId } = request.params as { contentId: string }
      const userId = user.id

      // Verify content ownership
      const content = await prisma.content.findFirst({
        where: {
          id: contentId,
          brand: {
            userId: userId
          }
        }
      })

      if (!content) {
        return reply.status(404).send({ error: 'Content not found' })
      }

      if (content.status !== 'published') {
        return reply.status(400).send({ error: 'Content must be posted to collect metrics' })
      }

      const metrics = await analyticsService.collectPostMetrics(contentId)
      
      if (metrics) {
        reply.send({ 
          success: true,
          metrics
        })
      } else {
        reply.status(400).send({ 
          success: false,
          error: 'Failed to collect metrics'
        })
      }
    } catch (error) {
      reply.status(500).send({ 
        error: 'Failed to collect post metrics',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })
}

export default analytics