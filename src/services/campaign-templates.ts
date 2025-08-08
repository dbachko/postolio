import { PrismaClient, Prisma } from '@prisma/client'
import type { CampaignConfig } from './campaign.js'

const prisma = new PrismaClient()

export interface CampaignTemplateConfig {
  duration?: {
    days?: number // Duration in days instead of specific dates
  }
  frequency: string // 'daily', 'every2days', '3weekly', etc.
  themes: string[]
  style: string
  postingTime: string // HH:MM format
}

export interface CreateTemplateData {
  name: string
  description?: string
  isPublic?: boolean
  templateConfig: CampaignTemplateConfig
  brandId?: string // Optional - templates can be brand-specific or generic
}

export interface UpdateTemplateData {
  name?: string
  description?: string
  isPublic?: boolean
  templateConfig?: CampaignTemplateConfig
}

export interface TemplateFilters {
  isPublic?: boolean
  brandId?: string
  search?: string
  limit?: number
  offset?: number
}

export interface ApplyTemplateData {
  templateId: string
  campaignName: string
  brandId: string
  duration: {
    start: Date
    end: Date
  }
  overrides?: {
    themes?: string[]
    style?: string
    frequency?: string
    postingTime?: string
  }
}

class CampaignTemplatesService {
  /**
   * Create a new campaign template
   */
  async createTemplate(data: CreateTemplateData, userId: string): Promise<any> {
    try {
      // Validate template config
      const validationErrors = this.validateTemplateConfig(data.templateConfig)
      if (validationErrors.length > 0) {
        throw new Error(`Template validation failed: ${validationErrors.join(', ')}`)
      }

      // If brandId is provided, validate brand ownership
      if (data.brandId) {
        const brand = await prisma.brand.findFirst({
          where: {
            id: data.brandId,
            userId,
          },
        })

        if (!brand) {
          throw new Error('Brand not found or access denied')
        }
      }

      // Validate template name
      if (!data.name || data.name.trim().length === 0) {
        throw new Error('Template name is required')
      }

      if (data.name.length > 100) {
        throw new Error('Template name must be less than 100 characters')
      }

      // Check for duplicate template names for this user
      const existingTemplate = await prisma.campaignTemplate.findFirst({
        where: {
          name: data.name.trim(),
          createdById: userId,
          brandId: data.brandId || null,
        },
      })

      if (existingTemplate) {
        throw new Error('A template with this name already exists')
      }

      const template = await prisma.campaignTemplate.create({
        data: {
          name: data.name.trim(),
          description: data.description !== undefined ? data.description?.trim() || null : null,
          isPublic: data.isPublic || false,
          templateConfig: data.templateConfig as unknown as Prisma.InputJsonValue,
          createdById: userId,
          brandId: data.brandId || null,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })

      console.log(`Campaign template ${template.id} created successfully`)
      return template
    } catch (error) {
      console.error('Create template error:', error)
      throw error
    }
  }

  /**
   * Get templates with filtering options
   */
  async getTemplates(
    userId: string,
    filters: TemplateFilters = {}
  ): Promise<{
    templates: any[]
    total: number
  }> {
    try {
      const where: any = {
        OR: [
          { createdById: userId }, // User's own templates
          { isPublic: true }, // Public templates
        ],
      }

      // Apply filters
      if (filters.brandId !== undefined) {
        where.brandId = filters.brandId
      }

      if (filters.isPublic !== undefined) {
        where.isPublic = filters.isPublic
      }

      if (filters.search) {
        where.AND = [
          {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' } },
              { description: { contains: filters.search, mode: 'insensitive' } },
            ],
          },
        ]
      }

      const [templates, total] = await Promise.all([
        prisma.campaignTemplate.findMany({
          where,
          include: {
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            brand: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: [
            { usageCount: 'desc' }, // Popular templates first
            { createdAt: 'desc' },
          ],
          take: filters.limit || 50,
          skip: filters.offset || 0,
        }),
        prisma.campaignTemplate.count({ where }),
      ])

      return { templates, total }
    } catch (error) {
      console.error('Get templates error:', error)
      throw error
    }
  }

  /**
   * Get a single template by ID
   */
  async getTemplate(templateId: string, userId: string): Promise<any> {
    try {
      const template = await prisma.campaignTemplate.findFirst({
        where: {
          id: templateId,
          OR: [
            { createdById: userId }, // User's own template
            { isPublic: true }, // Public template
          ],
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })

      if (!template) {
        throw new Error('Template not found or access denied')
      }

      return template
    } catch (error) {
      console.error('Get template error:', error)
      throw error
    }
  }

  /**
   * Update a template (only by owner)
   */
  async updateTemplate(templateId: string, userId: string, updates: UpdateTemplateData): Promise<any> {
    try {
      // Get template and validate ownership
      const template = await prisma.campaignTemplate.findFirst({
        where: {
          id: templateId,
          createdById: userId, // Only owner can update
        },
      })

      if (!template) {
        throw new Error('Template not found or access denied')
      }

      // Validate updates
      if (updates.name !== undefined) {
        if (!updates.name.trim()) {
          throw new Error('Template name cannot be empty')
        }
        if (updates.name.length > 100) {
          throw new Error('Template name must be less than 100 characters')
        }

        // Check for duplicate names (excluding current template)
        const existingTemplate = await prisma.campaignTemplate.findFirst({
          where: {
            name: updates.name.trim(),
            createdById: userId,
            id: { not: templateId },
          },
        })

        if (existingTemplate) {
          throw new Error('A template with this name already exists')
        }
      }

      if (updates.templateConfig) {
        const validationErrors = this.validateTemplateConfig(updates.templateConfig)
        if (validationErrors.length > 0) {
          throw new Error(`Template validation failed: ${validationErrors.join(', ')}`)
        }
      }

      // Only include fields that are defined
      const updateData: any = { updatedAt: new Date() }
      if (updates.name !== undefined) updateData.name = updates.name.trim()
      if (updates.description !== undefined) updateData.description = updates.description?.trim() || null
      if (updates.isPublic !== undefined) updateData.isPublic = updates.isPublic
      if (updates.templateConfig !== undefined)
        updateData.templateConfig = updates.templateConfig as unknown as Prisma.InputJsonValue

      const updatedTemplate = await prisma.campaignTemplate.update({
        where: { id: templateId },
        data: updateData,
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })

      console.log(`Template ${templateId} updated successfully`)
      return updatedTemplate
    } catch (error) {
      console.error('Update template error:', error)
      throw error
    }
  }

  /**
   * Delete a template (only by owner)
   */
  async deleteTemplate(templateId: string, userId: string): Promise<boolean> {
    try {
      // Get template and validate ownership
      const template = await prisma.campaignTemplate.findFirst({
        where: {
          id: templateId,
          createdById: userId, // Only owner can delete
        },
      })

      if (!template) {
        throw new Error('Template not found or access denied')
      }

      await prisma.campaignTemplate.delete({
        where: { id: templateId },
      })

      console.log(`Template ${templateId} deleted successfully`)
      return true
    } catch (error) {
      console.error('Delete template error:', error)
      throw error
    }
  }

  /**
   * Apply a template to create a campaign configuration
   */
  async applyTemplate(data: ApplyTemplateData, userId: string): Promise<CampaignConfig> {
    try {
      // Get template and validate access
      const template = await this.getTemplate(data.templateId, userId)
      const templateConfig = template.templateConfig as CampaignTemplateConfig

      // Validate brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: data.brandId,
          userId,
        },
      })

      if (!brand) {
        throw new Error('Brand not found or access denied')
      }

      // Validate dates
      if (data.duration.start >= data.duration.end) {
        throw new Error('Campaign start date must be before end date')
      }

      const today = new Date()
      const todayDateString = today.toISOString().split('T')[0]
      const startDateString = data.duration.start?.toISOString().split('T')[0]

      if (startDateString && todayDateString && startDateString < todayDateString) {
        throw new Error('Campaign start date cannot be in the past')
      }

      // Increment usage count
      await prisma.campaignTemplate.update({
        where: { id: data.templateId },
        data: { usageCount: { increment: 1 } },
      })

      // Build campaign config from template with overrides
      const campaignConfig: CampaignConfig = {
        name: data.campaignName.trim(),
        brandId: data.brandId,
        duration: data.duration,
        frequency: data.overrides?.frequency || templateConfig.frequency,
        themes: data.overrides?.themes || templateConfig.themes,
        style: data.overrides?.style || templateConfig.style,
        postingTime: data.overrides?.postingTime || templateConfig.postingTime,
      }

      console.log(`Template ${data.templateId} applied to create campaign config`)
      return campaignConfig
    } catch (error) {
      console.error('Apply template error:', error)
      throw error
    }
  }

  /**
   * Save an existing campaign configuration as a template
   */
  async saveAsTemplate(
    campaignId: string,
    templateData: {
      name: string
      description?: string
      isPublic?: boolean
    },
    userId: string
  ): Promise<any> {
    try {
      // Get campaign and validate ownership
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          brand: {
            userId,
          },
        },
        include: {
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })

      if (!campaign) {
        throw new Error('Campaign not found or access denied')
      }

      const campaignConfig = campaign.config as any

      // Extract template config from campaign config
      const templateConfig: CampaignTemplateConfig = {
        frequency: campaignConfig.frequency,
        themes: campaignConfig.themes,
        style: campaignConfig.style,
        postingTime: campaignConfig.postingTime,
      }

      // If campaign has a duration, convert to days for template
      if (campaignConfig.duration && campaignConfig.durationDays) {
        templateConfig.duration = {
          days: campaignConfig.durationDays,
        }
      }

      // Create template
      const template = await this.createTemplate(
        {
          name: templateData.name,
          description: templateData.description !== undefined ? templateData.description : '',
          isPublic: templateData.isPublic || false,
          templateConfig,
          brandId: campaign.brandId,
        },
        userId
      )

      console.log(`Campaign ${campaignId} saved as template ${template.id}`)
      return template
    } catch (error) {
      console.error('Save as template error:', error)
      throw error
    }
  }

  /**
   * Validate template configuration
   */
  private validateTemplateConfig(config: CampaignTemplateConfig): string[] {
    const errors: string[] = []

    if (!['daily', 'every2days', '3weekly'].includes(config.frequency)) {
      errors.push('Invalid frequency. Must be daily, every2days, or 3weekly')
    }

    if (!config.themes || config.themes.length === 0) {
      errors.push('At least one theme is required')
    }

    if (!config.style || config.style.trim().length === 0) {
      errors.push('Style is required')
    }

    if (!config.postingTime || !/^\d{2}:\d{2}$/.test(config.postingTime)) {
      errors.push('Posting time must be in HH:MM format')
    }

    if (config.duration?.days !== undefined) {
      if (!Number.isInteger(config.duration.days) || config.duration.days <= 0) {
        errors.push('Duration days must be a positive integer')
      }
    }

    return errors
  }

  /**
   * Get popular public templates
   */
  async getPopularTemplates(limit = 10): Promise<any[]> {
    try {
      return await prisma.campaignTemplate.findMany({
        where: {
          isPublic: true,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      })
    } catch (error) {
      console.error('Get popular templates error:', error)
      throw error
    }
  }

  /**
   * Get templates created by user
   */
  async getUserTemplates(userId: string, limit = 50): Promise<any[]> {
    try {
      return await prisma.campaignTemplate.findMany({
        where: {
          createdById: userId,
        },
        include: {
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      })
    } catch (error) {
      console.error('Get user templates error:', error)
      throw error
    }
  }
}

export const campaignTemplatesService = new CampaignTemplatesService()
