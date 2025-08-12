import { PrismaClient } from '@prisma/client'
import { generateInstagramContent, type ContentGenerationRequest } from './content-generator.js'
import { schedulerService } from './scheduler.js'
import { analyzeBrandStyle } from './ai.js'
import type { StyleProfile } from './ai.js'

const prisma = new PrismaClient()

export interface QueueStatus {
  totalScheduled: number
  daysAhead: number
  needsGeneration: boolean
  minQueueSize: number
  maxQueueSize: number
}

export interface RollingGenerationConfig {
  minQueueSize: number // Minimum days ahead to maintain (e.g., 7)
  maxQueueSize: number // Maximum days ahead to generate (e.g., 14)  
  targetQueueSize: number // Target queue size (e.g., 10)
  batchSize: number // How many posts to generate at once (e.g., 3)
}

const DEFAULT_CONFIG: RollingGenerationConfig = {
  minQueueSize: 7,   // Always maintain 7 days ahead
  maxQueueSize: 14,  // Never generate more than 14 days ahead
  targetQueueSize: 10, // Target 10 days ahead
  batchSize: 3,      // Generate 3 posts at a time
}

class RollingContentService {
  private isProcessing = new Set<string>()

  /**
   * Trigger rolling content generation after a post is published
   */
  async onPostPublished(contentId: string): Promise<void> {
    try {
      // Get the published content with brand and campaign info
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        include: {
          brand: true,
          campaign: {
            include: {
              content: {
                where: {
                  status: { in: ['approved', 'scheduled', 'posted'] },
                  scheduledAt: { not: null }
                },
                orderBy: { scheduledAt: 'asc' }
              }
            }
          }
        }
      })

      if (!content || !content.brand) {
        console.log(`Content ${contentId} or brand not found for rolling generation`)
        return
      }

      console.log(`Post published for ${content.brand.name}, checking rolling generation needs...`)

      // Check if we need to generate more content
      await this.checkAndGenerateContent(content.brandId, content.campaignId)

    } catch (error) {
      console.error('Error in rolling content generation:', error)
    }
  }

  /**
   * Check content queue status and generate if needed
   */
  async checkAndGenerateContent(brandId: string, campaignId?: string | null): Promise<void> {
    // Prevent multiple simultaneous generations for the same brand
    if (this.isProcessing.has(brandId)) {
      console.log(`Rolling generation already in progress for brand: ${brandId}`)
      return
    }

    try {
      this.isProcessing.add(brandId)

      // Check queue status
      const queueStatus = await this.checkContentQueue(brandId)
      
      console.log(`Queue status for brand ${brandId}:`, {
        totalScheduled: queueStatus.totalScheduled,
        daysAhead: queueStatus.daysAhead,
        needsGeneration: queueStatus.needsGeneration,
        minRequired: queueStatus.minQueueSize
      })

      if (!queueStatus.needsGeneration) {
        console.log(`Brand ${brandId} has sufficient content (${queueStatus.daysAhead} days ahead)`)
        return
      }

      // Generate content to fill the gap
      await this.generateAndScheduleContent(brandId, campaignId, queueStatus)

    } finally {
      this.isProcessing.delete(brandId)
    }
  }

  /**
   * Check content queue status for a brand
   */
  private async checkContentQueue(brandId: string, config = DEFAULT_CONFIG): Promise<QueueStatus> {
    const now = new Date()
    const maxDate = new Date(now.getTime() + config.maxQueueSize * 24 * 60 * 60 * 1000)

    // Get all scheduled content for this brand in the next maxQueueSize days
    const scheduledContent = await prisma.content.findMany({
      where: {
        brandId,
        status: { in: ['approved', 'scheduled', 'posted'] },
        scheduledAt: {
          gte: now,
          lte: maxDate
        }
      },
      orderBy: { scheduledAt: 'asc' }
    })

    const totalScheduled = scheduledContent.length
    
    // Calculate days ahead (simple approximation)
    const daysAhead = totalScheduled > 0 ? 
      Math.ceil((scheduledContent[scheduledContent.length - 1].scheduledAt!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : 
      0

    return {
      totalScheduled,
      daysAhead,
      needsGeneration: daysAhead < config.minQueueSize,
      minQueueSize: config.minQueueSize,
      maxQueueSize: config.maxQueueSize
    }
  }

  /**
   * Generate and schedule new content to maintain queue
   */
  private async generateAndScheduleContent(
    brandId: string, 
    campaignId: string | null | undefined, 
    queueStatus: QueueStatus
  ): Promise<void> {
    try {
      // Get brand information and style profile
      const brand = await prisma.brand.findUnique({
        where: { id: brandId },
        include: {
          campaigns: {
            where: { 
              status: 'active',
              ...(campaignId && { id: campaignId })
            },
            include: { content: true }
          }
        }
      })

      if (!brand) {
        throw new Error(`Brand ${brandId} not found`)
      }

      // Get active campaign or use brand defaults
      const activeCampaign = brand.campaigns.find(c => c.id === campaignId) || brand.campaigns[0]
      let themes = ['lifestyle', 'inspiration', 'behind-the-scenes'] // defaults
      let style = 'modern' // default

      if (activeCampaign) {
        const config = activeCampaign.config as any
        themes = config.themes || themes
        style = config.style || style
        console.log(`Using campaign ${activeCampaign.name} for rolling generation`)
      } else {
        // Use brand preferences if no active campaign
        const prefs = (brand.preferences as any)?.contentStrategy
        if (prefs) {
          themes = prefs.themes || themes
          style = prefs.style || style
        }
        console.log(`Using brand preferences for rolling generation`)
      }

      // Get or generate style profile
      let styleProfile = brand.styleProfile as unknown as StyleProfile
      if (!styleProfile) {
        console.log(`Generating style profile for brand: ${brand.name}`)
        const analysisResult = await analyzeBrandStyle([], brand.name)
        styleProfile = analysisResult.styleProfile

        await prisma.brand.update({
          where: { id: brandId },
          data: { styleProfile: styleProfile as any },
        })
      }

      // Calculate how many posts to generate
      const postsNeeded = Math.min(
        DEFAULT_CONFIG.batchSize, 
        DEFAULT_CONFIG.targetQueueSize - queueStatus.daysAhead
      )

      console.log(`Generating ${postsNeeded} posts for brand: ${brand.name}`)

      // Generate content
      const generatedContent = []
      for (let i = 0; i < postsNeeded; i++) {
        const theme = themes[i % themes.length]
        
        const contentRequest: ContentGenerationRequest = {
          brandId,
          count: 1,
          theme,
          style
        }

        const content = await generateInstagramContent(styleProfile, brand.name, contentRequest)
        generatedContent.push(...content)
      }

      // Save and schedule the generated content
      for (const content of generatedContent) {
        // Save to database
        const savedContent = await prisma.content.create({
          data: {
            caption: content.caption,
            hashtags: content.hashtags,
            imageUrl: content.imageUrl ?? null,
            brandId,
            campaignId: activeCampaign?.id || null,
            status: 'approved', // Auto-approve rolling content
            generationParams: {
              source: 'rolling_generation',
              theme: content.imagePrompt || 'lifestyle',
              style,
              generatedAt: new Date().toISOString(),
              rollingGeneration: true
            }
          }
        })

        // Schedule the content
        const nextSlot = await this.getNextAvailableSlot(brandId)
        await schedulerService.scheduleContent(savedContent.id, nextSlot)

        console.log(`Generated and scheduled rolling content: ${savedContent.id} for ${nextSlot.toISOString()}`)
      }

      console.log(`Rolling generation complete for brand: ${brand.name}`)

    } catch (error) {
      console.error('Error generating rolling content:', error)
      throw error
    }
  }

  /**
   * Find the next available scheduling slot for a brand
   */
  private async getNextAvailableSlot(brandId: string): Promise<Date> {
    const now = new Date()
    
    // Find the last scheduled post
    const lastScheduled = await prisma.content.findFirst({
      where: {
        brandId,
        scheduledAt: { gte: now }
      },
      orderBy: { scheduledAt: 'desc' }
    })

    if (!lastScheduled?.scheduledAt) {
      // No posts scheduled, start from tomorrow at 9 AM
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(9, 0, 0, 0)
      return tomorrow
    }

    // Schedule 24 hours after the last post (daily frequency)
    // In production, this should respect the campaign's frequency settings
    const nextSlot = new Date(lastScheduled.scheduledAt.getTime() + 24 * 60 * 60 * 1000)
    
    // Ensure it's at a reasonable hour (9 AM to 8 PM)
    if (nextSlot.getHours() < 9) {
      nextSlot.setHours(9, 0, 0, 0)
    } else if (nextSlot.getHours() > 20) {
      nextSlot.setDate(nextSlot.getDate() + 1)
      nextSlot.setHours(9, 0, 0, 0)
    }

    return nextSlot
  }

  /**
   * Manual trigger for rolling generation (for testing/debugging)
   */
  async triggerManual(brandId: string, campaignId?: string): Promise<{ success: boolean; message: string; generated: number }> {
    try {
      const queueStatus = await this.checkContentQueue(brandId)
      
      if (!queueStatus.needsGeneration) {
        return {
          success: true,
          message: `Brand has sufficient content (${queueStatus.daysAhead} days ahead)`,
          generated: 0
        }
      }

      await this.generateAndScheduleContent(brandId, campaignId, queueStatus)
      
      return {
        success: true,
        message: `Rolling generation completed for brand ${brandId}`,
        generated: DEFAULT_CONFIG.batchSize
      }
    } catch (error) {
      console.error('Manual rolling generation failed:', error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        generated: 0
      }
    }
  }

  /**
   * Get queue status for a brand (for monitoring/debugging)
   */
  async getQueueStatus(brandId: string): Promise<QueueStatus> {
    return await this.checkContentQueue(brandId)
  }
}

export const rollingContentService = new RollingContentService()