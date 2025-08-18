import { FastifyPluginAsync } from 'fastify'
import { rollingContentService } from '../services/rolling-content.js'
import { verifyJWT } from '../services/jwt.js'
import { getDatabaseClient } from '../config/database.js'

const prisma = getDatabaseClient()

// Helper function to verify authentication
function authenticateRequest(request: any, reply: any) {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Missing or invalid authorization header' })
    return null
  }

  const token = authHeader.substring(7)
  try {
    return verifyJWT(token)
  } catch {
    reply.status(401).send({ error: 'Invalid token' })
    return null
  }
}

const rollingContentRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Get queue status for a brand
   */
  fastify.get('/queue-status/:brandId', {
    schema: {
      params: {
        type: 'object',
        properties: {
          brandId: { type: 'string' }
        },
        required: ['brandId']
      }
    }
  }, async (request, reply) => {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      
      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: user.id
        }
      })

      if (!brand) {
        return reply.code(404).send({
          success: false,
          error: 'Brand not found or access denied'
        })
      }

      const queueStatus = await rollingContentService.getQueueStatus(brandId)
      
      return reply.send({
        success: true,
        data: {
          brandId,
          brandName: brand.name,
          ...queueStatus
        }
      })
    } catch (error) {
      console.error('Get queue status error:', error)
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  /**
   * Manually trigger rolling content generation for a brand
   */
  fastify.post('/generate/:brandId', {
    schema: {
      params: {
        type: 'object',
        properties: {
          brandId: { type: 'string' }
        },
        required: ['brandId']
      },
      body: {
        type: 'object',
        properties: {
          campaignId: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      const { campaignId } = request.body as { campaignId?: string }
      
      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: user.id
        }
      })

      if (!brand) {
        return reply.code(404).send({
          success: false,
          error: 'Brand not found or access denied'
        })
      }

      const result = await rollingContentService.triggerManual(brandId, campaignId)
      
      return reply.send({
        success: result.success,
        data: {
          brandId,
          brandName: brand.name,
          generated: result.generated,
          message: result.message
        },
        ...(result.success ? {} : { error: result.message })
      })
    } catch (error) {
      console.error('Manual rolling generation error:', error)
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  /**
   * Check rolling generation needs for a brand
   */
  fastify.get('/check/:brandId', {
    schema: {
      params: {
        type: 'object',
        properties: {
          brandId: { type: 'string' }
        },
        required: ['brandId']
      }
    }
  }, async (request, reply) => {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const { brandId } = request.params as { brandId: string }
      
      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: user.id
        }
      })

      if (!brand) {
        return reply.code(404).send({
          success: false,
          error: 'Brand not found or access denied'
        })
      }

      const queueStatus = await rollingContentService.getQueueStatus(brandId)

      // Check if this brand should be generating content
      await rollingContentService.checkAndGenerateContent(brandId)
      
      const updatedQueueStatus = await rollingContentService.getQueueStatus(brandId)

      return reply.send({
        success: true,
        data: {
          brandId,
          brandName: brand.name,
          before: queueStatus,
          after: updatedQueueStatus,
          actionTaken: queueStatus.needsGeneration ? 'generation_triggered' : 'no_action_needed'
        }
      })
    } catch (error) {
      console.error('Check rolling generation error:', error)
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  /**
   * Get all brands' queue statuses for monitoring
   */
  fastify.get('/overview', async (request, reply) => {
    try {
      const user = authenticateRequest(request, reply)
      if (!user) return

      const userId = user.id
      
      // Get all user's brands with Instagram integration
      const brands = await prisma.brand.findMany({
        where: {
          userId,
          OR: [
            { instagramAccessToken: { not: null } },
            { instagramPageId: { not: null } }
          ]
        }
      })

      const brandStatuses = await Promise.all(
        brands.map(async (brand: any) => {
          try {
            const queueStatus = await rollingContentService.getQueueStatus(brand.id)
            return {
              brandId: brand.id,
              brandName: brand.name,
              ...queueStatus,
              lastChecked: new Date().toISOString()
            }
          } catch (error) {
            return {
              brandId: brand.id,
              brandName: brand.name,
              totalScheduled: 0,
              daysAhead: 0,
              needsGeneration: true,
              minQueueSize: 7,
              maxQueueSize: 14,
              error: error instanceof Error ? error.message : 'Unknown error',
              lastChecked: new Date().toISOString()
            }
          }
        })
      )

      const summary = {
        totalBrands: brands.length,
        brandsNeedingContent: brandStatuses.filter((b: any) => b.needsGeneration).length,
        brandsWithSufficientContent: brandStatuses.filter((b: any) => !b.needsGeneration).length,
        totalScheduledPosts: brandStatuses.reduce((sum: number, b: any) => sum + (b.totalScheduled || 0), 0)
      }

      return reply.send({
        success: true,
        data: {
          summary,
          brands: brandStatuses
        }
      })
    } catch (error) {
      console.error('Get rolling content overview error:', error)
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })
}

export default rollingContentRoutes