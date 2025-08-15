import { FastifyPluginAsync } from 'fastify'

import { verifyJWT } from '../services/jwt.js'
import { campaignService, type CampaignConfig } from '../services/campaign.js'
import { campaignJobService } from '../services/campaign-jobs.js'
import { pauseResumeRateLimiter, campaignRateLimiter, createRateLimitMiddleware } from '../services/rate-limiter.js'
import { validateCampaignUpdateRequest } from '../utils/campaign-validation.js'
import { regenerationService } from '../services/regeneration-queue.js'
import { TimezoneService } from '../services/timezone.js'

import { getDatabaseClient } from '../config/database.js'

const prisma = getDatabaseClient()

interface ConfigureCampaignBody {
  name: string
  brandId: string
  duration: {
    start: string // ISO date string
    end: string // ISO date string
  }
  frequency: string
  themes: string[]
  style: string
  postingTime: string
  priority?: number
}

interface PreviewCampaignBody {
  configId: string
  exampleCount?: number
}

interface StartCampaignBody {
  campaignId: string
}

const campaignRoutes: FastifyPluginAsync = async (fastify) => {
  // Helper function to authenticate and get user ID
  const authenticateRequest = async (request: any) => {
    const authHeader = request.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Authentication required')
    }

    const token = authHeader.substring(7)
    let decoded
    try {
      decoded = verifyJWT(token)
    } catch (jwtError) {
      console.error('JWT verification error:', jwtError)
      throw new Error('Invalid authentication token')
    }

    // Store user ID for rate limiting
    request.user = { id: decoded.id }
    return decoded.id
  }

  // Configure campaign
  fastify.post<{ Body: ConfigureCampaignBody }>('/configure', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const body = request.body

      // Get brand's timezone for proper date interpretation
      // If brand doesn't have a timezone set, fall back to user's detected timezone
      let brandTimezone = await TimezoneService.getBrandTimezone(body.brandId)
      
      // If brand timezone is UTC (default) and we have user's timezone from header, use that
      if (brandTimezone === 'UTC') {
        const detectedTimezone = await TimezoneService.detectTimezone(request, userId)
        if (detectedTimezone !== 'UTC') {
          brandTimezone = detectedTimezone
        }
      }
      
      // Convert date strings to Date objects with timezone awareness
      const config: CampaignConfig = {
        name: body.name,
        brandId: body.brandId,
        duration: {
          start: TimezoneService.parseTimezoneAwareDate(body.duration.start, brandTimezone),
          end: TimezoneService.parseTimezoneAwareDate(body.duration.end, brandTimezone),
        },
        frequency: body.frequency,
        themes: body.themes,
        style: body.style,
        postingTime: body.postingTime,
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
      }

      // Validate campaign configuration
      const validationErrors = campaignService.validateCampaignConfig(config)

      if (validationErrors.length > 0) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: validationErrors,
        })
      }

      // Create campaign, passing the detected timezone
      const campaign = await campaignService.configureCampaign(config, userId, brandTimezone)

      return reply.code(201).send({
        success: true,
        campaign: {
          id: campaign.id,
          name: campaign.name,
          brandId: campaign.brandId,
          status: campaign.status,
          config: campaign.config,
          createdAt: campaign.createdAt,
          brand: campaign.brand,
        },
      })
    } catch (error) {
      console.error('Campaign configuration error:', error)

      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
        if (error.message.includes('Brand not found') || error.message.includes('access denied')) {
          return reply.code(404).send({ error: 'Brand not found or access denied' })
        }
        if (error.message.includes('start date') || error.message.includes('end date')) {
          return reply.code(400).send({ error: error.message })
        }
      }

      return reply.code(500).send({
        error: 'Failed to configure campaign. Please try again.',
      })
    }
  })

  // Get campaign status (for polling)
  fastify.get<{ Params: { id: string } }>('/status/:id', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { id } = request.params

      if (!id) {
        return reply.code(400).send({ error: 'Campaign ID is required' })
      }

      // Get campaign status from job service
      const status = await campaignJobService.getCampaignStatus(id)

      if (!status) {
        return reply.code(404).send({ error: 'Campaign not found' })
      }

      // Verify ownership by checking the campaign
      const campaign = await prisma.campaign.findFirst({
        where: {
          id,
          brand: {
            userId,
          },
        },
      })

      if (!campaign) {
        return reply.code(404).send({ error: 'Campaign not found or access denied' })
      }

      return reply.send({
        success: true,
        status: {
          id: status.id,
          status: status.status,
          progress: status.progress,
          errorMessage: status.errorMessage,
          previewGenerated: status.previewGenerated,
          isRunning: campaignJobService.isJobRunning(id),
        },
      })
    } catch (error) {
      console.error('Get campaign status error:', error)

      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
      }

      return reply.code(500).send({
        error: 'Failed to get campaign status. Please try again.',
      })
    }
  })

  // Generate campaign preview
  fastify.post<{ Body: PreviewCampaignBody }>('/preview', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { configId, exampleCount = 3 } = request.body

      if (!configId) {
        return reply.code(400).send({ error: 'Campaign ID is required' })
      }

      if (exampleCount < 1 || exampleCount > 10) {
        return reply.code(400).send({ error: 'Example count must be between 1 and 10' })
      }

      const preview = await campaignService.generateCampaignPreview(configId, userId, exampleCount)

      return reply.send({
        success: true,
        preview,
      })
    } catch (error) {
      console.error('Campaign preview error:', error)

      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
        if (error.message.includes('not found') || error.message.includes('access denied')) {
          return reply.code(404).send({ error: 'Campaign not found or access denied' })
        }
        if (error.message.includes('style profile')) {
          return reply.code(400).send({ error: error.message })
        }
      }

      return reply.code(500).send({
        error: 'Failed to generate campaign preview. Please try again.',
      })
    }
  })

  // Start campaign
  fastify.post<{ Body: StartCampaignBody }>('/start', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { campaignId } = request.body

      if (!campaignId) {
        return reply.code(400).send({ error: 'Campaign ID is required' })
      }

      const result = await campaignService.startCampaign(campaignId, userId)

      if (!result.success) {
        if (result.error?.includes('not found') || result.error?.includes('access denied')) {
          return reply.code(404).send({ error: result.error })
        }
        if (result.error?.includes('style profile')) {
          return reply.code(400).send({ error: result.error })
        }
        return reply.code(400).send({ error: result.error || 'Failed to start campaign' })
      }

      return reply.send({
        success: true,
        campaign: result.campaign,
        scheduledPosts: result.scheduledPosts,
        message: `Campaign started successfully. ${result.scheduledPosts} posts have been scheduled.`,
      })
    } catch (error) {
      console.error('Campaign start error:', error)

      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
      }

      return reply.code(500).send({
        error: 'Failed to start campaign. Please try again.',
      })
    }
  })

  // Get campaign details
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { id } = request.params

      if (!id) {
        return reply.code(400).send({ error: 'Campaign ID is required' })
      }

      const campaign = await campaignService.getCampaign(id, userId)

      return reply.send({
        success: true,
        campaign,
      })
    } catch (error) {
      console.error('Get campaign error:', error)

      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
        if (error.message.includes('not found') || error.message.includes('access denied')) {
          return reply.code(404).send({ error: 'Campaign not found or access denied' })
        }
      }

      return reply.code(500).send({
        error: 'Failed to retrieve campaign details. Please try again.',
      })
    }
  })

  // Update campaign configuration
  fastify.put<{
    Params: { id: string }
    Body: any
  }>('/:id', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { id } = request.params

      if (!id) {
        return reply.code(400).send({ error: 'Campaign ID is required' })
      }

      // Validate request schema
      const validation = validateCampaignUpdateRequest(request.body)
      if (!validation.valid) {
        return reply.code(400).send({
          error: 'Invalid request data',
          details: validation.errors.map(err => ({
            field: err.field,
            message: err.message,
            ...(err.value !== undefined ? { value: err.value } : {})
          }))
        })
      }

      const updates = validation.sanitizedData!

      // Apply rate limiting for pause/resume operations
      if (updates.status && ['paused', 'active'].includes(updates.status)) {
        const rateLimitCheck = await pauseResumeRateLimiter.checkRateLimit(userId)
        if (!rateLimitCheck.allowed) {
          reply.header('X-RateLimit-Limit', 20)
          reply.header('X-RateLimit-Remaining', rateLimitCheck.remaining)
          reply.header('X-RateLimit-Reset', Math.floor(rateLimitCheck.resetTime.getTime() / 1000))
          reply.header('Retry-After', rateLimitCheck.retryAfter || 300)
          
          return reply.code(429).send({
            error: 'Too many pause/resume requests',
            message: `Rate limit exceeded. Try again in ${rateLimitCheck.retryAfter || 300} seconds.`,
            retryAfter: rateLimitCheck.retryAfter || 300
          })
        }
      } else {
        // Apply general campaign rate limiting for other updates
        const rateLimitCheck = await campaignRateLimiter.checkRateLimit(userId)
        if (!rateLimitCheck.allowed) {
          reply.header('X-RateLimit-Limit', 10)
          reply.header('X-RateLimit-Remaining', rateLimitCheck.remaining)
          reply.header('X-RateLimit-Reset', Math.floor(rateLimitCheck.resetTime.getTime() / 1000))
          reply.header('Retry-After', rateLimitCheck.retryAfter || 60)
          
          return reply.code(429).send({
            error: 'Too many campaign requests',
            message: `Rate limit exceeded. Try again in ${rateLimitCheck.retryAfter || 60} seconds.`,
            retryAfter: rateLimitCheck.retryAfter || 60
          })
        }
      }

      // Use the new update method with regeneration support for comprehensive edits
      const result = await campaignService.updateCampaignWithRegeneration(id, updates, userId)

      return reply.send({
        success: true,
        campaign: result.campaign,
        message: result.message,
        regenerationTriggered: result.regenerationTriggered,
        regenerationReason: result.regenerationReason
      })
    } catch (error) {
      console.error('Update campaign error:', error)

      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
        if (error.message.includes('not found') || error.message.includes('access denied')) {
          return reply.code(404).send({ error: 'Campaign not found or access denied' })
        }
        if (error.message.includes('cannot be updated') || error.message.includes('already active')) {
          return reply.code(400).send({ error: error.message })
        }
        if (error.message.includes('Invalid status transition')) {
          return reply.code(400).send({ error: error.message })
        }
      }

      return reply.code(500).send({
        error: 'Failed to update campaign. Please try again.',
      })
    }
  })

  // List user's campaigns
  fastify.get<{ Querystring: { brandId?: string } }>('/list', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { brandId } = request.query

      // Build where clause - filter by brandId if provided, otherwise show all user's campaigns
      const whereClause: any = {
        brand: {
          userId,
        },
      }

      if (brandId) {
        // Verify the user owns this brand before filtering
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId,
          },
        })

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found or access denied' })
        }

        whereClause.brandId = brandId
      }

      const campaigns = await prisma.campaign.findMany({
        where: whereClause,
        include: {
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              content: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      })

      return reply.send({
        success: true,
        campaigns: campaigns.map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          brand: campaign.brand,
          contentCount: campaign._count.content,
          config: campaign.config,
          createdAt: campaign.createdAt,
          startedAt: campaign.startedAt,
          completedAt: campaign.completedAt,
        })),
      })
    } catch (error) {
      console.error('List campaigns error:', error)

      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
      }

      return reply.code(500).send({
        error: 'Failed to retrieve campaigns. Please try again.',
      })
    }
  })

  // Delete campaign (only if not started)
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { id } = request.params

      if (!id) {
        return reply.code(400).send({ error: 'Campaign ID is required' })
      }

      // Check if campaign exists and user owns it
      const campaign = await prisma.campaign.findFirst({
        where: {
          id,
          brand: {
            userId,
          },
        },
        include: {
          _count: {
            select: {
              content: true,
            },
          },
        },
      })

      if (!campaign) {
        return reply.code(404).send({ error: 'Campaign not found or access denied' })
      }

      // Only allow deletion of campaigns that haven't been started
      const deletableStatuses = ['draft', 'preview', 'creating', 'failed']
      if (!deletableStatuses.includes(campaign.status)) {
        return reply.code(400).send({
          error: `Cannot delete campaigns with status '${campaign.status}'. Only campaigns with status: ${deletableStatuses.join(', ')} can be deleted.`,
        })
      }

      // Delete the campaign (this will also delete related content due to cascade)
      await prisma.campaign.delete({
        where: { id },
      })

      return reply.send({
        success: true,
        message: 'Campaign deleted successfully',
        deletedCampaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          contentCount: campaign._count.content,
        },
      })
    } catch (error) {
      console.error('Delete campaign error:', error)

      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
      }

      return reply.code(500).send({
        error: 'Failed to delete campaign. Please try again.',
      })
    }
  })

  // Update campaign priority
  fastify.put<{
    Params: { id: string }
    Body: { priority: number }
  }>('/:id/priority', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const token = authHeader.substring(7)
      let decoded
      try {
        decoded = verifyJWT(token)
      } catch (jwtError) {
        console.error('JWT verification error:', jwtError)
        return reply.code(401).send({ error: 'Invalid authentication token' })
      }

      const { id } = request.params
      const { priority } = request.body

      if (!id) {
        return reply.code(400).send({ error: 'Campaign ID is required' })
      }

      if (typeof priority !== 'number' || priority < 1 || priority > 10) {
        return reply.code(400).send({ error: 'Priority must be a number between 1 and 10' })
      }

      const updatedCampaign = await campaignService.updateCampaignPriority(id, priority, decoded.id)

      return reply.send({
        success: true,
        message: 'Campaign priority updated successfully',
        campaign: updatedCampaign,
      })
    } catch (error) {
      console.error('Update campaign priority error:', error)

      if (error instanceof Error) {
        if (error.message.includes('Authentication') || error.message.includes('access denied')) {
          return reply.code(401).send({ error: error.message })
        }
        if (error.message.includes('not found')) {
          return reply.code(404).send({ error: error.message })
        }
      }

      return reply.code(500).send({
        error: 'Failed to update campaign priority. Please try again.',
      })
    }
  })

  // Get campaign coordination summary
  fastify.get('/coordination', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const token = authHeader.substring(7)
      let decoded
      try {
        decoded = verifyJWT(token)
      } catch (jwtError) {
        console.error('JWT verification error:', jwtError)
        return reply.code(401).send({ error: 'Invalid authentication token' })
      }

      const coordination = await campaignService.getCampaignCoordination(decoded.id)

      return reply.send({
        success: true,
        coordination,
      })
    } catch (error) {
      console.error('Get campaign coordination error:', error)

      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
      }

      return reply.code(500).send({
        error: 'Failed to get campaign coordination. Please try again.',
      })
    }
  })

  // Regenerate campaign content (simplified without rollback)
  fastify.post('/:id/regenerate-content', async (request: any, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { id: campaignId } = request.params
      const { themes, style, contentIds } = request.body

      // Get campaign and verify ownership
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: { 
          brand: true,
          content: true 
        }
      })

      if (!campaign) {
        return reply.code(404).send({ error: 'Campaign not found' })
      }

      if (campaign.brand.userId !== userId) {
        return reply.code(403).send({ error: 'Access denied' })
      }

      // Determine which content to regenerate
      const targetContentIds = contentIds && contentIds.length > 0 
        ? contentIds 
        : campaign.content.map(c => c.id)

      if (targetContentIds.length === 0) {
        return reply.code(400).send({ error: 'No content to regenerate' })
      }

      // Start regeneration job
      const regenerationJob = await regenerationService.startRegeneration(
        campaignId,
        targetContentIds,
        userId,
        { themes, style }
      )

      return reply.send({
        success: true,
        data: regenerationJob
      })

    } catch (error) {
      console.error('Content regeneration error:', error)
      return reply.code(500).send({
        error: 'Failed to start content regeneration. Please try again.',
      })
    }
  })

  // Get regeneration job progress
  fastify.get('/regeneration-jobs/:jobId', async (request: any, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { jobId } = request.params

      const progress = await regenerationService.getJobProgress(jobId)

      if (!progress) {
        return reply.code(404).send({ error: 'Job not found' })
      }

      return reply.send({
        success: true,
        data: progress
      })

    } catch (error) {
      console.error('Get job progress error:', error)
      return reply.code(500).send({
        error: 'Failed to get job progress. Please try again.',
      })
    }
  })

  // Cancel regeneration job
  fastify.delete('/regeneration-jobs/:jobId', async (request: any, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { jobId } = request.params

      const cancelled = await regenerationService.cancelJob(jobId)

      if (!cancelled) {
        return reply.code(404).send({ error: 'Job not found or already completed' })
      }

      return reply.send({
        success: true,
        message: 'Job cancelled successfully'
      })

    } catch (error) {
      console.error('Cancel job error:', error)
      return reply.code(500).send({
        error: 'Failed to cancel job. Please try again.',
      })
    }
  })
}

export default campaignRoutes
