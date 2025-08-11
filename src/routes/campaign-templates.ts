import { FastifyPluginAsync } from 'fastify'

import { verifyJWT } from '../services/jwt.js'
import { campaignService, type CampaignConfig } from '../services/campaign.js'

import { getDatabaseClient } from '../config/database.js'

const prisma = getDatabaseClient()

interface CreateTemplateBody {
  name: string
  description?: string
  isPublic?: boolean
  brandId?: string
  templateConfig: {
    duration?: {
      days: number
    }
    frequency: string
    themes: string[]
    style: string
    postingTime: string
  }
}

interface UpdateTemplateBody {
  name?: string
  description?: string
  isPublic?: boolean
  templateConfig?: {
    duration?: {
      days: number
    }
    frequency?: string
    themes?: string[]
    style?: string
    postingTime?: string
  }
}

interface ApplyTemplateBody {
  name: string
  brandId: string
  duration: {
    start: string // ISO date string
    end: string   // ISO date string
  }
  overrides?: {
    themes?: string[]
    style?: string
    frequency?: string
    postingTime?: string
  }
}

interface SaveCampaignAsTemplateBody {
  name: string
  description?: string
  isPublic?: boolean
  brandId?: string
}

const campaignTemplatesRoutes: FastifyPluginAsync = async (fastify) => {
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

  // Create new template
  fastify.post<{ Body: CreateTemplateBody }>('/', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { name, description, isPublic = false, brandId, templateConfig } = request.body

      // Validate required fields
      if (!name || name.trim().length === 0) {
        return reply.code(400).send({ error: 'Template name is required' })
      }

      if (name.length > 100) {
        return reply.code(400).send({ error: 'Template name must be less than 100 characters' })
      }

      if (!templateConfig) {
        return reply.code(400).send({ error: 'Template configuration is required' })
      }

      // Validate template configuration
      const { frequency, themes, style, postingTime } = templateConfig
      if (!frequency || !themes || !style || !postingTime) {
        return reply.code(400).send({ 
          error: 'Template configuration must include frequency, themes, style, and postingTime' 
        })
      }

      if (!Array.isArray(themes) || themes.length === 0) {
        return reply.code(400).send({ error: 'At least one theme is required' })
      }

      // Validate brand ownership if brandId provided
      if (brandId) {
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId
          }
        })

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found or access denied' })
        }
      }

      // Create template
      const template = await prisma.campaignTemplate.create({
        data: {
          name: name.trim(),
          description: description?.trim() || null,
          isPublic,
          templateConfig,
          createdById: userId,
          brandId: brandId || null
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          brand: {
            select: {
              id: true,
              name: true
            }
          }
        }
      })

      return reply.code(201).send({
        success: true,
        template: {
          id: template.id,
          name: template.name,
          description: template.description,
          isPublic: template.isPublic,
          templateConfig: template.templateConfig,
          usageCount: template.usageCount,
          createdAt: template.createdAt,
          createdBy: template.createdBy,
          brand: template.brand
        }
      })
    } catch (error) {
      console.error('Template creation error:', error)
      
      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
        if (error.message.includes('Unique constraint')) {
          return reply.code(400).send({ error: 'A template with this name already exists' })
        }
      }
      
      return reply.code(500).send({ 
        error: 'Failed to create template. Please try again.' 
      })
    }
  })

  // List templates with filtering
  fastify.get<{ 
    Querystring: { 
      brandId?: string
      isPublic?: string
      search?: string
      limit?: string
      offset?: string
    } 
  }>('/', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { brandId, isPublic, search, limit = '20', offset = '0' } = request.query

      const limitNum = parseInt(limit, 10)
      const offsetNum = parseInt(offset, 10)

      if (limitNum < 1 || limitNum > 100) {
        return reply.code(400).send({ error: 'Limit must be between 1 and 100' })
      }

      // Build where clause
      const whereClause: any = {
        OR: [
          { createdById: userId }, // User's own templates
          { isPublic: true }       // Public templates
        ]
      }

      // Apply filters
      if (brandId) {
        // Verify user owns this brand
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId
          }
        })
        
        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found or access denied' })
        }
        
        whereClause.brandId = brandId
      }

      if (isPublic !== undefined) {
        const isPublicBool = isPublic === 'true'
        whereClause.isPublic = isPublicBool
        
        // If filtering for public templates, remove the OR clause and only show public ones
        if (isPublicBool) {
          delete whereClause.OR
          whereClause.isPublic = true
        } else {
          // If filtering for private templates, only show user's own
          delete whereClause.OR
          whereClause.createdById = userId
          whereClause.isPublic = false
        }
      }

      if (search && search.trim()) {
        whereClause.OR = [
          { name: { contains: search.trim(), mode: 'insensitive' } },
          { description: { contains: search.trim(), mode: 'insensitive' } }
        ]
      }

      const [templates, total] = await Promise.all([
        prisma.campaignTemplate.findMany({
          where: whereClause,
          include: {
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true
              }
            },
            brand: {
              select: {
                id: true,
                name: true
              }
            }
          },
          orderBy: [
            { createdAt: 'desc' }
          ],
          take: limitNum,
          skip: offsetNum
        }),
        prisma.campaignTemplate.count({
          where: whereClause
        })
      ])

      return reply.send({
        success: true,
        templates: templates.map(template => ({
          id: template.id,
          name: template.name,
          description: template.description,
          isPublic: template.isPublic,
          templateConfig: template.templateConfig,
          usageCount: template.usageCount,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt,
          createdBy: template.createdBy,
          brand: template.brand,
          isOwned: template.createdById === userId
        })),
        pagination: {
          total,
          limit: limitNum,
          offset: offsetNum,
          hasMore: offsetNum + limitNum < total
        }
      })
    } catch (error) {
      console.error('List templates error:', error)
      
      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
      }
      
      return reply.code(500).send({ 
        error: 'Failed to retrieve templates. Please try again.' 
      })
    }
  })

  // Get specific template
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { id } = request.params

      if (!id) {
        return reply.code(400).send({ error: 'Template ID is required' })
      }

      const template = await prisma.campaignTemplate.findFirst({
        where: {
          id,
          OR: [
            { createdById: userId }, // User's own template
            { isPublic: true }       // Public template
          ]
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          brand: {
            select: {
              id: true,
              name: true
            }
          }
        }
      })

      if (!template) {
        return reply.code(404).send({ error: 'Template not found or access denied' })
      }

      return reply.send({
        success: true,
        template: {
          id: template.id,
          name: template.name,
          description: template.description,
          isPublic: template.isPublic,
          templateConfig: template.templateConfig,
          usageCount: template.usageCount,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt,
          createdBy: template.createdBy,
          brand: template.brand,
          isOwned: template.createdById === userId
        }
      })
    } catch (error) {
      console.error('Get template error:', error)
      
      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
      }
      
      return reply.code(500).send({ 
        error: 'Failed to retrieve template. Please try again.' 
      })
    }
  })

  // Update template
  fastify.put<{ 
    Params: { id: string },
    Body: UpdateTemplateBody
  }>('/:id', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { id } = request.params
      const updates = request.body

      if (!id) {
        return reply.code(400).send({ error: 'Template ID is required' })
      }

      // Validate at least one field is provided
      if (!updates.name && !updates.description && updates.isPublic === undefined && !updates.templateConfig) {
        return reply.code(400).send({ error: 'At least one field must be provided for update' })
      }

      // Check if template exists and user owns it
      const existingTemplate = await prisma.campaignTemplate.findFirst({
        where: { 
          id,
          createdById: userId // Only owner can update
        }
      })

      if (!existingTemplate) {
        return reply.code(404).send({ error: 'Template not found or access denied' })
      }

      // Validate name if provided
      if (updates.name !== undefined) {
        if (!updates.name || updates.name.trim().length === 0) {
          return reply.code(400).send({ error: 'Template name cannot be empty' })
        }
        if (updates.name.length > 100) {
          return reply.code(400).send({ error: 'Template name must be less than 100 characters' })
        }
      }

      // Validate template configuration if provided
      if (updates.templateConfig) {
        const currentConfig = existingTemplate.templateConfig as any
        const newConfig = { ...currentConfig, ...updates.templateConfig }
        
        const { frequency, themes, style, postingTime } = newConfig
        if (!frequency || !themes || !style || !postingTime) {
          return reply.code(400).send({ 
            error: 'Template configuration must include frequency, themes, style, and postingTime' 
          })
        }

        if (!Array.isArray(themes) || themes.length === 0) {
          return reply.code(400).send({ error: 'At least one theme is required' })
        }
      }

      // Prepare update data
      const updateData: any = {}
      if (updates.name !== undefined) updateData.name = updates.name.trim()
      if (updates.description !== undefined) updateData.description = updates.description?.trim() || null
      if (updates.isPublic !== undefined) updateData.isPublic = updates.isPublic
      if (updates.templateConfig) {
        const currentConfig = existingTemplate.templateConfig as any
        updateData.templateConfig = { ...currentConfig, ...updates.templateConfig }
      }

      // Update the template
      const updatedTemplate = await prisma.campaignTemplate.update({
        where: { id },
        data: updateData,
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          brand: {
            select: {
              id: true,
              name: true
            }
          }
        }
      })

      return reply.send({
        success: true,
        message: 'Template updated successfully',
        template: {
          id: updatedTemplate.id,
          name: updatedTemplate.name,
          description: updatedTemplate.description,
          isPublic: updatedTemplate.isPublic,
          templateConfig: updatedTemplate.templateConfig,
          usageCount: updatedTemplate.usageCount,
          createdAt: updatedTemplate.createdAt,
          updatedAt: updatedTemplate.updatedAt,
          createdBy: updatedTemplate.createdBy,
          brand: updatedTemplate.brand
        }
      })
    } catch (error) {
      console.error('Update template error:', error)
      
      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
        if (error.message.includes('Unique constraint')) {
          return reply.code(400).send({ error: 'A template with this name already exists' })
        }
      }
      
      return reply.code(500).send({ 
        error: 'Failed to update template. Please try again.' 
      })
    }
  })

  // Delete template
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { id } = request.params

      if (!id) {
        return reply.code(400).send({ error: 'Template ID is required' })
      }

      // Check if template exists and user owns it
      const template = await prisma.campaignTemplate.findFirst({
        where: { 
          id,
          createdById: userId // Only owner can delete
        }
      })

      if (!template) {
        return reply.code(404).send({ error: 'Template not found or access denied' })
      }

      // Delete the template
      await prisma.campaignTemplate.delete({
        where: { id }
      })

      return reply.send({
        success: true,
        message: 'Template deleted successfully',
        deletedTemplate: {
          id: template.id,
          name: template.name,
          usageCount: template.usageCount
        }
      })
    } catch (error) {
      console.error('Delete template error:', error)
      
      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
      }
      
      return reply.code(500).send({ 
        error: 'Failed to delete template. Please try again.' 
      })
    }
  })

  // Apply template to create campaign
  fastify.post<{ 
    Params: { id: string },
    Body: ApplyTemplateBody
  }>('/:id/apply', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { id } = request.params
      const { name, brandId, duration, overrides } = request.body

      if (!id) {
        return reply.code(400).send({ error: 'Template ID is required' })
      }

      if (!name || !brandId || !duration) {
        return reply.code(400).send({ 
          error: 'Campaign name, brand ID, and duration are required' 
        })
      }

      // Get template (must be owned by user or public)
      const template = await prisma.campaignTemplate.findFirst({
        where: {
          id,
          OR: [
            { createdById: userId },
            { isPublic: true }
          ]
        }
      })

      if (!template) {
        return reply.code(404).send({ error: 'Template not found or access denied' })
      }

      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId
        }
      })

      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found or access denied' })
      }

      // Build campaign configuration from template
      const templateConfig = template.templateConfig as any
      const campaignConfig: CampaignConfig = {
        name,
        brandId,
        duration: {
          start: new Date(duration.start),
          end: new Date(duration.end)
        },
        frequency: overrides?.frequency || templateConfig.frequency,
        themes: overrides?.themes || templateConfig.themes,
        style: overrides?.style || templateConfig.style,
        postingTime: overrides?.postingTime || templateConfig.postingTime
      }

      // Validate campaign configuration
      const validationErrors = campaignService.validateCampaignConfig(campaignConfig)
      
      if (validationErrors.length > 0) {
        return reply.code(400).send({ 
          error: 'Validation failed',
          details: validationErrors
        })
      }

      // Create campaign using the service
      const campaign = await campaignService.configureCampaign(campaignConfig, userId)

      // Increment template usage count
      await prisma.campaignTemplate.update({
        where: { id },
        data: {
          usageCount: {
            increment: 1
          }
        }
      })

      return reply.code(201).send({
        success: true,
        campaign: {
          id: campaign.id,
          name: campaign.name,
          brandId: campaign.brandId,
          status: campaign.status,
          config: campaign.config,
          createdAt: campaign.createdAt,
          brand: campaign.brand
        },
        appliedTemplate: {
          id: template.id,
          name: template.name
        }
      })
    } catch (error) {
      console.error('Apply template error:', error)
      
      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
        if (error.message.includes('start date') || error.message.includes('end date')) {
          return reply.code(400).send({ error: error.message })
        }
      }
      
      return reply.code(500).send({ 
        error: 'Failed to apply template. Please try again.' 
      })
    }
  })

  // Save campaign as template
  fastify.post<{ 
    Params: { id: string },
    Body: SaveCampaignAsTemplateBody
  }>('/campaigns/:id/save-template', async (request, reply) => {
    try {
      const userId = await authenticateRequest(request)
      const { id } = request.params
      const { name, description, isPublic = false, brandId } = request.body

      if (!id) {
        return reply.code(400).send({ error: 'Campaign ID is required' })
      }

      if (!name || name.trim().length === 0) {
        return reply.code(400).send({ error: 'Template name is required' })
      }

      if (name.length > 100) {
        return reply.code(400).send({ error: 'Template name must be less than 100 characters' })
      }

      // Get campaign and verify ownership
      const campaign = await prisma.campaign.findFirst({
        where: {
          id,
          brand: {
            userId
          }
        },
        include: {
          brand: true
        }
      })

      if (!campaign) {
        return reply.code(404).send({ error: 'Campaign not found or access denied' })
      }

      // Verify brand ownership if brandId provided
      if (brandId) {
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId
          }
        })

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found or access denied' })
        }
      }

      // Extract template configuration from campaign
      const campaignConfig = campaign.config as any
      const templateConfig = {
        frequency: campaignConfig.frequency,
        themes: campaignConfig.themes,
        style: campaignConfig.style,
        postingTime: campaignConfig.postingTime,
        // Note: We don't save duration as it's campaign-specific
      }

      // Create template
      const template = await prisma.campaignTemplate.create({
        data: {
          name: name.trim(),
          description: description?.trim() || null,
          isPublic,
          templateConfig,
          createdById: userId,
          brandId: brandId || campaign.brandId
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          brand: {
            select: {
              id: true,
              name: true
            }
          }
        }
      })

      return reply.code(201).send({
        success: true,
        message: 'Campaign saved as template successfully',
        template: {
          id: template.id,
          name: template.name,
          description: template.description,
          isPublic: template.isPublic,
          templateConfig: template.templateConfig,
          usageCount: template.usageCount,
          createdAt: template.createdAt,
          createdBy: template.createdBy,
          brand: template.brand
        },
        sourceCampaign: {
          id: campaign.id,
          name: campaign.name
        }
      })
    } catch (error) {
      console.error('Save campaign as template error:', error)
      
      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message })
        }
        if (error.message.includes('Unique constraint')) {
          return reply.code(400).send({ error: 'A template with this name already exists' })
        }
      }
      
      return reply.code(500).send({ 
        error: 'Failed to save campaign as template. Please try again.' 
      })
    }
  })
}

export default campaignTemplatesRoutes