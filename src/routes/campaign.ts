import { FastifyPluginAsync } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { verifyJWT } from '../services/jwt.js'
import { campaignService, type CampaignConfig } from '../services/campaign.js'
import { campaignJobService } from '../services/campaign-jobs.js'

const prisma = new PrismaClient()

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

    return decoded.id
  }

  // Configure campaign
  fastify.post<{ Body: ConfigureCampaignBody }>('/configure', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const body = request.body

      // Convert date strings to Date objects
      const config: CampaignConfig = {
        name: body.name,
        brandId: body.brandId,
        duration: {
          start: new Date(body.duration.start),
          end: new Date(body.duration.end),
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

      // Create campaign
      const campaign = await campaignService.configureCampaign(config, userId)

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
    Body: {
      name?: string
      themes?: string[]
      style?: string
      frequency?: string
      postingTime?: string
      startDate?: string
      endDate?: string
    }
  }>('/:id', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { id } = request.params
      const updates = request.body

      if (!id) {
        return reply.code(400).send({ error: 'Campaign ID is required' })
      }

      const updatedCampaign = await campaignService.updateCampaign(id, userId, updates)

      return reply.send({
        success: true,
        campaign: updatedCampaign,
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
}

export default campaignRoutes
