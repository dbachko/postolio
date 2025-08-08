import { PrismaClient } from '@prisma/client'
import { generateInstagramContent, type ContentGenerationRequest, type GeneratedContent } from './content-generator.js'
import { schedulerService } from './scheduler.js'
import { campaignJobService } from './campaign-jobs.js'
import { campaignCoordinationService, type CampaignConfigWithPriority } from './campaign-coordination.js'
import type { StyleProfile } from './ai.js'

const prisma = new PrismaClient()

export interface CampaignConfig {
  name: string
  brandId: string
  duration: {
    start: Date
    end: Date
  }
  frequency: string // 'daily', 'every2days', '3weekly', etc.
  themes: string[]
  style: string
  postingTime: string // HH:MM format
  priority?: number // 1=highest, 5=normal, 10=lowest
}

export interface CampaignPreview {
  campaignId: string
  examplePosts: GeneratedContent[]
  estimatedPostCount: number
  schedule: {
    frequency: string
    duration: number // days
    totalPosts: number
  }
}

export interface CampaignStartResult {
  success: boolean
  campaign?: any
  scheduledPosts?: number
  error?: string
}

class CampaignService {
  /**
   * Create and save campaign configuration
   */
  async configureCampaign(config: CampaignConfig, userId: string): Promise<any> {
    try {
      // Validate brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: config.brandId,
          userId,
        },
      })

      if (!brand) {
        throw new Error('Brand not found or access denied')
      }

      // Validate dates
      if (config.duration.start >= config.duration.end) {
        throw new Error('Campaign start date must be before end date')
      }

      // Allow today's date as valid start date - compare in local timezone
      const today = new Date()
      const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate())

      // Get the start date components from UTC and create a local date for comparison
      const startUTC = config.duration.start
      const startLocal = new Date(startUTC.getUTCFullYear(), startUTC.getUTCMonth(), startUTC.getUTCDate())

      if (startLocal < todayLocal) {
        throw new Error('Campaign start date cannot be in the past')
      }

      // Check for scheduling conflicts with other campaigns
      const coordinationConfig: CampaignConfigWithPriority = {
        name: config.name,
        brandId: config.brandId,
        config: {
          duration: {
            start: config.duration.start.toISOString(),
            end: config.duration.end.toISOString(),
          },
          frequency: config.frequency,
          postingTime: config.postingTime,
          themes: config.themes,
        },
        priority: config.priority || 5,
      }

      const conflicts = await campaignCoordinationService.detectSchedulingConflicts(coordinationConfig, userId)

      // Store conflicts for frontend display but allow campaign creation
      const conflictSummary =
        conflicts.length > 0
          ? {
              hasConflicts: true,
              conflictCount: conflicts.length,
              conflicts: conflicts.map((c) => ({
                type: c.conflictType,
                severity: c.severity,
                details: c.details,
              })),
            }
          : { hasConflicts: false, conflictCount: 0, conflicts: [] }

      // Calculate estimated post count
      const durationDays = Math.ceil(
        (config.duration.end.getTime() - config.duration.start.getTime()) / (1000 * 60 * 60 * 24)
      )

      let postsPerWeek = 1
      switch (config.frequency) {
        case 'daily':
          postsPerWeek = 7
          break
        case 'every2days':
          postsPerWeek = 3.5 // Every 2 days = 3.5 posts per week
          break
        case '3weekly':
          postsPerWeek = 3
          break
        default:
          postsPerWeek = 1
      }

      const estimatedPosts = Math.ceil((durationDays / 7) * postsPerWeek)

      // Create campaign with 'creating' status
      const campaign = await prisma.campaign.create({
        data: {
          name: config.name,
          brandId: config.brandId,
          status: 'creating',
          priority: config.priority || 5,
          progress: 0,
          previewGenerated: false,
          config: {
            duration: {
              start: config.duration.start.toISOString(),
              end: config.duration.end.toISOString(),
            },
            frequency: config.frequency,
            themes: config.themes,
            style: config.style,
            postingTime: config.postingTime,
            estimatedPosts,
            durationDays,
            conflicts: conflictSummary,
          },
        },
        include: {
          brand: {
            select: {
              id: true,
              name: true,
              styleProfile: true,
            },
          },
        },
      })

      // Start async preview generation
      campaignJobService.startCampaignPreviewGeneration(campaign.id, userId)

      return campaign
    } catch (error) {
      console.error('Campaign configuration error:', error)
      throw error
    }
  }

  /**
   * Generate preview posts for a campaign
   */
  async generateCampaignPreview(campaignId: string, userId: string, exampleCount = 3): Promise<CampaignPreview> {
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
              styleProfile: true,
            },
          },
        },
      })

      if (!campaign) {
        throw new Error('Campaign not found or access denied')
      }

      const config = campaign.config as any
      const styleProfile = campaign.brand.styleProfile as unknown as StyleProfile

      if (!styleProfile) {
        throw new Error('Brand style profile not found. Please analyze your brand first.')
      }

      // Generate example content using themes from campaign config
      const contentRequests: ContentGenerationRequest[] = config.themes.map((theme: string) => ({
        brandId: campaign.brandId,
        count: 1,
        theme,
        style: config.style,
      }))

      // Take first N themes for preview
      const previewRequests = contentRequests.slice(0, exampleCount)

      let examplePosts: GeneratedContent[] = []

      for (const request of previewRequests) {
        const content = await generateInstagramContent(styleProfile, campaign.brand.name, request)
        examplePosts.push(...content)
      }

      // If we have fewer posts than requested, generate more with the first theme
      while (examplePosts.length < exampleCount && config.themes.length > 0) {
        const additionalContent = await generateInstagramContent(styleProfile, campaign.brand.name, {
          brandId: campaign.brandId,
          count: 1,
          theme: config.themes[0],
          style: config.style,
        })
        examplePosts.push(...additionalContent)
      }

      // Trim to exact count requested
      examplePosts = examplePosts.slice(0, exampleCount)

      // Check if preview posts already exist for this campaign
      const existingPreviews = await prisma.content.findMany({
        where: {
          campaignId: campaignId,
          // Look for posts that are preview posts (not scheduled yet)
          scheduledAt: null,
        },
      })

      // Delete existing preview posts to replace them with new ones
      if (existingPreviews.length > 0) {
        await prisma.content.deleteMany({
          where: {
            id: {
              in: existingPreviews.map((p) => p.id),
            },
          },
        })
      }

      // Save new preview posts to database
      const savedPosts = []
      for (const post of examplePosts) {
        // Validate post data before saving
        if (!post.caption || post.caption.trim().length === 0) {
          console.error('Attempting to save content with empty caption:', post)
          throw new Error('Cannot save content with empty caption')
        }
        if (!post.hashtags || !Array.isArray(post.hashtags)) {
          console.error('Attempting to save content with invalid hashtags:', post)
          throw new Error('Cannot save content with invalid hashtags')
        }

        const savedPost = await prisma.content.create({
          data: {
            caption: post.caption,
            hashtags: post.hashtags,
            imageUrl: post.imageUrl ?? null,
            brandId: campaign.brandId,
            campaignId: campaignId,
            status: 'pending', // Preview posts start as pending
            generationParams: {
              theme: config.themes?.[0] || 'preview',
              style: config.style,
              campaignGenerated: true,
              isPreview: true,
            },
          },
        })
        savedPosts.push({
          ...post,
          id: savedPost.id,
          status: savedPost.status,
          createdAt: savedPost.createdAt,
        })
      }

      return {
        campaignId,
        examplePosts: savedPosts,
        estimatedPostCount: config.estimatedPosts,
        schedule: {
          frequency: config.frequency,
          duration: config.durationDays,
          totalPosts: config.estimatedPosts,
        },
      }
    } catch (error) {
      console.error('Campaign preview error:', error)
      throw error
    }
  }

  /**
   * Start campaign - generate all content and schedule posts
   */
  async startCampaign(campaignId: string, userId: string): Promise<CampaignStartResult> {
    try {
      // Get campaign and validate
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          brand: {
            userId,
          },
          status: 'preview',
        },
        include: {
          brand: {
            select: {
              id: true,
              name: true,
              styleProfile: true,
            },
          },
        },
      })

      if (!campaign) {
        return {
          success: false,
          error: 'Campaign not found, access denied, or not ready for launch',
        }
      }

      const config = campaign.config as any
      const styleProfile = campaign.brand.styleProfile as unknown as StyleProfile

      if (!styleProfile) {
        return {
          success: false,
          error: 'Brand style profile not found. Please analyze your brand first.',
        }
      }

      // Generate posting schedule
      const postDates = this.generatePostingSchedule(
        new Date(config.duration.start),
        new Date(config.duration.end),
        config.frequency,
        config.postingTime
      )

      // Get existing preview posts for this campaign
      const existingPreviews = await prisma.content.findMany({
        where: {
          campaignId: campaignId,
          scheduledAt: null, // Preview posts don't have scheduled dates yet
        },
        orderBy: {
          createdAt: 'asc',
        },
      })

      const themes = config.themes as string[]
      const createdContent = []
      let existingPostIndex = 0

      // Schedule existing preview posts first, then generate additional content if needed
      for (let i = 0; i < postDates.length; i++) {
        const scheduledDate = postDates[i]
        let content

        if (existingPostIndex < existingPreviews.length) {
          // Use existing preview post
          const existingPost = existingPreviews[existingPostIndex]
          if (existingPost) {
            content = await prisma.content.update({
              where: { id: existingPost.id },
              data: {
                status: 'approved', // Auto-approve campaign content
                scheduledAt: scheduledDate ?? null,
                generationParams: {
                  ...((existingPost?.generationParams as any) || {}),
                  campaignGenerated: true,
                  isPreview: false, // No longer a preview
                },
              },
            })
            existingPostIndex++
          } else {
            continue
          }
        } else {
          // Generate new content for remaining slots
          const theme = themes[i % themes.length]

          const generatedContent = await generateInstagramContent(styleProfile, campaign.brand.name, {
            brandId: campaign.brandId,
            count: 1,
            theme,
            style: config.style,
          })

          const contentData = generatedContent[0]

          // Validate generated content before saving
          if (!contentData?.caption || contentData.caption.trim().length === 0) {
            console.error('Generated content has empty caption:', contentData)
            throw new Error('Generated content has empty caption')
          }
          if (!contentData?.hashtags || !Array.isArray(contentData.hashtags)) {
            console.error('Generated content has invalid hashtags:', contentData)
            throw new Error('Generated content has invalid hashtags')
          }

          content = await prisma.content.create({
            data: {
              caption: contentData.caption,
              hashtags: contentData.hashtags,
              imageUrl: contentData.imageUrl ?? null,
              brandId: campaign.brandId,
              campaignId: campaignId,
              status: 'approved', // Auto-approve campaign content
              scheduledAt: scheduledDate ?? null,
              generationParams: {
                theme,
                style: config.style,
                campaignGenerated: true,
              },
            },
          })
        }

        // Schedule the post
        await schedulerService.scheduleContent(content.id, scheduledDate)
        createdContent.push(content)
      }

      // Update campaign status
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'active',
          startedAt: new Date(),
        },
      })

      return {
        success: true,
        campaign: updatedCampaign,
        scheduledPosts: createdContent.length,
      }
    } catch (error) {
      console.error('Campaign start error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start campaign',
      }
    }
  }

  /**
   * Get campaign details
   */
  async getCampaign(campaignId: string, userId: string): Promise<any> {
    try {
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
          content: {
            select: {
              id: true,
              caption: true,
              hashtags: true,
              imageUrl: true,
              status: true,
              scheduledAt: true,
              postedAt: true,
              createdAt: true,
            },
            orderBy: {
              scheduledAt: 'asc',
            },
          },
          _count: {
            select: {
              content: true,
            },
          },
        },
      })

      if (!campaign) {
        throw new Error('Campaign not found or access denied')
      }

      return campaign
    } catch (error) {
      console.error('Get campaign error:', error)
      throw error
    }
  }

  /**
   * Generate posting schedule based on frequency and duration
   */
  private generatePostingSchedule(startDate: Date, endDate: Date, frequency: string, postingTime: string): Date[] {
    const schedule: Date[] = []
    const [hours, minutes] = postingTime.split(':').map(Number)

    const current = new Date(startDate)
    current.setHours(hours ?? 0, minutes ?? 0, 0, 0)

    while (current <= endDate) {
      schedule.push(new Date(current))

      // Increment based on frequency
      switch (frequency) {
        case 'daily':
          current.setDate(current.getDate() + 1)
          break
        case 'every2days':
          current.setDate(current.getDate() + 2)
          break
        case '3weekly':
          // Post every 2-3 days (Monday, Wednesday, Friday pattern)
          const dayOfWeek = current.getDay()
          if (dayOfWeek === 1) {
            // Monday -> Wednesday
            current.setDate(current.getDate() + 2)
          } else if (dayOfWeek === 3) {
            // Wednesday -> Friday
            current.setDate(current.getDate() + 2)
          } else {
            // Friday -> Monday
            current.setDate(current.getDate() + 3)
          }
          break
        default:
          current.setDate(current.getDate() + 7)
      }
    }

    return schedule
  }

  /**
   * Update campaign configuration
   */
  async updateCampaign(
    campaignId: string,
    userId: string,
    updates: {
      name?: string
      themes?: string[]
      style?: string
      frequency?: string
      postingTime?: string
      startDate?: string
      endDate?: string
    }
  ): Promise<any> {
    try {
      // Get campaign and validate ownership and status
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

      // Only allow editing campaigns that are not active
      if (campaign.status === 'active') {
        throw new Error('Active campaigns cannot be updated. Please pause the campaign first.')
      }

      // Prepare the updated config
      const currentConfig = campaign.config as any
      const updatedConfig = { ...currentConfig }

      // Update basic fields
      if (updates.name !== undefined) {
        if (!updates.name.trim()) {
          throw new Error('Campaign name cannot be empty')
        }
      }

      if (updates.themes !== undefined) {
        if (!Array.isArray(updates.themes) || updates.themes.length === 0) {
          throw new Error('At least one theme is required')
        }
        updatedConfig.themes = updates.themes
      }

      if (updates.style !== undefined) {
        updatedConfig.style = updates.style
      }

      if (updates.frequency !== undefined) {
        if (!['daily', 'every2days', '3weekly'].includes(updates.frequency)) {
          throw new Error('Invalid frequency. Must be daily, every2days, or 3weekly')
        }
        updatedConfig.frequency = updates.frequency
      }

      if (updates.postingTime !== undefined) {
        if (!/^\d{2}:\d{2}$/.test(updates.postingTime)) {
          throw new Error('Posting time must be in HH:MM format')
        }
        updatedConfig.postingTime = updates.postingTime
      }

      // Update dates if provided
      if (updates.startDate !== undefined || updates.endDate !== undefined) {
        const startDate = updates.startDate ? new Date(updates.startDate) : new Date(currentConfig.duration.start)
        const endDate = updates.endDate ? new Date(updates.endDate) : new Date(currentConfig.duration.end)

        // Validate dates
        if (endDate <= startDate) {
          throw new Error('End date must be after start date')
        }

        const today = new Date()
        const todayDateString = today.toISOString().split('T')[0]
        const startDateString = startDate.toISOString().split('T')[0]

        if (campaign.status !== 'active' && startDateString && todayDateString && startDateString < todayDateString) {
          throw new Error('Start date cannot be in the past')
        }

        updatedConfig.duration = {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        }

        // Recalculate estimated posts
        const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        let postsPerWeek = 1
        switch (updatedConfig.frequency) {
          case 'daily':
            postsPerWeek = 7
            break
          case 'every2days':
            postsPerWeek = 3.5
            break
          case '3weekly':
            postsPerWeek = 3
            break
        }
        updatedConfig.estimatedPosts = Math.ceil((durationDays / 7) * postsPerWeek)
        updatedConfig.durationDays = durationDays
      }

      // Update the campaign
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          name: updates.name !== undefined ? updates.name : campaign.name,
          config: updatedConfig,
          updatedAt: new Date(),
        },
        include: {
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
          content: {
            select: {
              id: true,
              caption: true,
              hashtags: true,
              imageUrl: true,
              status: true,
              scheduledAt: true,
              postedAt: true,
              createdAt: true,
            },
            orderBy: {
              scheduledAt: 'asc',
            },
          },
          _count: {
            select: {
              content: true,
            },
          },
        },
      })

      console.log(`Campaign ${campaignId} updated successfully`)
      return updatedCampaign
    } catch (error) {
      console.error('Update campaign error:', error)
      throw error
    }
  }

  /**
   * Update campaign priority and check for new conflicts
   */
  async updateCampaignPriority(campaignId: string, newPriority: number, userId: string): Promise<any> {
    try {
      // Get the campaign and verify ownership
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          brand: { userId },
        },
        include: { brand: true },
      })

      if (!campaign) {
        throw new Error('Campaign not found or access denied')
      }

      // Update priority
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaignId },
        data: { priority: newPriority },
        include: {
          brand: true,
          content: true,
        },
      })

      // Re-check conflicts with new priority
      const config = campaign.config as any
      const coordinationConfig: CampaignConfigWithPriority = {
        name: campaign.name,
        brandId: campaign.brandId,
        config: {
          duration: config.duration,
          frequency: config.frequency,
          postingTime: config.postingTime,
          themes: config.themes,
        },
        priority: newPriority,
      }

      const conflicts = await campaignCoordinationService.detectSchedulingConflicts(coordinationConfig, userId)

      // Update campaign config with new conflict information
      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          config: {
            ...config,
            conflicts:
              conflicts.length > 0
                ? {
                    hasConflicts: true,
                    conflictCount: conflicts.length,
                    conflicts: conflicts.map((c) => ({
                      type: c.conflictType,
                      severity: c.severity,
                      details: c.details,
                    })),
                  }
                : { hasConflicts: false, conflictCount: 0, conflicts: [] },
          },
        },
      })

      return updatedCampaign
    } catch (error) {
      console.error('Update campaign priority error:', error)
      throw error
    }
  }

  /**
   * Get campaign coordination summary for a user
   */
  async getCampaignCoordination(userId: string): Promise<any> {
    try {
      // Get resource allocation
      const allocation = await campaignCoordinationService.allocateGenerationResources(userId)

      // Get active campaigns with priorities
      const activeCampaigns = await prisma.campaign.findMany({
        where: {
          brand: { userId },
          status: { in: ['active', 'preview'] },
        },
        include: { brand: true },
        orderBy: { priority: 'asc' },
      })

      return {
        activeCampaigns: activeCampaigns.length,
        resourceAllocation: allocation,
        campaignsByPriority: activeCampaigns.reduce(
          (acc, campaign) => {
            const priority = campaign.priority || 5
            acc[priority] = (acc[priority] || 0) + 1
            return acc
          },
          {} as Record<number, number>
        ),
        conflicts: activeCampaigns.reduce((total, campaign) => {
          const config = campaign.config as any
          return total + (config.conflicts?.conflictCount || 0)
        }, 0),
      }
    } catch (error) {
      console.error('Get campaign coordination error:', error)
      throw error
    }
  }

  /**
   * Validate campaign configuration
   */
  validateCampaignConfig(config: CampaignConfig): string[] {
    const errors: string[] = []

    if (!config.name || config.name.trim().length === 0) {
      errors.push('Campaign name is required')
    }

    if (config.name && config.name.length > 100) {
      errors.push('Campaign name must be less than 100 characters')
    }

    if (!config.brandId) {
      errors.push('Brand ID is required')
    }

    if (!config.duration.start || !config.duration.end) {
      errors.push('Campaign start and end dates are required')
    }

    if (config.duration.start >= config.duration.end) {
      errors.push('Campaign start date must be before end date')
    }

    // Date comparison - allow campaigns to start from today onwards
    // Parse dates properly handling UTC vs local timezone
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()) // Today at 00:00 local

    // Parse the start date and extract just the date part (ignore time/timezone)
    const startDateStr = config.duration.start.toISOString().split('T')[0] // "2025-08-07"
    if (startDateStr) {
      const dateParts = startDateStr.split('-').map(Number)
      if (dateParts.length === 3 && dateParts.every((part) => !isNaN(part))) {
        const [year, month, day] = dateParts as [number, number, number]
        const startDateLocal = new Date(year, month - 1, day) // Create local date (month is 0-based)

        if (startDateLocal < today) {
          errors.push('Campaign start date cannot be in the past')
        }
      }
    }

    if (!['daily', 'every2days', '3weekly'].includes(config.frequency)) {
      errors.push('Invalid frequency. Must be daily, every2days, or 3weekly')
    }

    if (!config.themes || config.themes.length === 0) {
      errors.push('At least one theme is required')
    }

    if (!config.postingTime || !/^\d{2}:\d{2}$/.test(config.postingTime)) {
      errors.push('Posting time must be in HH:MM format')
    }

    return errors
  }
}

export const campaignService = new CampaignService()
